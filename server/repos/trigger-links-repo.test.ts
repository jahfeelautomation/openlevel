import { FakeDatabase } from '../db/fake-database'
import { TriggerLinksRepo } from './trigger-links-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', location_id: 'locA' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.list()
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('listWithStats derives clicks/contacts/last_clicked from real click rows, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', clicks: 3, contacts: 2, last_clicked_at: '2026-06-01' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.listWithStats()
  const { sql, params } = db.calls[0]!
  // Stats come from a LEFT JOIN aggregate over the real click rows — not a stored
  // counter — so the figures can never drift from the clicks that justify them.
  expect(sql).toMatch(/LEFT JOIN trigger_link_clicks/i)
  expect(sql).toMatch(/COUNT\(c\.id\)::int AS clicks/i)
  expect(sql).toMatch(/COUNT\(DISTINCT c\.contact_id\)::int AS contacts/i)
  expect(sql).toMatch(/MAX\(c\.clicked_at\) AS last_clicked_at/i)
  // The join breaks the base-repo regex rewrite, so the repo filters explicitly.
  expect(sql).toMatch(/WHERE tl\.location_id = \$1/i)
  expect(sql).toMatch(/GROUP BY tl\.id/i)
  expect(sql).toMatch(/ORDER BY tl\.created_at DESC/i)
  expect(params).toEqual(['locA'])
})

test('getWithStats reads one link with its derived stats, scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', clicks: 0, contacts: 0, last_clicked_at: null }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.getWithStats('l1')
  const { sql, params } = db.calls[0]!
  expect(sql).toMatch(/LEFT JOIN trigger_link_clicks/i)
  expect(sql).toMatch(/WHERE tl\.location_id = \$1 AND tl\.id = \$2/i)
  expect(sql).toMatch(/GROUP BY tl\.id/i)
  expect(params).toEqual(['locA', 'l1'])
})

test('get reads one link scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.get('l1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'l1'])
})

test('getBySlug reads one link scoped to location + slug', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', slug: 'free-offer' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.getBySlug('free-offer')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'free-offer'])
})

test('create inserts with location as $1 and the link fields', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'generated', name: 'Free Offer' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.create({ name: 'Free Offer', slug: 'free-offer', destinationUrl: 'https://x.test/o' })
  const { sql, params } = db.calls[0]!
  expect(sql).toMatch(/INSERT INTO trigger_links/i)
  expect(params[0]).toBe('locA') // location_id is $1 under scopedWrite
  expect(params).toContain('Free Offer')
  expect(params).toContain('free-offer')
  expect(params).toContain('https://x.test/o')
})

test('update sets only the supplied fields and bumps updated_at, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'l1', name: 'Renamed' }])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.update('l1', { name: 'Renamed', destinationUrl: 'https://x.test/new' })
  const { sql, params } = db.calls[0]!
  expect(sql).toMatch(/UPDATE trigger_links SET/i)
  expect(sql).toMatch(/name=/i)
  expect(sql).toMatch(/destination_url=/i)
  expect(sql).toMatch(/updated_at=now\(\)/i)
  expect(sql).toMatch(/WHERE location_id=\$1 AND id=/i)
  expect(params[0]).toBe('locA')
  expect(params).toContain('Renamed')
})

test('remove deletes the link scoped to location + id (clicks cascade in the DB)', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new TriggerLinksRepo(db, 'locA')

  await repo.remove('l1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM trigger_links WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'l1'])
})
