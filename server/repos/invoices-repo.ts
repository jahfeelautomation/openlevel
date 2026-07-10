import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

/** One billable line. `unit_amount` is in cents, like every money value here. */
export interface InvoiceItem {
  description: string
  quantity: number
  unit_amount: number
}

export interface Invoice {
  id: string
  location_id: string
  contact_id: string | null
  number: string
  status: string
  currency: string
  items: InvoiceItem[]
  notes: string | null
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  payment_method: string | null
  checkout_provider: string | null
  checkout_external_id: string | null
  checkout_url: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceInput {
  number: string
  contactId?: string | null
  status?: InvoiceStatus
  currency?: string
  items?: InvoiceItem[]
  notes?: string | null
  issuedAt?: string | null
  dueAt?: string | null
}

export interface InvoicePatch {
  contactId?: string | null
  number?: string
  currency?: string
  items?: InvoiceItem[]
  notes?: string | null
  dueAt?: string | null
}

/**
 * Invoices for one location. The money total is never stored — it is derived
 * from `items` (see invoice-math.ts) so the line items are the single source of
 * truth and the figure can't drift. Status flows draft -> sent -> paid, with
 * `void` as an escape hatch. `recordPayment` is bookkeeping only: it records
 * that the customer paid, it does not move money.
 */
export class InvoicesRepo extends LocationScopedRepo {
  list(): Promise<Invoice[]> {
    return this.scopedSelect<Invoice>('SELECT * FROM invoices ORDER BY created_at DESC')
  }

  /**
   * Every invoice with a recorded payment, newest payment first. This is the
   * read model behind the Transactions ledger: a paid invoice IS a recorded
   * transaction, so the ledger reads straight off these rows rather than a second
   * money store that could drift. `paid_at IS NOT NULL` is the truth test — only
   * recordPayment ever stamps it.
   */
  listPaid(): Promise<Invoice[]> {
    return this.scopedSelect<Invoice>(
      'SELECT * FROM invoices WHERE paid_at IS NOT NULL ORDER BY paid_at DESC',
    )
  }

  async get(id: string): Promise<Invoice | undefined> {
    const rows = await this.scopedSelect<Invoice>('SELECT * FROM invoices WHERE id=$2', [id])
    return rows[0]
  }

  /**
   * Next human invoice number for this location: INV-1001, INV-1002, ... derived
   * from the count so it reads sequentially. The unique (location, number) index
   * is the real guard against a collision.
   */
  async nextNumber(): Promise<string> {
    const rows = await this.scopedSelect<{ n: number }>('SELECT count(*)::int AS n FROM invoices')
    return `INV-${1001 + Number(rows[0]?.n ?? 0)}`
  }

  async create(input: InvoiceInput): Promise<Invoice> {
    const id = nanoid()
    const rows = await this.scopedWrite<Invoice>(
      `INSERT INTO invoices
         (id, location_id, contact_id, number, status, currency, items, notes, issued_at, due_at)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        input.contactId ?? null,
        input.number,
        input.status ?? 'draft',
        input.currency ?? 'usd',
        JSON.stringify(input.items ?? []),
        input.notes ?? null,
        input.issuedAt ?? null,
        input.dueAt ?? null,
      ],
    )
    return rows[0]!
  }

  /**
   * Patch only the provided columns (items is json-encoded). Dynamic SET from
   * $2, always bumps updated_at, id pinned last. Returns undefined when nothing
   * was provided (no query issued). Status changes go through the dedicated
   * transition methods below, not here.
   */
  async update(id: string, patch: InvoicePatch): Promise<Invoice | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.contactId !== undefined) push('contact_id', patch.contactId)
    if (patch.number !== undefined) push('number', patch.number)
    if (patch.currency !== undefined) push('currency', patch.currency)
    if (patch.items !== undefined) push('items', JSON.stringify(patch.items))
    if (patch.notes !== undefined) push('notes', patch.notes)
    if (patch.dueAt !== undefined) push('due_at', patch.dueAt)
    if (sets.length === 0) return undefined

    sets.push('updated_at=now()')
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Invoice>(
      `UPDATE invoices SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Move a draft to sent; stamp issued_at the first time only. */
  async markSent(id: string): Promise<Invoice | undefined> {
    const rows = await this.scopedWrite<Invoice>(
      `UPDATE invoices SET status='sent', issued_at=COALESCE(issued_at, now()), updated_at=now()
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  /**
   * Record that the customer paid. This is operator bookkeeping — OpenLevel
   * never charges a card or moves money; it only writes down what happened.
   */
  async recordPayment(id: string, method: string): Promise<Invoice | undefined> {
    const rows = await this.scopedWrite<Invoice>(
      `UPDATE invoices SET status='paid', paid_at=now(), payment_method=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [method, id],
    )
    return rows[0]
  }

  /**
   * Persist the hosted checkout link minted inside the location's own processor
   * account. The external id (Stripe session id / Square order id) is what the
   * payment webhook correlates against later.
   */
  async setCheckoutLink(
    id: string,
    provider: string,
    externalId: string,
    url: string,
  ): Promise<Invoice | undefined> {
    const rows = await this.scopedWrite<Invoice>(
      `UPDATE invoices SET checkout_provider=$2, checkout_external_id=$3, checkout_url=$4, updated_at=now()
       WHERE location_id=$1 AND id=$5 RETURNING *`,
      [provider, externalId, url, id],
    )
    return rows[0]
  }

  /** The invoice a processor webhook refers to, by its correlation id (scoped —
   *  the webhook URL names the location, so a foreign id can never match). */
  async findByCheckoutExternalId(externalId: string): Promise<Invoice | undefined> {
    const rows = await this.scopedSelect<Invoice>(
      'SELECT * FROM invoices WHERE checkout_external_id=$2',
      [externalId],
    )
    return rows[0]
  }

  async setStatus(id: string, status: InvoiceStatus): Promise<Invoice | undefined> {
    const rows = await this.scopedWrite<Invoice>(
      `UPDATE invoices SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }
}
