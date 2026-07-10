import { Hono } from 'hono'
import { vi } from 'vitest'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { PaymentProvider } from '../lib/payments/provider'
import type { ResolvedProvider } from '../lib/payments/resolve'
import { invoicesRoute } from './invoices'

function harness(db: FakeDatabase, locationId = 'locA', resolved?: ResolvedProvider) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', invoicesRoute({ db, ...(resolved ? { resolvePayments: async () => resolved } : {}) }))
  return app
}

function jsonReq(app: Hono<AppEnv>, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('GET / lists invoices scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', number: 'INV-1001', status: 'sent' }])
  const res = await harness(db).request('/')

  expect(res.status).toBe(200)
  const body = (await res.json()) as { invoices: { id: string }[] }
  expect(body.invoices[0]?.id).toBe('inv1')
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('POST / auto-assigns the next number and creates a draft (201)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 0 }]) // nextNumber count -> first invoice
  db.enqueue([{ id: 'inv_new', number: 'INV-1001', status: 'draft' }]) // create RETURNING
  const res = await jsonReq(harness(db), '/', 'POST', {
    contactId: 'c1',
    items: [{ description: 'Roof inspection', quantity: 1, unit_amount: 25000 }],
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { ok: boolean; invoice: { id: string; number: string } }
  expect(body.ok).toBe(true)
  expect(body.invoice.id).toBe('inv_new')

  // First query computes the number for this location; second inserts it.
  expect(db.calls[0]?.sql).toMatch(/count\(\*\)/i)
  const createParams = db.calls[1]?.params
  expect(createParams?.[0]).toBe('locA') // location_id is $1
  expect(createParams).toContain('INV-1001') // server-assigned, not client-supplied
  expect(createParams).toContain('draft')
  expect(createParams).toContain('c1')
  expect(createParams).toContain(
    JSON.stringify([{ description: 'Roof inspection', quantity: 1, unit_amount: 25000 }]),
  )
})

test('POST / passes notes and due date through to create', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ n: 2 }]) // two exist -> INV-1003
  db.enqueue([{ id: 'inv_new' }])
  const res = await jsonReq(harness(db), '/', 'POST', {
    notes: 'Net 15',
    dueAt: '2026-06-20T00:00:00Z',
    items: [{ description: 'Service', quantity: 1, unit_amount: 5000 }],
  })

  expect(res.status).toBe(201)
  const createParams = db.calls[1]?.params
  expect(createParams).toContain('INV-1003')
  expect(createParams).toContain('Net 15')
  expect(createParams).toContain('2026-06-20T00:00:00Z')
})

test('GET /:id returns the invoice', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', number: 'INV-1001' }])
  const res = await harness(db).request('/inv1')

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ invoice: { id: 'inv1' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'inv1'])
})

test('GET /:id is 404 when the invoice is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('PATCH /:id edits items + notes scoped to location, id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1' }])
  const res = await jsonReq(harness(db), '/inv1', 'PATCH', {
    notes: 'Updated',
    items: [{ description: 'X', quantity: 2, unit_amount: 500 }],
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, invoice: { id: 'inv1' } })
  expect(db.calls[0]?.params?.[0]).toBe('locA')
  expect(db.calls[0]?.params).toContain(JSON.stringify([{ description: 'X', quantity: 2, unit_amount: 500 }]))
  expect(db.calls[0]?.params?.[db.calls[0].params.length - 1]).toBe('inv1')
})

test('POST /:id/send marks it sent and logs an invoice_sent timeline event', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'inv1',
      contact_id: 'c1',
      number: 'INV-1001',
      status: 'sent',
      items: [{ description: 'Inspection', quantity: 1, unit_amount: 25000 }],
    },
  ]) // markSent RETURNING
  const res = await harness(db).request('/inv1/send', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, invoice: { status: 'sent' } })
  expect(db.calls[0]?.sql).toMatch(/SET status='sent'/i)
  // second call logs the activity on the contact's timeline
  expect(db.calls[1]?.sql).toMatch(/INSERT INTO timeline_events/i)
  expect(db.calls[1]?.params).toContain('invoice_sent')
  expect(db.calls[1]?.params).toContain('c1')
})

test('POST /:id/send with no contact skips the timeline write', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', contact_id: null, number: 'INV-1001', status: 'sent', items: [] }])
  const res = await harness(db).request('/inv1/send', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(db.calls.length).toBe(1) // only markSent, no timeline
})

test('POST /:id/send is 404 when the invoice is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // markSent RETURNING -> none
  const res = await harness(db).request('/missing/send', { method: 'POST' })
  expect(res.status).toBe(404)
})

test('POST /:id/record-payment marks paid and logs payment_received with the method', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'inv1',
      contact_id: 'c1',
      number: 'INV-1001',
      status: 'paid',
      items: [{ description: 'Inspection', quantity: 1, unit_amount: 25000 }],
    },
  ]) // recordPayment RETURNING
  const res = await jsonReq(harness(db), '/inv1/record-payment', 'POST', { method: 'card' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, invoice: { status: 'paid' } })
  expect(db.calls[0]?.sql).toMatch(/SET status='paid'/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'card', 'inv1'])
  expect(db.calls[1]?.sql).toMatch(/INSERT INTO timeline_events/i)
  expect(db.calls[1]?.params).toContain('payment_received')
  // method + derived total ride along in the timeline payload (last param, jsonb)
  expect(db.calls[1]?.params?.[6]).toMatchObject({ method: 'card', number: 'INV-1001', total_cents: 25000 })
})

test('POST /:id/record-payment defaults the method to manual', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', contact_id: null, number: 'INV-1001', status: 'paid', items: [] }])
  const res = await jsonReq(harness(db), '/inv1/record-payment', 'POST', {})

  expect(res.status).toBe(200)
  expect(db.calls[0]?.params).toEqual(['locA', 'manual', 'inv1'])
})

test('POST /:id/void marks the invoice void', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', status: 'void' }])
  const res = await harness(db).request('/inv1/void', { method: 'POST' })

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ ok: true, invoice: { status: 'void' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'void', 'inv1'])
})

// ---- POST /:id/checkout-link (Module 48: pay-by-link via the location's own processor)

function fakeResolved(overrides: Partial<PaymentProvider> = {}): ResolvedProvider {
  return {
    ok: true,
    provider: {
      name: 'stripe',
      createCheckoutLink: vi.fn(async () => ({
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        externalId: 'cs_1',
        provider: 'stripe',
      })),
      verifyWebhook: () => true,
      parseEvent: () => ({ type: 'ignored' }),
      ...overrides,
    },
  }
}

const payableInvoice = {
  id: 'inv1',
  contact_id: 'c1',
  number: 'INV-1001',
  status: 'sent',
  currency: 'usd',
  items: [{ description: 'Inspection', quantity: 1, unit_amount: 25000 }],
}

test('POST /:id/checkout-link mints the link in the processor and persists it on the invoice', async () => {
  const db = new FakeDatabase()
  db.enqueue([payableInvoice]) // repo.get
  db.enqueue([{ ...payableInvoice, checkout_url: 'https://checkout.stripe.com/c/pay/cs_1' }]) // setCheckoutLink RETURNING
  const resolved = fakeResolved()
  const res = await harness(db, 'locA', resolved).request('/inv1/checkout-link', { method: 'POST' })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; checkoutUrl: string }
  expect(body.ok).toBe(true)
  expect(body.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_1')

  // the adapter got the derived total + invoice identity, and a success URL on our public route
  const req = (resolved.ok ? resolved.provider.createCheckoutLink : null) as ReturnType<typeof vi.fn>
  expect(req.mock.calls[0]?.[0]).toMatchObject({
    invoiceId: 'inv1',
    invoiceNumber: 'INV-1001',
    amountCents: 25000,
    currency: 'usd',
  })
  expect((req.mock.calls[0]?.[0] as { successUrl: string }).successUrl).toMatch(/\/api\/public\/pay\/success$/)

  // the link + correlation id were written back, scoped to the location
  expect(db.calls[1]?.sql).toMatch(/SET checkout_provider/)
  expect(db.calls[1]?.params).toEqual([
    'locA',
    'stripe',
    'cs_1',
    'https://checkout.stripe.com/c/pay/cs_1',
    'inv1',
  ])
})

test('POST /:id/checkout-link is 404 for a missing invoice', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // repo.get -> none
  const res = await harness(db, 'locA', fakeResolved()).request('/missing/checkout-link', { method: 'POST' })
  expect(res.status).toBe(404)
})

test('POST /:id/checkout-link refuses paid and void invoices (409)', async () => {
  for (const status of ['paid', 'void']) {
    const db = new FakeDatabase()
    db.enqueue([{ ...payableInvoice, status }])
    const res = await harness(db, 'locA', fakeResolved()).request('/inv1/checkout-link', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(db.calls).toHaveLength(1) // read only, nothing minted or written
  }
})

test('POST /:id/checkout-link refuses a zero-total invoice (422)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ ...payableInvoice, items: [] }])
  const res = await harness(db, 'locA', fakeResolved()).request('/inv1/checkout-link', { method: 'POST' })
  expect(res.status).toBe(422)
})

test('POST /:id/checkout-link reports an unconnected processor honestly (409 + reason)', async () => {
  const db = new FakeDatabase()
  db.enqueue([payableInvoice])
  const res = await harness(db, 'locA', { ok: false, reason: 'no payment provider connected' }).request(
    '/inv1/checkout-link',
    { method: 'POST' },
  )
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'no payment provider connected' })
})

test('POST /:id/checkout-link surfaces a processor rejection as 502 without writing', async () => {
  const db = new FakeDatabase()
  db.enqueue([payableInvoice])
  const resolved = fakeResolved({
    createCheckoutLink: vi.fn(async () => {
      throw new Error('stripe checkout session failed: 402')
    }),
  })
  const res = await harness(db, 'locA', resolved).request('/inv1/checkout-link', { method: 'POST' })
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'stripe checkout session failed: 402' })
  expect(db.calls).toHaveLength(1) // the read; no checkout columns written
})
