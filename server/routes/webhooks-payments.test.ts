import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import type { PaymentEvent, PaymentProvider, WebhookInput } from '../lib/payments/provider'
import type { ResolvedProvider } from '../lib/payments/resolve'
import { paymentsWebhookRoute } from './webhooks-payments'

/** A fake processor: signature = the literal header 'x-test-signature: good';
 *  events come from the canned queue. Lets the route logic be tested without
 *  real HMAC plumbing (the adapters' own tests cover that). */
function fakeProvider(name: string, events: PaymentEvent[]): PaymentProvider & { seenUrls: string[] } {
  const seenUrls: string[] = []
  return {
    name,
    seenUrls,
    createCheckoutLink: vi.fn(async () => ({ url: 'x', externalId: 'x', provider: name })),
    verifyWebhook(input: WebhookInput): boolean {
      seenUrls.push(input.url)
      return input.headers['x-test-signature'] === 'good'
    },
    parseEvent(): PaymentEvent {
      return events.shift() ?? { type: 'ignored' }
    },
  }
}

function harness(db: FakeDatabase, resolved: ResolvedProvider) {
  const app = new Hono<AppEnv>()
  app.route('/', paymentsWebhookRoute({ db, resolvePayments: async () => resolved }))
  return app
}

function deliver(app: Hono<AppEnv>, path: string, signature = 'good', headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signature': signature, ...headers },
    body: '{"some":"event"}',
  })
}

const COMPLETED_BY_INVOICE: PaymentEvent = {
  type: 'payment_completed',
  invoiceId: 'inv1',
  externalId: 'cs_1',
  amountCents: 25000,
  method: 'stripe',
}

const COMPLETED_BY_EXTERNAL: PaymentEvent = {
  type: 'payment_completed',
  externalId: 'order_xyz',
  amountCents: 25000,
  method: 'square',
}

test('404 when the location has no provider connected', async () => {
  const db = new FakeDatabase()
  const res = await deliver(harness(db, { ok: false, reason: 'no payment provider connected' }), '/webhook/stripe/locA')
  expect(res.status).toBe(404)
  expect(db.calls).toHaveLength(0)
})

test('404 when the URL names a different provider than the location connected', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('stripe', [])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/square/locA')
  expect(res.status).toBe(404)
})

test('401 on a bad signature, before any parsing or DB access', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('stripe', [COMPLETED_BY_INVOICE])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/stripe/locA', 'forged')
  expect(res.status).toBe(401)
  expect(db.calls).toHaveLength(0)
})

test('verification sees the https URL when X-Forwarded-Proto says so (Square signs over it)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // invoice lookup -> none (we only care about the URL here)
  const provider = fakeProvider('square', [COMPLETED_BY_EXTERNAL])
  await deliver(harness(db, { ok: true, provider }), '/webhook/square/locA', 'good', {
    'x-forwarded-proto': 'https',
  })
  expect(provider.seenUrls[0]).toMatch(/^https:\/\//)
  expect(provider.seenUrls[0]).toContain('/webhook/square/locA')
})

test('a verified stripe completion marks the invoice paid and logs payment_received', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'inv1',
      contact_id: 'c1',
      number: 'INV-1001',
      status: 'sent',
      paid_at: null,
      items: [{ description: 'Inspection', quantity: 1, unit_amount: 25000 }],
    },
  ]) // repo.get by signed metadata invoice id
  db.enqueue([
    {
      id: 'inv1',
      contact_id: 'c1',
      number: 'INV-1001',
      status: 'paid',
      items: [{ description: 'Inspection', quantity: 1, unit_amount: 25000 }],
    },
  ]) // recordPayment RETURNING
  const provider = fakeProvider('stripe', [COMPLETED_BY_INVOICE])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/stripe/locA')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  // lookup scoped to the location from the URL
  expect(db.calls[0]?.params).toEqual(['locA', 'inv1'])
  // bookkeeping write via the same recordPayment path as manual mark-as-paid
  expect(db.calls[1]?.sql).toMatch(/SET status='paid'/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'stripe', 'inv1'])
  expect(db.calls[2]?.sql).toMatch(/INSERT INTO timeline_events/i)
  expect(db.calls[2]?.params).toContain('payment_received')
  expect(db.calls[2]?.params?.[6]).toMatchObject({ method: 'stripe', total_cents: 25000 })
})

test('a square completion correlates through the stored checkout external id', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      id: 'inv2',
      contact_id: null,
      number: 'INV-1002',
      status: 'sent',
      paid_at: null,
      checkout_external_id: 'order_xyz',
      items: [{ description: 'Service', quantity: 1, unit_amount: 25000 }],
    },
  ]) // findByCheckoutExternalId
  db.enqueue([{ id: 'inv2', contact_id: null, number: 'INV-1002', status: 'paid', items: [] }]) // recordPayment
  const provider = fakeProvider('square', [COMPLETED_BY_EXTERNAL])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/square/locA')

  expect(res.status).toBe(200)
  expect(db.calls[0]?.sql).toMatch(/checkout_external_id/)
  expect(db.calls[0]?.params).toEqual(['locA', 'order_xyz'])
  expect(db.calls[1]?.params).toEqual(['locA', 'square', 'inv2'])
  // no contact -> no timeline write
  expect(db.calls).toHaveLength(2)
})

test('a retried delivery for an already-paid invoice dedupes without a second write', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'inv1', paid_at: '2026-06-10T00:00:00Z', status: 'paid', items: [] }])
  const provider = fakeProvider('stripe', [COMPLETED_BY_INVOICE])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/stripe/locA')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, deduped: true })
  expect(db.calls).toHaveLength(1) // the lookup only — no UPDATE
})

test('an event we cannot match answers 200 ignored so the processor stops retrying', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // lookup -> none
  const provider = fakeProvider('stripe', [COMPLETED_BY_INVOICE])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/stripe/locA')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, ignored: true })
})

test('non-payment events are acknowledged and ignored without touching the DB', async () => {
  const db = new FakeDatabase()
  const provider = fakeProvider('stripe', [{ type: 'ignored' }])
  const res = await deliver(harness(db, { ok: true, provider }), '/webhook/stripe/locA')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, ignored: true })
  expect(db.calls).toHaveLength(0)
})

test('GET /success renders the landing page', async () => {
  const app = harness(new FakeDatabase(), { ok: false, reason: 'x' })
  const res = await app.request('/success')
  expect(res.status).toBe(200)
  expect(await res.text()).toContain('payment went through')
})
