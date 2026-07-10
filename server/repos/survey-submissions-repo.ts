import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface SurveySubmission {
  id: string
  location_id: string
  survey_id: string
  contact_id: string | null
  values: Record<string, unknown>
  created_at: string
}

export interface SurveySubmissionInput {
  surveyId: string
  contactId: string | null
  values: Record<string, unknown>
}

/**
 * The stored record of one completed public survey — the full raw answer map the
 * visitor entered across every step. The operator submissions viewer reads these
 * back per survey; identity answers also flow onto the linked contact. Mirrors
 * form_submissions, the form's distinguishing capability.
 */
export class SurveySubmissionsRepo extends LocationScopedRepo {
  async create(input: SurveySubmissionInput): Promise<SurveySubmission> {
    const id = nanoid()
    const rows = await this.scopedWrite<SurveySubmission>(
      `INSERT INTO survey_submissions (id, location_id, survey_id, contact_id, values)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.surveyId, input.contactId, JSON.stringify(input.values)],
    )
    return rows[0]!
  }

  listBySurvey(surveyId: string): Promise<SurveySubmission[]> {
    return this.scopedSelect<SurveySubmission>(
      'SELECT * FROM survey_submissions WHERE survey_id=$2 ORDER BY created_at DESC',
      [surveyId],
    )
  }
}
