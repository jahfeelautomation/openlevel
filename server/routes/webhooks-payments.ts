import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { invoiceTotalCents } from '../lib/invoice-math'
import { resolvePaymentProvider } from '../lib/payments/resolve'
import { InvoicesRepo } from '../repos/invoices-repo'
import { TimelineRepo } from '../repos/timeline-repo'

/**
 * The URL the processor actually signed over. Square signs the PUBLIC https URL
 * configured in its dashboard, but behind Traefik the node server sees http://,
 * so we restore the scheme from X-Forwarded-Proto before verification.
 */
function deliveredUrl(c: Context<AppEnv>): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')
  if (proto) url.protocol = `${proto}:`
  return url.toString()
}

/**
 * Public payment-processor webhooks (Module 48). Mounted under /api/public/pay
 * with NO session auth — the processor's signature is the only credential, and
 * verification runs over the RAW body before anything is parsed. The URL names
 * the location, so the right per-location secret is resolved and every DB
 * access below is scoped to that location:
 *
 *   POST /webhook/:provider/:locationId   processor event delivery
 *   GET  /success                         where the customer lands after paying
 *
 * A verified payment_completed marks the invoice paid via the same bookkeeping
 * path as a manual record-payment (recordPayment + payment_received timeline).
 * Deliveries are idempotent: processors retry, so an already-paid invoice
 * answers 200 deduped without a second write.
 */
export function paymentsWebhookRoute(deps: {
  db: Database
  /** Injectable for tests — defaults to the real settings+vault resolver. */
  resolvePayments?: typeof resolvePaymentProvider
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const resolvePayments = deps.resolvePayments ?? resolvePaymentProvider

  app.post('/webhook/:provider/:locationId', async (c) => {
    const providerName = c.req.param('provider')
    const locationId = c.req.param('locationId')
    const rawBody = await c.req.text()

    // The location must exist AND have this provider connected — anything else
    // is indistinguishable from a probe, so it gets a plain 404.
    const resolved = await resolvePayments(deps.db, locationId)
    if (!resolved.ok || resolved.provider.name !== providerName) return c.json({ error: 'not found' }, 404)

    const headers: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(c.req.header())) headers[k.toLowerCase()] = v
    if (!resolved.provider.verifyWebhook({ rawBody, headers, url: deliveredUrl(c) })) {
      return c.json({ error: 'invalid signature' }, 401)
    }

    const event = resolved.provider.parseEvent(rawBody)
    if (event.type !== 'payment_completed') return c.json({ ok: true, ignored: true })

    // Stripe round-trips our invoice id in signed metadata; Square only echoes
    // its order id, which we stored on the invoice when the link was minted.
    const repo = new InvoicesRepo(deps.db, locationId)
    const invoice = event.invoiceId
      ? await repo.get(event.invoiceId)
      : await repo.findByCheckoutExternalId(event.externalId)
    // Unknown invoice: 200 so the processor stops retrying a delivery we will
    // never be able to apply (e.g. the invoice was deleted after link creation).
    if (!invoice) return c.json({ ok: true, ignored: true })
    if (invoice.paid_at) return c.json({ ok: true, deduped: true })

    const paid = await repo.recordPayment(invoice.id, event.method)
    if (paid?.contact_id) {
      await new TimelineRepo(deps.db, locationId).add({
        contactId: paid.contact_id,
        type: 'payment_received',
        refTable: 'invoices',
        refId: paid.id,
        payload: { number: paid.number, total_cents: invoiceTotalCents(paid.items), method: event.method },
      })
    }
    return c.json({ ok: true })
  })

  // Where the processor's hosted page sends the customer afterwards. Honest
  // copy: the paid-mark arrives via webhook, which may land moments later.
  app.get('/success', (c) =>
    c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment complete</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}main{text-align:center;padding:2rem}h1{font-size:1.5rem}p{color:#475569}</style></head><body><main><h1>Thanks — your payment went through.</h1><p>Your receipt comes from the payment provider. You can close this tab.</p></main></body></html>`,
    ),
  )

  return app
}
