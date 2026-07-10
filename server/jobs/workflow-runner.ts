import type { Database } from '../db/database'
import { renderTemplate } from '../lib/merge-fields'
import { type Contact, ContactsRepo } from '../repos/contacts-repo'
import { CustomValuesRepo } from '../repos/custom-values-repo'
import { TimelineRepo } from '../repos/timeline-repo'
import { WorkflowActionsRepo } from '../repos/workflow-actions-repo'
import {
  type WorkflowRun,
  type WorkflowRunStep,
  WorkflowRunsRepo,
} from '../repos/workflow-runs-repo'
import { type WorkflowAction, WorkflowsRepo } from '../repos/workflows-repo'

export interface WorkflowRunPayload {
  locationId: string
  workflowId: string
  contactId: string | null
  triggerType: string
}

/** Defers the steps after a `wait`. The thunk returns the resume promise so a
 *  caller (a test, or a future pg-boss adapter) can await completion; the default
 *  uses setTimeout and ignores the promise (fire-and-forget). */
export type Scheduler = (thunk: () => Promise<unknown>, ms: number) => void

/**
 * setTimeout stores its delay in a 32-bit signed int. A value above this ceiling
 * (~24.8 days) silently clamps to 1ms and fires almost immediately — so a naive
 * `setTimeout(resume, waitMs({ days: 30 }))` would run the rest of a month-long
 * drip the instant it was scheduled. MAX_TIMEOUT_MS is that ceiling.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * Split a delay into setTimeout-safe chunks. A short wait is returned as a single
 * chunk; a multi-week wait becomes several chunks each at or under the ceiling,
 * summing to the exact original duration so the scheduler can re-arm until the
 * full time elapses without losing or inventing time.
 */
export function timeoutChunks(ms: number): number[] {
  if (!(ms > 0)) return [0]
  const chunks: number[] = []
  let remaining = ms
  while (remaining > MAX_TIMEOUT_MS) {
    chunks.push(MAX_TIMEOUT_MS)
    remaining -= MAX_TIMEOUT_MS
  }
  chunks.push(remaining)
  return chunks
}

const defaultSchedule: Scheduler = (thunk, ms) => {
  const chunks = timeoutChunks(ms)
  const arm = (i: number) => {
    const t = setTimeout(() => {
      if (i + 1 < chunks.length) arm(i + 1)
      else void thunk()
    }, chunks[i] ?? 0)
    // Don't keep the dev process alive just for a pending wait.
    ;(t as { unref?: () => void }).unref?.()
  }
  arm(0)
}

export interface WorkflowRunnerDeps {
  db: Database
  schedule?: Scheduler
}

/** Translate a wait step's config into milliseconds. Sums any supported units;
 *  ignores zero/negative/non-numeric values so a delay is never negative. */
export function waitMs(config: Record<string, unknown>): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const secs = n(config.seconds) + n(config.minutes) * 60 + n(config.hours) * 3600 + n(config.days) * 86_400
  return secs * 1000
}

function describeWait(config: Record<string, unknown>): string {
  const units: [string, unknown][] = [
    ['day', config.days],
    ['hour', config.hours],
    ['minute', config.minutes],
    ['second', config.seconds],
  ]
  const parts = units
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([label, v]) => `${v as number} ${label}${(v as number) === 1 ? '' : 's'}`)
  return parts.length ? `Waiting ${parts.join(' ')}` : 'Waiting'
}

/**
 * Execute one action and return its result row. Effects are real where we can be
 * honest about them: add_tag mutates the contact; send_sms/send_email render the
 * body with merge fields and log an activity event (wiring these to a live SMS/
 * email carrier is a later integration — we never claim "delivered"). A missing
 * contact or empty config yields a `skipped` step rather than a failure.
 */
async function executeAction(
  db: Database,
  locationId: string,
  action: WorkflowAction,
  contact: Contact | null,
  position: number,
  customValues: Record<string, string>,
): Promise<WorkflowRunStep> {
  const base = { position, type: action.type }

  switch (action.type) {
    case 'add_tag': {
      const tag = typeof action.config.tag === 'string' ? action.config.tag.trim() : ''
      if (!tag) return { ...base, status: 'skipped', detail: 'No tag configured' }
      if (!contact) return { ...base, status: 'skipped', detail: 'No contact to tag' }
      await new ContactsRepo(db, locationId).addTag(contact.id, tag)
      return { ...base, status: 'done', detail: `Added tag "${tag}"` }
    }
    case 'send_sms':
    case 'send_email': {
      const channel = action.type === 'send_sms' ? 'SMS' : 'Email'
      if (!contact) return { ...base, status: 'skipped', detail: `No contact to send ${channel}` }
      const body = renderTemplate(
        typeof action.config.body === 'string' ? action.config.body : '',
        contact,
        customValues,
      )
      const subject =
        action.type === 'send_email' && typeof action.config.subject === 'string'
          ? renderTemplate(action.config.subject, contact, customValues)
          : null
      await new TimelineRepo(db, locationId).add({
        contactId: contact.id,
        type: 'automation_action',
        refTable: 'workflows',
        payload: { action: action.type, channel: channel.toLowerCase(), subject, body, status: 'logged' },
      })
      const preview = body.length > 60 ? `${body.slice(0, 60)}…` : body
      return { ...base, status: 'done', detail: `${channel} logged: "${preview}"` }
    }
    default:
      return { ...base, status: 'skipped', detail: `Unsupported action: ${action.type}` }
  }
}

/**
 * Run a workflow's steps for one contact, recording an honest execution record in
 * workflow_runs. Status-agnostic: the dispatcher decides which workflows are live;
 * a manual test run drives a draft too. On a `wait`, the run is left `waiting` and
 * the remaining steps are scheduled (default setTimeout) — `opts.runId` +
 * `opts.fromPosition` carry the resume so no step is lost or repeated.
 */
export async function runWorkflow(
  deps: WorkflowRunnerDeps,
  payload: WorkflowRunPayload,
  opts: { runId?: string; fromPosition?: number } = {},
): Promise<WorkflowRun> {
  const { db } = deps
  const { locationId } = payload
  const schedule = deps.schedule ?? defaultSchedule

  const runsRepo = new WorkflowRunsRepo(db, locationId)

  const workflow = await new WorkflowsRepo(db, locationId).get(payload.workflowId)
  if (!workflow) {
    // A fresh run pointed at a missing workflow is a caller error — surface it
    // synchronously so the dispatcher sees it.
    if (!opts.runId) throw new Error(`workflow ${payload.workflowId} not found in ${locationId}`)
    // A resume whose workflow was deleted during the wait must NOT throw: this
    // path runs inside a fire-and-forget scheduled callback, so a throw becomes an
    // unhandled rejection and the run is stranded 'waiting' forever. Close it out
    // honestly as failed instead.
    const failedStep: WorkflowRunStep = {
      position: opts.fromPosition ?? 0,
      type: 'wait',
      status: 'failed',
      detail: 'Workflow was deleted during the wait',
    }
    await runsRepo.appendStep(opts.runId, failedStep, 'failed')
    return (await runsRepo.finish(opts.runId, 'failed')) ?? ((await runsRepo.get(opts.runId)) as WorkflowRun)
  }

  const actions = await new WorkflowActionsRepo(db, locationId).listByWorkflow(payload.workflowId)
  const contact = payload.contactId
    ? ((await new ContactsRepo(db, locationId).get(payload.contactId)) ?? null)
    : null
  // The location's custom values feed {{custom_values.<key>}} merge tags in
  // message bodies. Fetched once per run (and again on a resume, so an edit made
  // during a wait is picked up).
  const customValues = await new CustomValuesRepo(db, locationId).map()

  let run = opts.runId
    ? ((await runsRepo.get(opts.runId)) as WorkflowRun)
    : await runsRepo.create({
        workflowId: payload.workflowId,
        contactId: payload.contactId,
        triggerType: payload.triggerType,
      })

  for (let i = opts.fromPosition ?? 0; i < actions.length; i++) {
    const action = actions[i]!

    if (action.type === 'wait') {
      const waiting: WorkflowRunStep = {
        position: i,
        type: 'wait',
        status: 'waiting',
        detail: describeWait(action.config),
      }
      run = (await runsRepo.appendStep(run.id, waiting, 'waiting')) ?? run
      const resumeId = run.id
      const next = i + 1
      schedule(() => runWorkflow(deps, payload, { runId: resumeId, fromPosition: next }), waitMs(action.config))
      return run
    }

    const step = await executeAction(db, locationId, action, contact, i, customValues)
    run = (await runsRepo.appendStep(run.id, step, 'running')) ?? run
  }

  return (await runsRepo.finish(run.id, 'completed')) ?? run
}
