import { FakeDatabase } from '../db/fake-database'
import { ProposalsRepo } from './proposals-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA' }])
  const repo = new ProposalsRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'p1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single proposal scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.get('p1')
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('getBySlug resolves the public slug scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', slug: 'marketing-retainer' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.getBySlug('marketing-retainer')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'marketing-retainer'])
})

test('create sets location $1, defaults status/currency/content, json-encodes content', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new', location_id: 'locA', status: 'draft' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.create({
    title: 'Marketing retainer',
    slug: 'marketing-retainer',
    contactId: 'c1',
    content: { intro: 'Hi', line_items: [{ description: 'Setup', quantity: 1, unit_amount: 150000 }] },
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('Marketing retainer')
  expect(params).toContain('marketing-retainer')
  expect(params).toContain('c1')
  expect(params).toContain('draft')
  expect(params).toContain('usd')
  expect(params).toContain(
    JSON.stringify({ intro: 'Hi', line_items: [{ description: 'Setup', quantity: 1, unit_amount: 150000 }] }),
  )
})

test('create honors an explicit status and currency', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.create({ title: 'Estimate', slug: 'estimate', status: 'sent', currency: 'cad' })
  const params = db.calls[0]?.params
  expect(params).toContain('sent')
  expect(params).toContain('cad')
})

test('update builds a dynamic SET of only provided columns, id last, content encoded', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.update('p1', {
    title: 'Renamed',
    content: { intro: 'Updated', line_items: [{ description: 'X', quantity: 2, unit_amount: 500 }] },
  })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE proposals SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain('Renamed')
  expect(call?.params).toContain(
    JSON.stringify({ intro: 'Updated', line_items: [{ description: 'X', quantity: 2, unit_amount: 500 }] }),
  )
  expect(call?.params?.[call.params.length - 1]).toBe('p1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new ProposalsRepo(db, 'locA')

  const out = await repo.update('p1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('markSent flips a draft to sent scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'sent' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.markSent('p1')
  expect(db.calls[0]?.sql).toMatch(/SET status='sent'/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('markViewed only advances a sent proposal (guarded sent -> viewed)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'viewed' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.markViewed('p1')
  expect(db.calls[0]?.sql).toMatch(/SET status='viewed'/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2 AND status='sent'/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('sign stamps the typed signer name + signed_at and moves to signed', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'signed' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.sign('p1', 'Alex Mercer')
  expect(db.calls[0]?.sql).toMatch(/SET status='signed'/i)
  expect(db.calls[0]?.sql).toMatch(/signer_name=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/signed_at=now\(\)/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'Alex Mercer', 'p1'])
})

test('decline flips the proposal to declined scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'declined' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.decline('p1')
  expect(db.calls[0]?.sql).toMatch(/SET status='declined'/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('setStatus flips to an arbitrary status scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'draft' }])
  const repo = new ProposalsRepo(db, 'locA')

  await repo.setStatus('p1', 'draft')
  expect(db.calls[0]?.sql).toMatch(/UPDATE proposals SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'draft', 'p1'])
})

