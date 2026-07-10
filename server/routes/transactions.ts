import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { summarizeTransactions, toTransaction } from '../lib/transaction-math'
import { type Invoice, InvoicesRepo } from '../repos/invoices-repo'

/**
 * The Transactions ledger for the current location (GHL "Payments ->
 * Transactions"). Mounted behind operatorAuth + locationAccess.
 *
 * This is a READ-ONLY projection of invoices that carry a recorded payment.
 * There is intentionally no create/update/delete and no endpoint that charges a
 * card: OpenLevel never moves money, so a transaction exists here only because
 * an operator recorded a payment on an invoice. Each row's amount is derived
 * from that invoice's line items, so the ledger can never report a dollar the
 * invoices don't justify, and the rollup is computed fresh from those rows.
 *
 *   GET /   every recorded payment (newest first) + a KPI summary
 */
export function transactionsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const paid = await new InvoicesRepo(deps.db, loc).listPaid()
    const transactions = paid
      .filter((inv): inv is Invoice & { paid_at: string } => inv.paid_at !== null)
      .map(toTransaction)
    const summary = summarizeTransactions(transactions, new Date().toISOString())
    return c.json({ transactions, summary })
  })

  return app
}
