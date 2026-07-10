import { FakeDatabase } from '../db/fake-database'
import { TriggerLinkClicksRepo } from './trigger-link-clicks-repo'

test('record inserts a click row with location as $1, link, and contact (nullable)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', link_id: 'l1', contact_id: 'ct1' }])
  const repo = new TriggerLinkClicksRepo(db, 'locA')

  await repo.record({ linkId: 'l1', contactId: 'ct1' })
  const { sql, params } = db.calls[0]!
  expect(sql).toMatch(/INSERT INTO trigger_link_clicks/i)
  expect(sql).toMatch(/RETURNING \*/i)
  expect(params[0]).toBe('locA') // location_id is $1 under scopedWrite
  expect(params).toContain('l1')
  expect(params).toContain('ct1')
})

test('record allows an anonymous click (no contact)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', link_id: 'l1', contact_id: null }])
  const repo = new TriggerLinkClicksRepo(db, 'locA')

  await repo.record({ linkId: 'l1', contactId: null })
  expect(db.calls[0]?.params).toContain(null)
})

test('recentForLink joins contacts for the name, scoped, newest first, limited', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', clicked_at: '2026-06-01', contact_id: 'ct1', contact_name: 'Dana' }])
  const repo = new TriggerLinkClicksRepo(db, 'locA')

  await repo.recentForLink('l1', 10)
  const { sql, params } = db.calls[0]!
  expect(sql).toMatch(/FROM trigger_link_clicks cl/i)
  expect(sql).toMatch(/LEFT JOIN contacts ct ON ct\.id = cl\.contact_id/i)
  // Join breaks the regex rewrite, so the repo filters explicitly on cl.location_id.
  expect(sql).toMatch(/WHERE cl\.location_id = \$1 AND cl\.link_id = \$2/i)
  expect(sql).toMatch(/ORDER BY cl\.clicked_at DESC/i)
  expect(sql).toMatch(/LIMIT \$3/i)
  expect(params).toEqual(['locA', 'l1', 10])
})
