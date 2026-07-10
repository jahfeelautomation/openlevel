/**
 * One-off ops tool: rotate an operator's password in place.
 * The seed hardcodes a demo password; this replaces it before the app is
 * exposed on a public URL. Inputs come from env (never argv — argv leaks
 * into `ps` output and shell history on the host):
 *
 *   ROTATE_OPERATOR_ID=op_AL ROTATE_NEW_PASSWORD='...' npx tsx scripts/rotate-op-password.ts
 *
 * Refuses passwords under 12 chars. Prints the operator id/email on success,
 * never the password.
 */
import { Pool } from 'pg'
import { hashPassword } from '../server/lib/password'

const url = process.env.DATABASE_URL
const operatorId = process.env.ROTATE_OPERATOR_ID
const newPassword = process.env.ROTATE_NEW_PASSWORD

if (!url) throw new Error('DATABASE_URL required')
if (!operatorId) throw new Error('ROTATE_OPERATOR_ID required')
if (!newPassword || newPassword.length < 12) {
  throw new Error('ROTATE_NEW_PASSWORD required (12+ chars)')
}

const pool = new Pool({ connectionString: url })
const hash = await hashPassword(newPassword)
const res = await pool.query<{ email: string }>(
  `UPDATE operators SET password_hash = $1 WHERE id = $2 RETURNING email`,
  [hash, operatorId],
)
if (res.rowCount !== 1) {
  await pool.end()
  throw new Error(`operator ${operatorId} not found — nothing rotated`)
}
console.log(`rotated password for ${operatorId} (${res.rows[0].email})`)
await pool.end()

