/**
 * Stateless signed session token: `base64url(payload).base64url(hmac)`.
 * HMAC-SHA256 over the payload with SESSION_SECRET; read() verifies the
 * signature in constant time and rejects anything tampered, mis-signed,
 * malformed, or expired. No server-side session store — the cookie is the
 * session. Every token carries an `exp` claim so a stolen or leaked token
 * stops working after its lifetime, even though there is no revocation store.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SessionData {
  operatorId: string
}

/** Default session lifetime. Exported so the cookie maxAge matches the token. */
export const SESSION_TTL_MS = 8 * 60 * 60_000
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000

/** The signed payload: the public data plus issued-at / expiry (epoch ms). */
interface SessionToken extends SessionData {
  iat: number
  exp: number
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSession(
  data: SessionData,
  secret: string,
  opts: { ttlMs?: number; now?: number } = {},
): string {
  const now = opts.now ?? Date.now()
  const ttl = opts.ttlMs ?? SESSION_TTL_MS
  const token: SessionToken = { operatorId: data.operatorId, iat: now, exp: now + ttl }
  const payload = Buffer.from(JSON.stringify(token), 'utf8').toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function readSession(
  token: string | null | undefined,
  secret: string,
  opts: { now?: number } = {},
): SessionData | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  const expected = sign(payload, secret)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { operatorId?: unknown }).operatorId === 'string' &&
      typeof (data as { exp?: unknown }).exp === 'number'
    ) {
      const { operatorId, exp } = data as SessionToken
      const now = opts.now ?? Date.now()
      if (now > exp) return null
      return { operatorId }
    }
    return null
  } catch {
    return null
  }
}
