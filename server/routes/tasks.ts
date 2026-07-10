import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { summarizeTasks } from '../lib/task-math'
import { ContactTasksRepo } from '../repos/contact-tasks-repo'

/**
 * The cross-contact task worklist (the GHL global "Tasks" page). Returns every
 * task in the location with its contact name attached, open-first, plus a KPI
 * summary computed live from those same rows so the band can never disagree with
 * the list. Read-only aggregation — task writes go through the nested
 * /contacts/:id/tasks routes. Mounted behind operatorAuth + locationAccess.
 */
export function tasksRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    const tasks = await new ContactTasksRepo(deps.db, loc).listForLocation()
    const summary = summarizeTasks(tasks, new Date())
    return c.json({ tasks, summary })
  })

  return app
}
