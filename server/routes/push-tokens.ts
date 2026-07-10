import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'

export function pushTokensRoute(deps: { db: Database }) {
  const app = new Hono<AppEnv>()

  app.post(
    '/',
    zValidator(
      'json',
      z.object({
        token: z.string(),
        platform: z.enum(['ios', 'android', 'web']).optional(),
      }),
    ),
    async (c) => {
      const operatorId = c.get('operatorId')
      const { token, platform } = c.req.valid('json')

      // Upsert push token for this operator
      await deps.db.query(
        `
        INSERT INTO push_tokens (id, operator_id, token, platform)
        VALUES (gen_random_uuid()::text, $1, $2, $3)
        ON CONFLICT (token) DO UPDATE SET
          operator_id = EXCLUDED.operator_id,
          platform = EXCLUDED.platform,
          updated_at = now()
        `,
        [operatorId, token, platform]
      )

      return c.json({ ok: true })
    },
  )

  app.delete(
    '/:token',
    async (c) => {
      const operatorId = c.get('operatorId')
      const token = c.req.param('token')

      await deps.db.query(
        `DELETE FROM push_tokens WHERE operator_id = $1 AND token = $2`,
        [operatorId, token]
      )

      return c.json({ ok: true })
    }
  )

  return app
}
