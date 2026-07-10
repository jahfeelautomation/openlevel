import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { PGlite } from '@electric-sql/pglite'
import { seedDatabase } from '../db/seed'
import { PgliteDatabase } from './db/pglite-database'
import { createApp } from './index'
import type { ClaudeClient } from './jobs/agent-reply'
import { dispatchWorkflowEvent } from './jobs/workflow-dispatcher'
import { runWorkflow } from './jobs/workflow-runner'
import type { sendChatwootMessage } from './lib/chatwoot-client'

/**
 * Local dev server. Runs the whole app against in-process PGlite (real Postgres,
 * no Docker) and stubs the two outbound integrations so everything works offline
 * with no API key and no network:
 *   - Claude drafts are canned (clearly marked) for the "Draft from agent" button
 *   - the Chatwoot sender is a no-op that returns a fake external id, so the
 *     operator composer persists outbound messages without a live Chatwoot
 *
 * Production (server/index.ts) wires the real Anthropic + Chatwoot clients and a
 * real Postgres. This file is dev-only and never imported by tests.
 *
 *   npm run dev:local   # this server on :8790
 *   npm run dev         # vite frontend on :5273, proxying /api here
 */

const SCHEMA = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8')

const devClaude: ClaudeClient = {
  // The engine speaks createMessage now. This stub never emits tool_use, so the
  // tool loop returns its single text block — a canned, clearly-marked reply that
  // echoes the customer's latest message. Real Anthropic + tools run in prod.
  createMessage: async ({ messages }) => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const ask = typeof lastUser?.content === 'string' ? lastUser.content.trim() : ''
    const text =
      `Thanks for reaching out${ask ? ` about "${ask.slice(0, 50)}${ask.length > 50 ? '…' : ''}"` : ''}! ` +
      `I'd love to help. What's the best number and time to reach you? — Jamal`
    return { stopReason: 'end_turn', content: [{ type: 'text', text }] }
  },
}

let sentCount = 0
const devSendMessage: typeof sendChatwootMessage = async () => {
  sentCount += 1
  return { externalId: `dev-out-${sentCount}` }
}

/**
 * Drive the seeded live "New lead welcome" workflow through the real engine for
 * the first few seed contacts, so the Automations runs panel opens onto genuine
 * execution history (each run really tags the contact + logs the first-touch
 * SMS). Dev-only; prod fires workflows on real trigger events instead.
 */
async function prerunWelcomeWorkflow(db: PgliteDatabase): Promise<void> {
  const locationId = 'loc_jamal'
  const [workflow] = await db.query<{ id: string }>(
    "SELECT id FROM workflows WHERE location_id = $1 AND name = 'New lead welcome' LIMIT 1",
    [locationId],
  )
  if (!workflow) return
  const contacts = await db.query<{ id: string }>(
    'SELECT id FROM contacts WHERE location_id = $1 ORDER BY created_at LIMIT 3',
    [locationId],
  )
  for (const contact of contacts) {
    await runWorkflow(
      { db },
      { locationId, workflowId: workflow.id, contactId: contact.id, triggerType: 'contact_created' },
    )
  }
}

async function main() {
  const pg = new PGlite() // in-memory; fresh on every boot
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)

  // Dev secrets so the env-backed resolveSecret() finds them by name.
  process.env.JAMAL_ANTHROPIC_API_KEY ||= 'dev-stub-anthropic-key'
  process.env.JAMAL_CHATWOOT_API_TOKEN ||= 'dev-stub-chatwoot-token'

  await seedDatabase(db)
  await prerunWelcomeWorkflow(db)

  const app = createApp({
    db,
    sessionSecret: 'dev-only-change-me',
    webhookSecret: 'dev-secret',
    secure: false,
    claude: devClaude,
    sendMessage: devSendMessage,
    // No pg-boss against pglite — run the dispatch in-process so triggers fire
    // (and `wait` steps defer via the runner's default setTimeout) right here.
    dispatch: async (e) => {
      await dispatchWorkflowEvent({ db }, e)
    },
  })

  const port = 8790
  serve({ fetch: app.fetch, port })
  console.log(`openlevel DEV api (pglite, in-memory) listening on :${port}`)
  console.log('login: admin@acmecorp.com / openlevel')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

