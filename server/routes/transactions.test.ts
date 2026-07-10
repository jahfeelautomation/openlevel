import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { transactionsRoute } from './transactions'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', transactionsRoute({ db }))
  return app
}

test('GET / projects paid invoices into ledger rows with a derived amount + summary', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'inv1',
      location_id: 'locA',
      number: 'INV-1001',
      contact_id: 'c1',
      items: [
        { description: 'Inspection', quantity: 1, unit_amount: 25_000 },
        { description: 'Travel', quantity: 1, unit_amount: 1_500 },
      ],
      currency: 'usd',
      payment_method: 'card',
      paid_at: '2026-06-10T00:00:00Z',
    },
    {
      id: 'inv2',
      location_id: 'locA',
      number: 'INV-1002',
      contact_id: null,
      items: [{ description: 'Consult', quantity: 2, unit_amount: 5_000 }],
      currency: 'usd',
      payment_method: 'cash',
      paid_at: '2026-06-08T00:00:00Z',
    },
  ])

  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    transactions: { invoice_id: string; invoice_number: string; amount_cents: number; method: string }[]
    summary: { count: number; grossCents: number; byMethod: { method: string; count: number; cents: number }[] }
  }

  expect(body.transactions).toHaveLength(2)
  expect(body.transactions[0]).toMatchObject({
    invoice_id: 'inv1',
    invoice_number: 'INV-1001',
    amount_cents: 26_500, // derived from line items
    method: 'card',
  })
  expect(body.transactions[1]).toMatchObject({ invoice_id: 'inv2', amount_cents: 10_000, method: 'cash' })
  expect(body.summary.count).toBe(2)
  expect(body.summary.grossCents).toBe(36_500)
  expect(body.summary.byMethod).toEqual([
    { method: 'card', count: 1, cents: 26_500 },
    { method: 'cash', count: 1, cents: 10_000 },
  ])
  // the read is scoped to the location and to paid invoices only
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND paid_at IS NOT NULL/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('GET / on a location with no recorded payments is an honest all-zero ledger', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // listPaid -> none
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    transactions: [],
    summary: { count: 0, grossCents: 0, thisMonthCents: 0, byMethod: [] },
  })
})
