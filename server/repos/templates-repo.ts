import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Template {
  id: string
  location_id: string
  name: string
  /** 'email' | 'sms' (text column so future channels need no migration). */
  channel: string
  /** Email subject line; NULL for SMS templates. */
  subject: string | null
  body: string
  created_at: string
  updated_at: string
}

export interface TemplateInput {
  name: string
  channel?: string
  subject?: string | null
  body: string
}

/** Patch a template's editable fields. Omitted keys are left untouched. */
export interface TemplatePatch {
  name?: string
  channel?: string
  subject?: string | null
  body?: string
}

/**
 * The reusable message-template library for one location (GHL "Templates"):
 * named email/SMS snippets with merge fields. Newest first, so a freshly saved
 * template lands at the top of the list.
 */
export class TemplatesRepo extends LocationScopedRepo {
  list(): Promise<Template[]> {
    return this.scopedSelect<Template>('SELECT * FROM templates ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Template | undefined> {
    const rows = await this.scopedSelect<Template>('SELECT * FROM templates WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: TemplateInput): Promise<Template> {
    const id = nanoid()
    const rows = await this.scopedWrite<Template>(
      `INSERT INTO templates (id, location_id, name, channel, subject, body)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.channel ?? 'email', input.subject ?? null, input.body],
    )
    return rows[0]!
  }

  /**
   * Patch name/channel/subject/body, bumping updated_at. Bound columns are
   * numbered from $2 ($1 is the location); id is pinned last. Returns undefined
   * when nothing was provided (no query issued).
   */
  async update(id: string, patch: TemplatePatch): Promise<Template | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.channel !== undefined) push('channel', patch.channel)
    if (patch.subject !== undefined) push('subject', patch.subject)
    if (patch.body !== undefined) push('body', patch.body)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Template>(
      `UPDATE templates SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete one template, location-scoped. Returns true if a row was removed. */
  async remove(id: string): Promise<boolean> {
    const rows = await this.scopedWrite<{ id: string }>(
      'DELETE FROM templates WHERE location_id=$1 AND id=$2 RETURNING id',
      [id],
    )
    return rows.length > 0
  }
}
