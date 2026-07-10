import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { OperatorsRepo } from '../repos/operators-repo'

/**
 * Enforces that the authenticated operator may access the `:loc` in the path.
 * Must run AFTER operatorAuth. On success sets `locationId` for the location-
 * scoped repos downstream; 401 if unauthenticated, 403 if not a member.
 */
export function locationAccess(db: Database) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const operatorId = c.get('operatorId')
    if (!operatorId) return c.json({ error: 'unauthorized' }, 401)
    const locationId = c.req.param('loc')
    if (!locationId) return c.json({ error: 'location required' }, 400)
    const ok = await new OperatorsRepo(db).hasAccess(operatorId, locationId)
    if (!ok) return c.json({ error: 'forbidden' }, 403)
    c.set('locationId', locationId)
    await next()
  })
}
