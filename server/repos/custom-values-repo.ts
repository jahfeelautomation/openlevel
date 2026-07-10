import { nanoid } from 'nanoid'
import { customValueKey } from '../lib/custom-values'
import { uniqueKey } from '../lib/slug-key'
import { LocationScopedRepo } from './base-repo'

export interface CustomValue {
  id: string
  location_id: string
  /** Stable merge slug, e.g. `business_name` in {{custom_values.business_name}}.
   *  Never changes, so a token already placed in a template keeps resolving. */
  key: string
  name: string
  value: string
  position: number
  created_at: string
  updated_at: string
}

export interface CustomValueInput {
  name: string
  value?: string
}

/** Patch a value's editable attributes. The `key` is intentionally absent — it
 *  is immutable so tokens already placed in templates never orphan. */
export interface CustomValuePatch {
  name?: string
  value?: string
  position?: number
}

/**
 * The custom *values* for one location (GHL "Custom Values"): location-level
 * constants the operator references as {{custom_values.<key>}} merge tags.
 * Exactly one value per key per location — there are no per-contact rows, so
 * deleting one needs no fan-out cleanup; a template that still references it
 * simply renders the token verbatim again.
 */
export class CustomValuesRepo extends LocationScopedRepo {
  list(): Promise<CustomValue[]> {
    return this.scopedSelect<CustomValue>(
      'SELECT * FROM custom_values ORDER BY position ASC, created_at ASC',
    )
  }

  async get(id: string): Promise<CustomValue | undefined> {
    const rows = await this.scopedSelect<CustomValue>('SELECT * FROM custom_values WHERE id=$2', [id])
    return rows[0]
  }

  /** Look up by stable key (used when validating a token or seeding). */
  async getByKey(key: string): Promise<CustomValue | undefined> {
    const rows = await this.scopedSelect<CustomValue>('SELECT * FROM custom_values WHERE key=$2', [
      key,
    ])
    return rows[0]
  }

  /** Every value as a key→value map, the shape renderTemplate() consumes for the
   *  location's merge tags. */
  async map(): Promise<Record<string, string>> {
    const rows = await this.list()
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  }

  /**
   * Create a value. The key is slugified from the name and made unique within
   * the location (a collision appends _2, _3, …); the new value lands last
   * (position = current max + 1).
   */
  async create(input: CustomValueInput): Promise<CustomValue> {
    const existing = await this.scopedSelect<{ key: string; position: number }>(
      'SELECT key, position FROM custom_values',
    )
    const taken = new Set(existing.map((r) => r.key))
    const key = uniqueKey(customValueKey(input.name), taken)
    const position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1

    const id = nanoid()
    const rows = await this.scopedWrite<CustomValue>(
      `INSERT INTO custom_values (id, location_id, key, name, value, position)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, key, input.name, input.value ?? '', position],
    )
    return rows[0]!
  }

  /**
   * Patch name/value/position, bumping updated_at. Columns are numbered from $2
   * ($1 is the location); id is pinned last. Returns undefined when nothing was
   * provided (no query issued).
   */
  async update(id: string, patch: CustomValuePatch): Promise<CustomValue | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.value !== undefined) push('value', patch.value)
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<CustomValue>(
      `UPDATE custom_values SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete a value. Returns true if a row was removed. */
  async remove(id: string): Promise<boolean> {
    const deleted = await this.scopedWrite<{ id: string }>(
      'DELETE FROM custom_values WHERE location_id=$1 AND id=$2 RETURNING id',
      [id],
    )
    return deleted.length > 0
  }
}
