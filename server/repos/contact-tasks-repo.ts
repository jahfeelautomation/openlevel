import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface ContactTask {
  id: string
  location_id: string
  contact_id: string
  title: string
  body: string | null
  due_at: string | null
  /** NULL means open; a timestamp means done. */
  completed_at: string | null
  created_at: string
  updated_at: string
}

/** A task plus the name of the contact it hangs off, for the cross-contact worklist. */
export interface ContactTaskWithContact extends ContactTask {
  contact_name: string | null
}

export interface ContactTaskInput {
  contactId: string
  title: string
  body?: string | null
  dueAt?: string | null
}

/**
 * Patch a task's editable fields. Omitted keys are left untouched. `completed`
 * is a toggle, not a stored column: true stamps completed_at=now(), false clears
 * it back to NULL (re-opening the task).
 */
export interface ContactTaskPatch {
  title?: string
  body?: string | null
  dueAt?: string | null
  completed?: boolean
}

/**
 * Operator to-dos attached to a contact (the GHL "Tasks" panel + global worklist).
 * Both lists share an ordering: open tasks float above done ones; within that, the
 * soonest due comes first and undated tasks sink to the bottom, newest as a tiebreak.
 */
export class ContactTasksRepo extends LocationScopedRepo {
  /** All tasks for one contact, open-first. */
  listByContact(contactId: string): Promise<ContactTask[]> {
    return this.scopedSelect<ContactTask>(
      `SELECT * FROM contact_tasks WHERE contact_id=$2
       ORDER BY (completed_at IS NOT NULL), due_at ASC NULLS LAST, created_at DESC`,
      [contactId],
    )
  }

  /**
   * Every task in the location with its contact name attached, open-first. Uses a
   * JOIN, so it goes through db.query directly (the base-repo escape hatch) while
   * still filtering on this.locationId as $1.
   */
  listForLocation(): Promise<ContactTaskWithContact[]> {
    return this.db.query<ContactTaskWithContact>(
      `SELECT t.*, c.name AS contact_name
         FROM contact_tasks t
         JOIN contacts c ON c.id = t.contact_id
        WHERE t.location_id = $1
        ORDER BY (t.completed_at IS NOT NULL), t.due_at ASC NULLS LAST, t.created_at DESC`,
      [this.locationId],
    )
  }

  async create(input: ContactTaskInput): Promise<ContactTask> {
    const id = nanoid()
    const rows = await this.scopedWrite<ContactTask>(
      `INSERT INTO contact_tasks (id, location_id, contact_id, title, body, due_at)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.contactId, input.title, input.body ?? null, input.dueAt ?? null],
    )
    return rows[0]!
  }

  /**
   * Patch title/body/due_at and/or toggle completion, bumping updated_at. Bound
   * columns are numbered from $2 ($1 is the location); the `completed` toggle is
   * written as a SQL literal (now() / NULL), so it consumes no param. contact_id
   * then id are pinned last — scoping to contact_id (not just id) means a task can
   * only be edited through the contact it actually belongs to, so reaching it via
   * another contact's URL 404s. Returns undefined when nothing was provided (no
   * query issued).
   */
  async update(
    contactId: string,
    id: string,
    patch: ContactTaskPatch,
  ): Promise<ContactTask | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.title !== undefined) push('title', patch.title)
    if (patch.body !== undefined) push('body', patch.body)
    if (patch.dueAt !== undefined) push('due_at', patch.dueAt)
    if (patch.completed !== undefined) {
      sets.push(patch.completed ? 'completed_at=now()' : 'completed_at=NULL')
    }
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')

    extra.push(contactId)
    const contactParam = extra.length + 1
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<ContactTask>(
      `UPDATE contact_tasks SET ${sets.join(', ')} WHERE location_id=$1 AND contact_id=$${contactParam} AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Delete one task, scoped to location + contact + id — a task can only be
   *  deleted through the contact it belongs to. Returns true if a row was removed. */
  async remove(contactId: string, id: string): Promise<boolean> {
    const rows = await this.scopedWrite<{ id: string }>(
      'DELETE FROM contact_tasks WHERE location_id=$1 AND contact_id=$2 AND id=$3 RETURNING id',
      [contactId, id],
    )
    return rows.length > 0
  }
}
