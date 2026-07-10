import { nanoid } from 'nanoid'
import type { ProductType, RecurringInterval } from '../lib/product-math'
import { LocationScopedRepo } from './base-repo'

export interface Product {
  id: string
  location_id: string
  name: string
  description: string | null
  /** Default price in integer cents. pg returns bigint as a string and PGlite as
   *  a number; the catalog only ever displays it (never sums), so it is typed as
   *  a number and trusted from the driver, the same as opportunities.value_cents. */
  price_cents: number
  currency: string
  type: ProductType
  /** day|week|month|year for a recurring product, NULL for a one_time one. */
  recurring_interval: RecurringInterval | null
  /** active products show in the picker; archived ones are retired but kept so a
   *  document already built from them is never disturbed. */
  status: 'active' | 'archived'
  position: number
  created_at: string
  updated_at: string
}

export interface ProductInput {
  name: string
  description?: string | null
  priceCents?: number
  currency?: string
  type?: string
  recurringInterval?: string | null
}

export interface ProductPatch {
  name?: string
  description?: string | null
  priceCents?: number
  currency?: string
  type?: string
  recurringInterval?: string | null
  status?: string
  position?: number
}

/**
 * The reusable product/service catalog for one location (GHL "Payments →
 * Products"): the saved items an invoice or proposal can be built from instead
 * of retyping a price. A product is either a one_time charge or a recurring
 * subscription; when recurring it carries a billing interval, and a one_time
 * product is always stored with a NULL interval so a stray cadence can never
 * leak into how its price reads. Documents copy a line's text and amount at the
 * moment they are built, so archiving or deleting a product never alters a
 * document already created from it.
 */
export class ProductsRepo extends LocationScopedRepo {
  list(): Promise<Product[]> {
    return this.scopedSelect<Product>(
      'SELECT * FROM products ORDER BY position ASC, created_at ASC',
    )
  }

  async get(id: string): Promise<Product | undefined> {
    const rows = await this.scopedSelect<Product>('SELECT * FROM products WHERE id=$2', [id])
    return rows[0]
  }

  /**
   * Create a product, landing it last (position = current max + 1). The type is
   * normalised to one_time unless explicitly recurring; a recurring product
   * defaults to a monthly interval when none is given, and a one_time product is
   * always stored with a NULL interval even if one was passed.
   */
  async create(input: ProductInput): Promise<Product> {
    const existing = await this.scopedSelect<{ position: number }>('SELECT position FROM products')
    const position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1

    const type: ProductType = input.type === 'recurring' ? 'recurring' : 'one_time'
    const recurringInterval = type === 'recurring' ? (input.recurringInterval ?? 'month') : null

    const id = nanoid()
    const rows = await this.scopedWrite<Product>(
      `INSERT INTO products (id, location_id, name, description, price_cents, currency, type, recurring_interval, position)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.name,
        input.description ?? null,
        input.priceCents ?? 0,
        input.currency ?? 'usd',
        type,
        recurringInterval,
        position,
      ],
    )
    return rows[0]!
  }

  /**
   * Patch a product, bumping updated_at. Columns are numbered from $2 ($1 is the
   * location); id is pinned last. Switching the type to one_time also clears the
   * interval, and switching to recurring sets one (the explicit value, else a
   * monthly default), so a product's type and cadence can never disagree.
   * Returns undefined when nothing was provided (no query issued).
   */
  async update(id: string, patch: ProductPatch): Promise<Product | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.description !== undefined) push('description', patch.description)
    if (patch.priceCents !== undefined) push('price_cents', patch.priceCents)
    if (patch.currency !== undefined) push('currency', patch.currency)
    if (patch.type !== undefined) {
      push('type', patch.type)
      if (patch.type === 'recurring') push('recurring_interval', patch.recurringInterval ?? 'month')
      else push('recurring_interval', null)
    } else if (patch.recurringInterval !== undefined) {
      push('recurring_interval', patch.recurringInterval)
    }
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Product>(
      `UPDATE products SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete a product. Returns true if a row was removed. A document already
   *  built from it is unaffected, because it copied the line at build time. */
  async remove(id: string): Promise<boolean> {
    const deleted = await this.scopedWrite<{ id: string }>(
      'DELETE FROM products WHERE location_id=$1 AND id=$2 RETURNING id',
      [id],
    )
    return deleted.length > 0
  }
}
