/**
 * Recognise a Postgres unique-constraint violation across both backends we run.
 * node-postgres (prod) and PGlite (dev/tests) each surface SQLSTATE 23505 as
 * `err.code`, so the code check is the reliable path; a message match is a
 * belt-and-suspenders fallback for any wrapper that loses the code. We return
 * false for every other error so callers RETHROW it — a real fault must never be
 * masked as a benign conflict.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if ((err as { code?: unknown }).code === '23505') return true
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && /duplicate key value|unique constraint/i.test(message)
}
