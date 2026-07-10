// PROD verification for the soft-delete deploy. Runs INSIDE the openlevel-api
// container (cd /app && npx tsx scripts/verify-softdelete-prod.ts) so it exercises
// the *deployed* ContactsRepo against the *real* migrated DB via the container's
// own DATABASE_URL. It never prints the DATABASE_URL or any phone number.
//
// It creates a clearly-labelled, keyless (name-only) probe contact -- a fresh
// insert that can never collide with a real customer's match key and fires no
// outbound (createContact is inert) -- drives the full archive -> gone-from-book
// -> shows-in-archived -> restore -> back-in-book loop asserting each step, then
// HARD-deletes that one probe row by its exact id so prod is left pristine. The
// probe is a verification artifact created seconds earlier, never real data.
import { Pool } from 'pg'
import { PgDatabase } from '../server/db/database'
import { ContactsRepo } from '../server/repos/contacts-repo'

const PROBE_NAME = 'ZZ Soft-Delete Probe (auto-removed)'
const fail = (msg: string): never => {
  console.log('VERIFY_RESULT=FAIL :: ' + msg)
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = new PgDatabase(pool)

try {
  const locs = await db.query<{ id: string }>(
    'SELECT id FROM locations ORDER BY created_at LIMIT 1',
  )
  if (!locs[0]) fail('no location found on prod')
  const loc = locs[0]!.id
  const repo = new ContactsRepo(db, loc)

  // 1. create the keyless probe
  const created = await repo.upsertByMatch({ name: PROBE_NAME }, 'softdelete-verify')
  const id = created.id
  if (!id) fail('upsertByMatch returned no id')
  if (created.archived_at !== null) fail('new contact should start live (archived_at null)')
  console.log('[verify] created probe ' + id + ' in location ' + loc)

  // 2. it is in the live book, not in archived
  if (!(await repo.list(50)).some((c) => c.id === id)) fail('probe not in live list() after create')
  if ((await repo.listArchived(200)).some((c) => c.id === id)) fail('fresh probe wrongly in listArchived()')
  console.log('[verify] live=yes archived=no  (create OK)')

  // 3. archive (the operator "Delete")
  const archived = await repo.archive(id)
  if (!archived) fail('archive() returned undefined')
  if (archived!.archived_at === null) fail('archive() did not stamp archived_at')
  if ((await repo.list(50)).some((c) => c.id === id)) fail('archived probe still in live list()')
  if (!(await repo.listArchived(200)).some((c) => c.id === id)) fail('archived probe missing from listArchived()')
  console.log('[verify] archived: gone-from-book=yes in-archived=yes  (delete OK)')

  // 4. restore
  const restored = await repo.restore(id)
  if (!restored) fail('restore() returned undefined')
  if (restored!.archived_at !== null) fail('restore() did not clear archived_at')
  if (!(await repo.list(50)).some((c) => c.id === id)) fail('restored probe not back in live list()')
  if ((await repo.listArchived(200)).some((c) => c.id === id)) fail('restored probe still in listArchived()')
  console.log('[verify] restored: back-in-book=yes in-archived=no  (restore OK)')

  // 5. cleanup: hard-delete ONLY this probe row, by exact id
  const gone = await db.query<{ id: string }>('DELETE FROM contacts WHERE id = $1 RETURNING id', [id])
  if (gone.length !== 1) fail('cleanup deleted ' + gone.length + ' rows (expected exactly 1)')
  console.log('[verify] cleanup: probe hard-deleted (1 row), prod left pristine')

  console.log('VERIFY_RESULT=PASS')
} catch (e) {
  fail('threw: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await pool.end()
}
