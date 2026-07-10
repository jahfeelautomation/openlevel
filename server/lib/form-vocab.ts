// Shared forms vocabulary: the publish states a standalone form can be in. A
// plain string union (not a DB enum) so the set can grow without a migration;
// routes validate against this array with Zod and the web UI mirrors the labels.

export const FORM_STATUSES = ['draft', 'published'] as const

export type FormStatus = (typeof FORM_STATUSES)[number]
