import { FakeDatabase } from '../db/fake-database'
import { CampaignsRepo } from './campaigns-repo'

test('list scopes the read to the location ($1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', location_id: 'locA' }])
  const repo = new CampaignsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'cmp1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('create sets location $1 and defaults channel/subject/audience', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp_new', location_id: 'locA' }])
  const repo = new CampaignsRepo(db, 'locA')

  await repo.create({ name: 'Spring blast', body: 'Hi {{first_name}}' })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Spring blast')
  expect(params).toContain('sms') // default channel
  expect(params).toContain('Hi {{first_name}}')
})

test('get reads a single campaign scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1' }])
  const repo = new CampaignsRepo(db, 'locA')

  await repo.get('cmp1')
  expect(db.calls[0]?.params).toEqual(['locA', 'cmp1'])
})

test('markSent stamps counts and scopes to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'cmp1', status: 'sent' }])
  const repo = new CampaignsRepo(db, 'locA')

  const out = await repo.markSent('cmp1', 3, 3)
  expect(out).toEqual({ id: 'cmp1', status: 'sent' })
  expect(db.calls[0]?.sql).toMatch(/status='sent'/i)
  expect(db.calls[0]?.params).toEqual(['locA', 3, 3, 'cmp1']) // scopedWrite prepends location as $1
})
