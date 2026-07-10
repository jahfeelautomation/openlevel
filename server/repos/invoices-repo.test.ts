import { FakeDatabase } from '../db/fake-database'
import { InvoicesRepo } from './invoices-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', location_id: 'locA' }])
  const repo = new InvoicesRepo(db, 'locA')

  const out = await repo.list()
  expect(out).toEqual([{ id: 'inv1', location_id: 'locA' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('listPaid scopes to location, keeps only paid invoices, newest payment first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', location_id: 'locA', paid_at: '2026-06-10T00:00:00Z' }])
  const repo = new InvoicesRepo(db, 'locA')

  const out = await repo.listPaid()
  expect(out).toEqual([{ id: 'inv1', location_id: 'locA', paid_at: '2026-06-10T00:00:00Z' }])
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND paid_at IS NOT NULL/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY paid_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads a single invoice scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.get('inv1')
  expect(db.calls[0]?.params).toEqual(['locA', 'inv1'])
})

test('nextNumber formats a per-location sequential INV number from the count', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 2 }]) // two invoices already exist for this location
  const repo = new InvoicesRepo(db, 'locA')

  const num = await repo.nextNumber()
  expect(num).toBe('INV-1003')
  expect(db.calls[0]?.sql).toMatch(/count\(\*\)/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('create sets location $1, defaults status/currency/items, json-encodes items', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv_new', location_id: 'locA', status: 'draft' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.create({
    number: 'INV-1001',
    contactId: 'c1',
    items: [{ description: 'Roof inspection', quantity: 1, unit_amount: 25000 }],
  })
  const params = db.calls[0]?.params
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('INV-1001')
  expect(params).toContain('c1')
  expect(params).toContain('draft')
  expect(params).toContain('usd')
  expect(params).toContain(
    JSON.stringify([{ description: 'Roof inspection', quantity: 1, unit_amount: 25000 }]),
  )
})

test('create honors explicit status, currency, notes, and due date', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv_new' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.create({
    number: 'INV-1002',
    status: 'sent',
    currency: 'usd',
    notes: 'Net 15',
    issuedAt: '2026-06-01T00:00:00Z',
    dueAt: '2026-06-16T00:00:00Z',
  })
  const params = db.calls[0]?.params
  expect(params).toContain('sent')
  expect(params).toContain('Net 15')
  expect(params).toContain('2026-06-16T00:00:00Z')
})

test('update builds a dynamic SET of only provided columns, id last, items encoded', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.update('inv1', {
    notes: 'Updated',
    items: [{ description: 'X', quantity: 2, unit_amount: 500 }],
  })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE invoices SET/i)
  expect(call?.sql).toMatch(/updated_at=now\(\)/i)
  expect(call?.params?.[0]).toBe('locA')
  expect(call?.params).toContain(JSON.stringify([{ description: 'X', quantity: 2, unit_amount: 500 }]))
  expect(call?.params?.[call.params.length - 1]).toBe('inv1') // id is last
})

test('update with no fields is a no-op that returns undefined (no query)', async () => {
  const db = new FakeDatabase()
  const repo = new InvoicesRepo(db, 'locA')

  const out = await repo.update('inv1', {})
  expect(out).toBeUndefined()
  expect(db.calls.length).toBe(0)
})

test('markSent flips to sent and stamps issued_at the first time only', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', status: 'sent' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.markSent('inv1')
  expect(db.calls[0]?.sql).toMatch(/SET status='sent'/i)
  expect(db.calls[0]?.sql).toMatch(/issued_at=COALESCE\(issued_at, now\(\)\)/i)
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'inv1'])
})

test('recordPayment marks paid, stamps paid_at + method (bookkeeping only)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', status: 'paid' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.recordPayment('inv1', 'card')
  expect(db.calls[0]?.sql).toMatch(/SET status='paid'/i)
  expect(db.calls[0]?.sql).toMatch(/paid_at=now\(\)/i)
  expect(db.calls[0]?.sql).toMatch(/payment_method=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'card', 'inv1'])
})

test('setStatus flips to an arbitrary status (e.g. void) scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', status: 'void' }])
  const repo = new InvoicesRepo(db, 'locA')

  await repo.setStatus('inv1', 'void')
  expect(db.calls[0]?.sql).toMatch(/UPDATE invoices SET status=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'void', 'inv1'])
})
