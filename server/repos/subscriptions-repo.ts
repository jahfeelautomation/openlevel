import { nanoid } from 'nanoid'
import type { RecurringInterval } from '../lib/product-math'
import type { SubscriptionStatus } from '../lib/subscription-math'
import { LocationScopedRepo } from './base-repo'

export interface Subscription {
  id: string
  location_id: string
  /** The subscriber. SET NULL if the contact is deleted — the ledger row stays. */
  contact_id: string | null
  /** The catalog product this was started from. SET NULL if that product is
   *  deleted, because the row already snapshotted its name/amount/interval. */
  product_id: string | null
  /** Snapshot of the product name at create time. */
  name: string
  /** Snapshot price per period in integer cents (money is always cents here). */
  amount_cents: number
  currency: string
  /** day|week|month|year. Named to avoid the reserved SQL word `interval`. */
  billing_interval: RecurringInterval
  status: SubscriptionStatus
  started_at: string
  /** Stamped only while canceled; cleared on reactivation. */
  canceled_at: string | null
  created_at: string
  updated_at: string
}

export interface SubscriptionInput {
  productId?: string | null
  contactId?: string | null
  name: string
  amountCents: number
  currency?: string
  interval: RecurringInterval
  /** ISO start date; defaults to now() when omitted. */
  startedAt?: string | null
}

export interface SubscriptionPatch {
  contactId?: string | null
  name?: string
  amountCents?: number
  currency?: string
  interval?: RecurringInterval
  status?: SubscriptionStatus
  startedAt?: string | null
}

/**
 * The recurring-commitment ledger for one location (GHL "Payments ->
 * Subscriptions"). A subscription records that a contact is on a recurring
 * arrangement and snapshots the product's name, amount and cadence at the moment
 * it is started, so editing or deleting that product later never disturbs it.
 *
 * This is bookkeeping only: nothing here charges a card or moves money. The repo
 * stores the commitment and its lifecycle; the schedule (next renewal) and MRR
 * are derived from these rows by subscription-math.ts, never stored.
 */
export class SubscriptionsRepo extends LocationScopedRepo {
  list(): Promise<Subscription[]> {
    return this.scopedSelect<Subscription>(
      'SELECT * FROM subscriptions ORDER BY created_at DESC',
    )
  }

  async get(id: string): Promise<Subscription | undefined> {
    const rows = await this.scopedSelect<Subscription>(
      'SELECT * FROM subscriptions WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  /**
   * Start a subscription from snapshot fields. It always begins `active` with no
   * cancel date; `started_at` defaults to now() when not given. The caller (the
   * route) is responsible for copying name/amount/currency/interval off a
   * recurring product before calling this.
   */
  async create(input: SubscriptionInput): Promise<Subscription> {
    const id = nanoid()
    const rows = await this.scopedWrite<Subscription>(
      `INSERT INTO subscriptions (id, location_id, contact_id, product_id, name, amount_cents, currency, billing_interval, status, started_at)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,'active', COALESCE($9, now())) RETURNING *`,
      [
        id,
        input.contactId ?? null,
        input.productId ?? null,
        input.name,
        input.amountCents,
        input.currency ?? 'usd',
        input.interval,
        input.startedAt ?? null,
      ],
    )
    return rows[0]!
  }

  /**
   * Patch a subscription, bumping updated_at. Columns are numbered from $2 ($1 is
   * the location); id is pinned last. Setting status couples `canceled_at`:
   * canceling stamps it, reactivating (active/paused) clears it, so a live row
   * never carries a cancel date. Returns undefined for an empty patch (no query).
   */
  async update(id: string, patch: SubscriptionPatch): Promise<Subscription | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.contactId !== undefined) push('contact_id', patch.contactId)
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.amountCents !== undefined) push('amount_cents', patch.amountCents)
    if (patch.currency !== undefined) push('currency', patch.currency)
    if (patch.interval !== undefined) push('billing_interval', patch.interval)
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt)
    if (patch.status !== undefined) {
      push('status', patch.status)
      // Couple the cancel stamp to the status so it can never disagree.
      sets.push(patch.status === 'canceled' ? 'canceled_at=now()' : 'canceled_at=NULL')
    }
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Subscription>(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete a subscription. Returns true if a row was removed. */
  async remove(id: string): Promise<boolean> {
    const deleted = await this.scopedWrite<{ id: string }>(
      'DELETE FROM subscriptions WHERE location_id=$1 AND id=$2 RETURNING id',
      [id],
    )
    return deleted.length > 0
  }
}
