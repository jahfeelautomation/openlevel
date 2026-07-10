import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface ContactNote {
  id: string
  location_id: string
  contact_id: string
  body: string
  author: string | null
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface ContactNoteInput {
  contactId: string
  body: string
  author?: string | null
}

/** Patch a note's editable fields. Omitted keys are left untouched. */
export interface ContactNotePatch {
  body?: string
  pinned?: boolean
}

/**
 * Free-text notes pinned to a contact record (the GHL "Notes" panel). Pinned
 * notes float to the top of the list; within a pin group, newest first.
 */
export class ContactNotesRepo extends LocationScopedRepo {
  /** All notes for one contact: pinned first, then newest first. */
  listByContact(contactId: string): Promise<ContactNote[]> {
    return this.scopedSelect<ContactNote>(
      'SELECT * FROM contact_notes WHERE contact_id=$2 ORDER BY pinned DESC, created_at DESC',
      [contactId],
    )
  }

  async create(input: ContactNoteInput): Promise<ContactNote> {
    const id = nanoid()
    const rows = await this.scopedWrite<ContactNote>(
      `INSERT INTO contact_notes (id, location_id, contact_id, body, author)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.contactId, input.body, input.author ?? null],
    )
    return rows[0]!
  }

  /**
   * Patch body and/or pinned, bumping updated_at. Dynamic SET numbered from $2
   * ($1 is the location), with contact_id then id pinned last. Scoping to
   * contact_id (not just id) means a note can only be edited through the contact
   * it actually belongs to — reaching it via another contact's URL 404s instead
   * of silently editing a note that contact doesn't own. Returns undefined when
   * nothing was provided (no query issued).
   */
  async update(
    contactId: string,
    id: string,
    patch: ContactNotePatch,
  ): Promise<ContactNote | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.body !== undefined) push('body', patch.body)
    if (patch.pinned !== undefined) push('pinned', patch.pinned)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(contactId)
    const contactParam = extra.length + 1
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<ContactNote>(
      `UPDATE contact_notes SET ${sets.join(', ')} WHERE location_id=$1 AND contact_id=$${contactParam} AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete one note, scoped to location + contact + id — a note can only be
   *  deleted through the contact it belongs to. Returns true if a row was removed. */
  async remove(contactId: string, id: string): Promise<boolean> {
    const rows = await this.scopedWrite<{ id: string }>(
      'DELETE FROM contact_notes WHERE location_id=$1 AND contact_id=$2 AND id=$3 RETURNING id',
      [contactId, id],
    )
    return rows.length > 0
  }
}
