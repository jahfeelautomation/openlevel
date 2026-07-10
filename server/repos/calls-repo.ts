import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type CallDirection = 'inbound' | 'outbound'

export interface Call {
  id: string
  location_id: string
  contact_id: string | null
  direction: CallDirection
  from_number: string | null
  to_number: string | null
  status: string
  duration_seconds: number | null
  recording_url: string | null
  transcript: string | null
  summary: string | null
  provider: string
  /** The provider's own call id (Twilio CallSid / Vapi call id) — what a
   *  webhook delivery correlates against. */
  external_id: string | null
  created_at: string
}

export interface CallCreateInput {
  contactId?: string | null
  direction: CallDirection
  fromNumber?: string | null
  toNumber?: string | null
  status?: string
  provider: string
  externalId?: string | null
}

/** One call event as a provider webhook hands it over — already normalized by
 *  the voice adapter. Absent fields mean "no news"; the row keeps its value. */
export interface CallUpsertInput {
  provider: string
  externalId: string
  direction: CallDirection
  status: string
  fromNumber?: string | null
  toNumber?: string | null
  durationSeconds?: number | null
  recordingUrl?: string | null
  transcript?: string | null
  summary?: string | null
}

/** Once a call reached one of these, a late or replayed status delivery must
 *  not drag it back to 'ringing'. */
const TERMINAL = "('completed','failed','busy','no-answer')"

/**
 * The call log for one location (Module 52). Rows arrive two ways: `create`
 * when this app places an outbound call, and `upsertExternal` when a provider
 * webhook reports one — including inbound calls we never placed, which insert
 * honestly instead of being dropped. Nothing here invents a call, a duration,
 * or a transcript; every field is what the provider reported.
 */
export class CallsRepo extends LocationScopedRepo {
  list(): Promise<Call[]> {
    return this.scopedSelect<Call>('SELECT * FROM calls ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Call | undefined> {
    const rows = await this.scopedSelect<Call>('SELECT * FROM calls WHERE id=$2', [id])
    return rows[0]
  }

  async create(input: CallCreateInput): Promise<Call> {
    const id = nanoid()
    const rows = await this.scopedWrite<Call>(
      `INSERT INTO calls
         (id, location_id, contact_id, direction, from_number, to_number, status, provider, external_id)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id,
        input.contactId ?? null,
        input.direction,
        input.fromNumber ?? null,
        input.toNumber ?? null,
        input.status ?? 'queued',
        input.provider,
        input.externalId ?? null,
      ],
    )
    return rows[0]!
  }

  /** Apply one webhook event: insert the call if this is the first we hear of
   *  it (e.g. a Vapi inbound call), otherwise patch the row we created at
   *  placement. COALESCE keeps every already-known fact when the event has no
   *  news for that field, the status CASE refuses to downgrade a terminal
   *  status (providers retry and deliveries can land out of order), and
   *  contact/direction/numbers from placement are never overwritten. Single
   *  statement — no TOCTOU window. */
  async upsertExternal(input: CallUpsertInput): Promise<{ call: Call; inserted: boolean }> {
    const id = nanoid()
    const rows = await this.scopedWrite<Call & { inserted: boolean }>(
      `INSERT INTO calls
         (id, location_id, contact_id, direction, from_number, to_number, status, duration_seconds,
          recording_url, transcript, summary, provider, external_id)
       VALUES ($2,$1,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (location_id, provider, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         status = CASE WHEN calls.status IN ${TERMINAL} THEN calls.status ELSE EXCLUDED.status END,
         duration_seconds = COALESCE(EXCLUDED.duration_seconds, calls.duration_seconds),
         recording_url = COALESCE(EXCLUDED.recording_url, calls.recording_url),
         transcript = COALESCE(EXCLUDED.transcript, calls.transcript),
         summary = COALESCE(EXCLUDED.summary, calls.summary)
       RETURNING *, (xmax = 0) AS inserted`,
      [
        id,
        input.direction,
        input.fromNumber ?? null,
        input.toNumber ?? null,
        input.status,
        input.durationSeconds ?? null,
        input.recordingUrl ?? null,
        input.transcript ?? null,
        input.summary ?? null,
        input.provider,
        input.externalId,
      ],
    )
    const { inserted, ...call } = rows[0]!
    return { call: call as Call, inserted }
  }
}
