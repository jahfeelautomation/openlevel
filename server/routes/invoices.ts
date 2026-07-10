import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { invoiceTotalCents } from '../lib/invoice-math'
import { resolvePaymentProvider } from '../lib/payments/resolve'
import { InvoicesRepo } from '../repos/invoices-repo'
import { TimelineRepo } from '../repos/timeline-repo'

// A single billable line. unit_amount is in cents, like every money value here.
const itemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  unit_amount: z.number().int().min(0),
})

const createInvoiceSchema = z.object({
  contactId: z.string().min(1).nullish(),
  currency: z.string().min(1).optional(),
  items: z.array(itemSchema).optional(),
  notes: z.string().nullish(),
  dueAt: z.string().nullish(),
})

const patchInvoiceSchema = z.object({
  contactId: z.string().min(1).nullish(),
  currency: z.string().min(1).optional(),
  items: z.array(itemSchema).optional(),
  notes: z.string().nullish(),
  dueAt: z.string().nullish(),
})

const recordPaymentSchema = z.object({
  method: z.string().min(1).default('manual'),
})

/**
 * Invoices for the current location. Mounted behind operatorAuth + locationAccess.
 * The Payments UI reads GET / (list — each row carries its line items so the
 * total is derived the same way on client and server) and GET /:id. Creating an
 * invoice auto-assigns the next per-location number and starts it as a draft.
 *
 * Status transitions are explicit sub-routes, not a PATCH field, so each has a
 * clear side effect:
 *   POST /:id/send            draft -> sent   (logs an invoice_sent timeline event)
 *   POST /:id/record-payment  -> paid         (logs payment_received)
 *   POST /:id/void            -> void
 *
 * Recording a payment never moves money — OpenLevel is not a payment processor.
 * It writes down that the customer paid, the way GHL's manual-payment option or
 * QuickBooks does. There is deliberately no endpoint that charges a card.
 */
export function invoicesRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolvePayments?: typeof resolvePaymentProvider
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolvePayments = deps.resolvePayments ?? resolvePaymentProvider

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const invoices = await new InvoicesRepo(deps.db, loc).list()
    return c.json({ invoices })
  })

  app.post('/', zValidator('json', createInvoiceSchema), async (c) => {
    const loc = c.get('locationId')
    const input = c.req.valid('json')
    const repo = new InvoicesRepo(deps.db, loc)
    const number = await repo.nextNumber()
    const invoice = await repo.create({
      number,
      contactId: input.contactId ?? null,
      currency: input.currency,
      items: input.items,
      notes: input.notes ?? null,
      dueAt: input.dueAt ?? null,
    })
    return c.json({ ok: true, invoice }, 201)
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const invoice = await new InvoicesRepo(deps.db, loc).get(c.req.param('id'))
    if (!invoice) return c.json({ error: 'not found' }, 404)
    return c.json({ invoice })
  })

  app.patch('/:id', zValidator('json', patchInvoiceSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const invoice = await new InvoicesRepo(deps.db, loc).update(id, {
      contactId: body.contactId,
      currency: body.currency,
      items: body.items,
      notes: body.notes,
      dueAt: body.dueAt,
    })
    if (!invoice) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, invoice })
  })

  app.post('/:id/send', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new InvoicesRepo(deps.db, loc)
    const invoice = await repo.markSent(id)
    if (!invoice) return c.json({ error: 'not found' }, 404)
    if (invoice.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: invoice.contact_id,
        type: 'invoice_sent',
        refTable: 'invoices',
        refId: invoice.id,
        payload: { number: invoice.number, total_cents: invoiceTotalCents(invoice.items) },
      })
    }
    return c.json({ ok: true, invoice })
  })

  app.post('/:id/record-payment', zValidator('json', recordPaymentSchema), async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const { method } = c.req.valid('json')
    const repo = new InvoicesRepo(deps.db, loc)
    const invoice = await repo.recordPayment(id, method)
    if (!invoice) return c.json({ error: 'not found' }, 404)
    if (invoice.contact_id) {
      await new TimelineRepo(deps.db, loc).add({
        contactId: invoice.contact_id,
        type: 'payment_received',
        refTable: 'invoices',
        refId: invoice.id,
        payload: { number: invoice.number, total_cents: invoiceTotalCents(invoice.items), method },
      })
    }
    return c.json({ ok: true, invoice })
  })

  // Mint a hosted checkout link inside the location's OWN processor account
  // (Module 48). The customer pays on Stripe/Square's page; their processor
  // charges the card — OpenLevel never touches the money. The webhook (see
  // webhooks-payments.ts) later marks the invoice paid.
  app.post('/:id/checkout-link', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const repo = new InvoicesRepo(deps.db, loc)
    const invoice = await repo.get(id)
    if (!invoice) return c.json({ error: 'not found' }, 404)
    if (invoice.status === 'paid' || invoice.status === 'void')
      return c.json({ error: `cannot create a checkout link for a ${invoice.status} invoice` }, 409)
    const total = invoiceTotalCents(invoice.items)
    if (total <= 0) return c.json({ error: 'invoice total must be greater than zero' }, 422)

    const resolved = await resolvePayments(deps.db, loc)
    if (!resolved.ok) return c.json({ error: resolved.reason }, 409)

    let link
    try {
      link = await resolved.provider.createCheckoutLink({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountCents: total,
        currency: invoice.currency,
        successUrl: `${new URL(c.req.url).origin}/api/public/pay/success`,
      })
    } catch (err) {
      // Adapter errors carry the HTTP status, never the key — safe to surface.
      return c.json({ error: err instanceof Error ? err.message : 'checkout link failed' }, 502)
    }

    const updated = await repo.setCheckoutLink(id, link.provider, link.externalId, link.url)
    return c.json({ ok: true, invoice: updated, checkoutUrl: link.url })
  })

  app.post('/:id/void', async (c) => {
    const loc = c.get('locationId')
    const invoice = await new InvoicesRepo(deps.db, loc).setStatus(c.req.param('id'), 'void')
    if (!invoice) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, invoice })
  })

  return app
}
