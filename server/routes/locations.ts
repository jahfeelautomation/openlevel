import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { OperatorsRepo } from '../repos/operators-repo'

/**
 * Lists the locations the authenticated operator may access. Mounted behind
 * operatorAuth, so `operatorId` is always set. This is the source for the
 * LocationSwitcher in the UI.
 */
export function locationsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    const locations = await new OperatorsRepo(deps.db).listLocations(c.get('operatorId'))
    return c.json({ locations })
  })
  return app
}
