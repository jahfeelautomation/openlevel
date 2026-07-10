import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Pool } from 'pg'
import type { AppEnv } from './app-env'
import { PgDatabase } from './db/database'
import type { Database } from './db/database'
import type { ClaudeClient } from './jobs/agent-reply'
import {
  enqueueAgentReply,
  enqueueWorkflowEvent,
  registerAgentReplyWorker,
  registerWorkflowDispatchWorker,
  startBoss,
} from './jobs/boss'
import type { WorkflowDispatch } from './jobs/workflow-dispatcher'
import { createAnthropicClient } from './lib/anthropic'
import type { sendChatwootMessage } from './lib/chatwoot-client'
import { loadConfig } from './lib/config'
import { notifyPush } from './lib/notify-push'
import type { SendTextFn } from './lib/operator-tools'
import { makeHttpSendText } from './lib/send-text-rail'
import { operatorAuth } from './middleware/auth'
import { locationAccess } from './middleware/location-access'
import { affiliatesRoute } from './routes/affiliates'
import { assistantRoute } from './routes/assistant'
import { authRoute } from './routes/auth'
import { blogRoute } from './routes/blog'
import { calendarsRoute } from './routes/calendars'
import { callsRoute } from './routes/calls'
import { campaignsRoute } from './routes/campaigns'
import { communitiesRoute } from './routes/communities'
import { contactsRoute } from './routes/contacts'
import { conversationsRoute } from './routes/conversations'
import { coursesRoute } from './routes/courses'
import { customFieldsRoute } from './routes/custom-fields'
import { customValuesRoute } from './routes/custom-values'
import { federationRoute } from './routes/federation'
import { formsRoute } from './routes/forms'
import { funnelsRoute } from './routes/funnels'
import { invoicesRoute } from './routes/invoices'
import { locationsRoute } from './routes/locations'
import { opportunitiesRoute } from './routes/opportunities'
import { couponsRoute } from './routes/coupons'
import { pipelinesRoute } from './routes/pipelines'
import { productsRoute } from './routes/products'
import { proposalsRoute } from './routes/proposals'
import { pushTokensRoute } from './routes/push-tokens'
import { settingsRoute } from './routes/settings'
import { subscriptionsRoute } from './routes/subscriptions'
import { transactionsRoute } from './routes/transactions'
import { publicAffiliatesRoute } from './routes/public-affiliates'
import { publicBlogRoute } from './routes/public-blog'
import { publicBookingRoute } from './routes/public-booking'
import { publicCommunitiesRoute } from './routes/public-communities'
import { publicCoursesRoute } from './routes/public-courses'
import { publicFormsRoute } from './routes/public-forms'
import { publicFunnelsRoute } from './routes/public-funnels'
import { publicProposalsRoute } from './routes/public-proposals'
import { publicReviewsRoute } from './routes/public-reviews'
import { publicSurveysRoute } from './routes/public-surveys'
import { publicTriggerLinksRoute } from './routes/public-trigger-links'
import { reportingRoute } from './routes/reporting'
import { reviewsRoute } from './routes/reviews'
import { socialRoute } from './routes/social'
import { surveysRoute } from './routes/surveys'
import { tagsRoute } from './routes/tags'
import { tasksRoute } from './routes/tasks'
import { templatesRoute } from './routes/templates'
import { triggerLinksRoute } from './routes/trigger-links'
import { type InboundEvent, chatwootWebhookRoute } from './routes/webhooks-chatwoot'
import { paymentsWebhookRoute } from './routes/webhooks-payments'
import { voiceWebhookRoute } from './routes/webhooks-voice'
import { workflowsRoute } from './routes/workflows'

export interface AppDeps {
  db: Database
  sessionSecret: string
  webhookSecret: string
  /** Set Secure on the session cookie (true in production over HTTPS). */
  secure?: boolean
  /** Phase E hook: enqueue the agent-reply job after a fresh inbound. */
  onInbound?: (e: InboundEvent) => void | Promise<void>
  /** Phase 7 hook: fan a trigger event out to its live workflows. */
  dispatch?: WorkflowDispatch
  /** Claude client for the "Draft from agent" composer button. */
  claude?: ClaudeClient
  /** Injectable Chatwoot sender — dev-server stubs it so Send works offline. */
  sendMessage?: typeof sendChatwootMessage
  /** The gateway text rail for the assistant's approve-first send_text. Prod
   *  injects the real HTTP rail; absent = texting honestly reports "not set up". */
  sendText?: SendTextFn
  /** The hub gateway's shared bearer for /federation/*. Unset => surface is 503. */
  federationServiceToken?: string
}

/**
 * Builds the full Hono app. Pure (no I/O at construction) so tests mount it with
 * a FakeDatabase. Route groups:
 *   - public:        /health, /api/auth/*, /api/webhooks/chatwoot (own secret), /api/public/{f,forms,proposals}/* (hosted funnel + form + proposal pages)
 *   - operator-auth: /api/locations
 *   - auth + tenant: /api/loc/:loc/{contacts,conversations,opportunities,calendars,campaigns,workflows,reporting,funnels,forms,invoices,surveys,proposals}/*  (locationAccess -> 403)
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/health', (c) => c.json({ ok: true, service: 'openlevel' }))

  app.route('/api/auth', authRoute({ db: deps.db, sessionSecret: deps.sessionSecret, secure: deps.secure }))
  app.route(
    '/api/webhooks/chatwoot',
    chatwootWebhookRoute({ db: deps.db, webhookSecret: deps.webhookSecret, onInbound: deps.onInbound }),
  )
  // Public hosted funnel + form pages — unauthenticated, read location from the
  // URL. Mounted before the operatorAuth boundary so visitors never hit a login.
  app.route('/api/public/f', publicFunnelsRoute({ db: deps.db, dispatch: deps.dispatch }))
  app.route('/api/public/forms', publicFormsRoute({ db: deps.db, dispatch: deps.dispatch }))
  app.route('/api/public/reviews', publicReviewsRoute({ db: deps.db }))
  app.route('/api/public/courses', publicCoursesRoute({ db: deps.db }))
  app.route('/api/public/blog', publicBlogRoute({ db: deps.db }))
  // Public hosted community space — read-only feed of published communities.
  app.route('/api/public/communities', publicCommunitiesRoute({ db: deps.db }))
  app.route('/api/public/surveys', publicSurveysRoute({ db: deps.db, dispatch: deps.dispatch }))
  // Public signable proposal pages — render, sign, decline; a signature fires the
  // proposal_signed trigger so an accepted proposal can start an automation.
  app.route('/api/public/proposals', publicProposalsRoute({ db: deps.db, dispatch: deps.dispatch }))
  // Trigger links redirect + record a click, then fire trigger_link_clicked, so
  // the public hop carries the dispatch like funnels/forms do.
  app.route('/api/public/l', publicTriggerLinksRoute({ db: deps.db, dispatch: deps.dispatch }))
  // Affiliate referral links: record the visit (attributed when ?c= names a real
  // contact), then 302 to the program landing URL. Self-contained — no dispatch.
  app.route('/api/public/ref', publicAffiliatesRoute({ db: deps.db }))
  // Hosted booking pages: pick a day + time, leave details. A booking creates a
  // contact + appointment and fires appointment_booked into live automations.
  app.route('/api/public/booking', publicBookingRoute({ db: deps.db, dispatch: deps.dispatch }))
  // Payment-processor webhooks + the post-checkout landing page. Signature-
  // verified per location; a completed checkout marks the invoice paid.
  app.route('/api/public/pay', paymentsWebhookRoute({ db: deps.db }))
  // Voice-provider webhooks (Twilio status callbacks / Vapi call reports).
  // Signature-verified per location; events keep the call log honest.
  app.route('/api/public/voice', voiceWebhookRoute({ db: deps.db }))

  // The Acme Hub federation surface. Mounted OUTSIDE the operator-session
  // boundary because it carries its own bearer gate (the hub gateway's shared
  // service token); it is inert (503) until federationServiceToken is set. The
  // tenant rides in the trusted X-Federation-Tenant header, never the body.
  app.route(
    '/',
    federationRoute({
      db: deps.db,
      federationServiceToken: deps.federationServiceToken,
      claude: deps.claude,
      sendText: deps.sendText,
    }),
  )

  app.use('/api/locations', operatorAuth(deps.sessionSecret))
  app.route('/api/locations', locationsRoute({ db: deps.db }))

  app.use('/api/push-tokens', operatorAuth(deps.sessionSecret))
  app.route('/api/push-tokens', pushTokensRoute({ db: deps.db }))

  app.use('/api/loc/:loc/*', operatorAuth(deps.sessionSecret))
  app.use('/api/loc/:loc/*', locationAccess(deps.db))
  app.route('/api/loc/:loc/contacts', contactsRoute({ db: deps.db }))
  app.route(
    '/api/loc/:loc/conversations',
    conversationsRoute({ db: deps.db, claude: deps.claude, sendMessage: deps.sendMessage }),
  )
  // The "AI front door" — operator chats in plain English, the assistant reads
  // across the location with its tools and answers, and (approve-first) drafts a
  // text the operator confirms. The confirm tap is the only send path; deps.sendText
  // is the gateway rail it goes through. 501 when no Claude client is configured.
  app.route('/api/loc/:loc/assistant', assistantRoute({ db: deps.db, claude: deps.claude, sendText: deps.sendText }))
  app.route('/api/loc/:loc/opportunities', opportunitiesRoute({ db: deps.db, dispatch: deps.dispatch }))
  // Pipeline + stage *structure* management (the Settings -> Pipelines area). The
  // opportunities route owns the board reads/writes; this owns create/rename/
  // delete of pipelines and their stages, with guarded deletes (never a silent
  // cascade over live deals).
  app.route('/api/loc/:loc/pipelines', pipelinesRoute({ db: deps.db }))
  app.route('/api/loc/:loc/calendars', calendarsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/campaigns', campaignsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/workflows', workflowsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/reporting', reportingRoute({ db: deps.db }))
  app.route('/api/loc/:loc/funnels', funnelsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/forms', formsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/invoices', invoicesRoute({ db: deps.db }))
  // The reusable product/service catalog (Payments -> Products): saved items an
  // invoice or proposal can be built from. Editing it never sends or moves money.
  app.route('/api/loc/:loc/products', productsRoute({ db: deps.db }))
  // Recurring-commitment ledger (Payments -> Subscriptions): tracks who is on a
  // recurring arrangement and derives MRR and renewals. Bookkeeping only — it
  // never charges a card or moves money.
  app.route('/api/loc/:loc/subscriptions', subscriptionsRoute({ db: deps.db }))
  // Reusable discount codes (Payments -> Coupons): definitions a later module can
  // apply to an invoice total. Bookkeeping only — defining or applying a coupon
  // never charges a card or moves money.
  app.route('/api/loc/:loc/coupons', couponsRoute({ db: deps.db }))
  // The Transactions ledger (Payments -> Transactions): a read-only projection of
  // invoices that carry a recorded payment. There is no create/charge path —
  // OpenLevel never moves money, so a row exists only because an operator wrote
  // down a payment, and each amount is derived from that invoice line items.
  app.route('/api/loc/:loc/transactions', transactionsRoute({ db: deps.db }))
  // The call log + click-to-call (Module 52). Calls run inside the location's
  // own Twilio/Vapi account; this only places them and mirrors what the
  // provider reports. Operator-only — the AI agent has no call tool.
  app.route('/api/loc/:loc/calls', callsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/reviews', reviewsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/courses', coursesRoute({ db: deps.db }))
  app.route('/api/loc/:loc/blog', blogRoute({ db: deps.db }))
  app.route('/api/loc/:loc/communities', communitiesRoute({ db: deps.db }))
  app.route('/api/loc/:loc/social', socialRoute({ db: deps.db }))
  app.route('/api/loc/:loc/surveys', surveysRoute({ db: deps.db }))
  app.route('/api/loc/:loc/proposals', proposalsRoute({ db: deps.db }))
  app.route('/api/loc/:loc/trigger-links', triggerLinksRoute({ db: deps.db }))
  app.route('/api/loc/:loc/affiliates', affiliatesRoute({ db: deps.db }))
  // Cross-contact task worklist (the global "Tasks" page). Writes happen through
  // the nested /contacts/:id/tasks routes; this is read-only aggregation.
  app.route('/api/loc/:loc/tasks', tasksRoute({ db: deps.db }))
  app.route('/api/loc/:loc/templates', templatesRoute({ db: deps.db }))
  // Location-wide tag management (the "Tags" settings area). Per-contact tag
  // add/remove lives on the nested /contacts/:id/tags routes; this is the
  // distinct-set view plus rename/delete across every contact.
  app.route('/api/loc/:loc/tags', tagsRoute({ db: deps.db }))
  // Custom-field *definitions* (the "Custom Fields" settings area). Per-contact
  // values are written through the nested /contacts/:id/custom-fields/:key route;
  // this manages the field definitions themselves.
  app.route('/api/loc/:loc/custom-fields', customFieldsRoute({ db: deps.db }))
  // Custom *values*: location-level constants (business name, booking link, etc.)
  // referenced as {{custom_values.<key>}} merge tags in templates and automations.
  app.route('/api/loc/:loc/custom-values', customValuesRoute({ db: deps.db }))
  // AI Agent settings (the "AI Agent" settings area): reply mode (approve-first /
  // autonomous) + the agent's persona, instructions, and knowledge-base facts.
  app.route('/api/loc/:loc/settings', settingsRoute({ db: deps.db }))

  return app
}

async function bootstrap() {
  const config = loadConfig()
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to boot the server')
  const pool = new Pool({ connectionString: config.DATABASE_URL })
  const db = new PgDatabase(pool)

  // Jobs: pg-boss runs the agent-reply + workflow-dispatch workers; routes and
  // the webhook enqueue onto them.
  const boss = await startBoss(config.DATABASE_URL)
  const dispatch: WorkflowDispatch = (e) => enqueueWorkflowEvent(boss, e)
  // The autonomous agent books/tags through real tools; thread the dispatcher so
  // an agent-booked appointment fires appointment_booked like the public page.
  await registerAgentReplyWorker(boss, { db, claude: createAnthropicClient(), dispatch })
  await registerWorkflowDispatchWorker(boss, { db })

  const app = createApp({
    db,
    sessionSecret: config.SESSION_SECRET,
    webhookSecret: config.CHATWOOT_WEBHOOK_SECRET,
    secure: config.NODE_ENV === 'production',
    claude: createAnthropicClient(),
    dispatch,
    // The approve-first text rail. Injected unconditionally — the env vars are the
    // deployment control, NOT a feature flag (no dormant texting toggle). When
    // GATEWAY_TEXT_URL/INTERNAL_PUSH_SECRET are unset, the rail honestly reports
    // "not set up" rather than silently dropping. Reuses the gateway's internal
    // push secret; the gateway owns the Beeper credential, OpenLevel never sees it.
    sendText: makeHttpSendText({
      url: process.env.GATEWAY_TEXT_URL ?? '',
      secret: process.env.INTERNAL_PUSH_SECRET ?? '',
    }),
    // The hub gateway's shared bearer for /federation/*. Unset => that surface
    // stays inert (503); the env var is the deployment control, not a feature flag.
    federationServiceToken: config.FEDERATION_SERVICE_TOKEN,
    // A fresh inbound both drafts an agent reply and fires the inbound_message
    // trigger so message-triggered workflows enroll the contact.
    onInbound: async (e) => {
      await enqueueAgentReply(boss, {
        locationId: e.locationId,
        conversationId: e.conversationId,
        contactId: e.contactId,
      })
      await enqueueWorkflowEvent(boss, {
        locationId: e.locationId,
        triggerType: 'inbound_message',
        contactId: e.contactId,
      })
      // Nudge the Hub Android app out-of-process: a fresh inbound just landed.
      // Fire-and-forget — a down/unconfigured gateway must never block ingestion.
      void notifyPush(
        { url: process.env.GATEWAY_PUSH_URL ?? '', secret: process.env.INTERNAL_PUSH_SECRET ?? '' },
        {
          source: 'openlevel',
          title: e.contactName ? `New message — ${e.contactName}` : 'New OpenLevel message',
          body: (e.preview ?? '').slice(0, 140),
          data: { conversationId: e.conversationId, locationId: e.locationId },
        },
      )
    },
  })
  serve({ fetch: app.fetch, port: config.PORT })
  console.log(`openlevel api listening on :${config.PORT}`)
}

// Boot only when run directly (tsx server/index.ts), never on import (tests).
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  bootstrap().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

