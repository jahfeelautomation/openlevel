// Shared surveys vocabulary: the publish states a multi-step survey can be in. A
// plain string union (not a DB enum) so the set can grow without a migration;
// routes validate against this array with Zod and the web UI mirrors the labels.

export const SURVEY_STATUSES = ['draft', 'published'] as const

export type SurveyStatus = (typeof SURVEY_STATUSES)[number]
