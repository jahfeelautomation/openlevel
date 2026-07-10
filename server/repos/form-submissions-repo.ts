import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface FormSubmission {
  id: string
  location_id: string
  form_id: string
  contact_id: string | null
  values: Record<string, unknown>
  created_at: string
}

export interface FormSubmissionInput {
  formId: string
  contactId: string | null
  values: Record<string, unknown>
}

/**
 * The stored record of one public form submission — the capability that
 * distinguishes a form from a funnel step (which only counts). The operator
 * submissions viewer reads these back per form. `values` is the raw field map
 * the visitor entered; identity fields also flow onto the linked contact.
 */
export class FormSubmissionsRepo extends LocationScopedRepo {
  async create(input: FormSubmissionInput): Promise<FormSubmission> {
    const id = nanoid()
    const rows = await this.scopedWrite<FormSubmission>(
      `INSERT INTO form_submissions (id, location_id, form_id, contact_id, values)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.formId, input.contactId, JSON.stringify(input.values)],
    )
    return rows[0]!
  }

  listByForm(formId: string): Promise<FormSubmission[]> {
    return this.scopedSelect<FormSubmission>(
      'SELECT * FROM form_submissions WHERE form_id=$2 ORDER BY created_at DESC',
      [formId],
    )
  }
}
