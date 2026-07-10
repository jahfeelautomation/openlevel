import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../app-env'
import { readSession } from '../lib/session'

export const SESSION_COOKIE = 'ol_session'

/**
 * Operator session guard. Reads the signed session cookie; on a valid signature
 * sets `operatorId` for downstream handlers, otherwise short-circuits with 401.
 */
export function operatorAuth(secret: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization')
    let token = getCookie(c, SESSION_COOKIE)
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length)
    }

    const session = readSession(token, secret)
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    c.set('operatorId', session.operatorId)
    await next()
  })
}
