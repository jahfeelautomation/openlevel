import { nanoid } from 'nanoid'
import { customFieldKey } from '../lib/custom-field-key'
import { uniqueKey } from '../lib/slug-key'
import { LocationScopedRepo } from './base-repo'

/** Postgres unique_violation. A concurrent create that grabbed the same slug
 *  trips the custom_fields_key index; create() re-reads and retries rather than
 *  surfacing a 500. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

export interface CustomField {
  id: string
  location_id: string
  /** Stable slug used as the jsonb key in contacts.custom_fields. Never changes. */
  key: string
  label: string
  /** One of CUSTOM_FIELD_TYPES (text column, no migration to add a type). */
  type: string
  /** Choices for a 'dropdown' field; empty for every other type. */
  options: string[]
  placeholder: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface CustomFieldInput {
  label: string
  type?: string
  options?: string[]
  placeholder?: string | null
}

/** Patch a definition's editable attributes. The `key` is intentionally absent —
 *  it is immutable so stored contact values never orphan. */
export interface CustomFieldPatch {
  label?: string
  type?: string
  options?: string[]
  placeholder?: string | null
  position?: number
}

/**
 * The custom-field *definitions* for one location (GHL "Custom Fields"
 * settings). Ordered by `position` so the operator's arrangement is the order
 * shown on a contact. Definitions live here; the per-contact values live in
 * contacts.custom_fields keyed by each definition's `key`.
 */
export class CustomFieldsRepo extends LocationScopedRepo {
  list(): Promise<CustomField[]> {
    return this.scopedSelect<CustomField>(
      'SELECT * FROM custom_fields ORDER BY position ASC, created_at ASC',
    )
  }

  async get(id: string): Promise<CustomField | undefined> {
    const rows = await this.scopedSelect<CustomField>('SELECT * FROM custom_fields WHERE id=$2', [id])
    return rows[0]
  }

  /** Look up a definition by its stable key (used when setting a contact value
   *  so the value can be coerced by the field's declared type). */
  async getByKey(key: string): Promise<CustomField | undefined> {
    const rows = await this.scopedSelect<CustomField>('SELECT * FROM custom_fields WHERE key=$2', [
      key,
    ])
    return rows[0]
  }

  /**
   * Create a definition. The key is slugified from the label and made unique
   * within the location (a collision appends _2, _3, …); the new field lands
   * last (position = current max + 1).
   *
   * The read-then-write races: two concurrent creates read the same key set,
   * compute the same slug, and the loser trips the custom_fields_key unique
   * index (23505). Rather than surface that as a 500, re-read the now-committed
   * keys and retry with a freshly-deduped slug. Bounded so a genuinely-stuck
   * insert (a different constraint, a real bug) surfaces instead of spinning.
   */
  async create(input: CustomFieldInput): Promise<CustomField> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.scopedSelect<{ key: string; position: number }>(
        'SELECT key, position FROM custom_fields',
      )
      const taken = new Set(existing.map((r) => r.key))
      const key = uniqueKey(customFieldKey(input.label), taken)
      const position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1

      const id = nanoid()
      try {
        const rows = await this.scopedWrite<CustomField>(
          `INSERT INTO custom_fields (id, location_id, key, label, type, options, placeholder, position)
           VALUES ($2,$1,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            id,
            key,
            input.label,
            input.type ?? 'text',
            JSON.stringify(input.options ?? []),
            input.placeholder ?? null,
            position,
          ],
        )
        return rows[0]!
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        lastError = err
      }
    }
    throw lastError
  }

  /**
   * Patch label/type/options/placeholder/position, bumping updated_at. Columns
   * are numbered from $2 ($1 is the location); id is pinned last. Returns
   * undefined when nothing was provided (no query issued).
   */
  async update(id: string, patch: CustomFieldPatch): Promise<CustomField | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.label !== undefined) push('label', patch.label)
    if (patch.type !== undefined) push('type', patch.type)
    if (patch.options !== undefined) push('options', JSON.stringify(patch.options))
    if (patch.placeholder !== undefined) push('placeholder', patch.placeholder)
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<CustomField>(
      `UPDATE custom_fields SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /**
   * Delete a definition and strip its key from every contact's value bag, so no
   * orphaned ghost values linger. Returns true if a definition was removed.
   */
  async remove(id: string): Promise<boolean> {
    const deleted = await this.scopedWrite<{ key: string }>(
      'DELETE FROM custom_fields WHERE location_id=$1 AND id=$2 RETURNING key',
      [id],
    )
    const row = deleted[0]
    if (!row) return false
    await this.scopedWrite(
      'UPDATE contacts SET custom_fields = custom_fields - $2 WHERE location_id=$1',
      [row.key],
    )
    return true
  }
}
