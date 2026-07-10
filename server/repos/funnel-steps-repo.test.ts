import { FakeDatabase } from '../db/fake-database'
import { FunnelStepsRepo } from './funnel-steps-repo'

test('listByFunnel scopes to location + funnel, ordered by position', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', funnel_id: 'fn1', position: 0 }])
  const repo = new FunnelStepsRepo(db, 'locA')

  const out = await repo.listByFunnel('fn1')
  expect(out).toHaveLength(1)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND funnel_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY position/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'fn1'])
})

test('getByPath finds a step by location + funnel + path (public render)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', path: 'get-offer' }])
  const repo = new FunnelStepsRepo(db, 'locA')

  const out = await repo.getByPath('fn1', 'get-offer')
  expect(out).toEqual({ id: 's1', path: 'get-offer' })
  expect(db.calls[0]?.sql).toMatch(/funnel_id=\$2 AND path=\$3/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'fn1', 'get-offer'])
})

test('create sets location $1, json-encodes content, defaults position 0', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's_new' }])
  const repo = new FunnelStepsRepo(db, 'locA')

  await repo.create({
    funnelId: 'fn1',
    name: 'Opt-in',
    type: 'opt_in',
    path: 'get-offer',
    content: { headline: 'Sell fast', fields: [{ name: 'email', label: 'Email' }] },
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('fn1')
  expect(params).toContain('opt_in')
  expect(params).toContain('get-offer')
  expect(params).toContain(0) // default position
  expect(params).toContain(
    JSON.stringify({ headline: 'Sell fast', fields: [{ name: 'email', label: 'Email' }] }),
  )
})

test('update json-encodes content and pins id as the last param', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1' }])
  const repo = new FunnelStepsRepo(db, 'locA')

  await repo.update('s1', { name: 'Headline edit', content: { headline: 'New' } })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA')
  expect(params).toContain('Headline edit')
  expect(params).toContain(JSON.stringify({ headline: 'New' }))
  expect(params?.[params.length - 1]).toBe('s1')
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new FunnelStepsRepo(db, 'locA')

  const out = await repo.update('s1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('incrementSubmissions bumps the counter scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 's1', submissions: 4 }])
  const repo = new FunnelStepsRepo(db, 'locA')

  const out = await repo.incrementSubmissions('s1')
  expect(out).toEqual({ id: 's1', submissions: 4 })
  expect(db.calls[0]?.sql).toMatch(/submissions\s*=\s*submissions\s*\+\s*1/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 's1'])
})
