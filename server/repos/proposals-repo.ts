import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined'

/** One billable line on a proposal. `unit_amount` is in cents, like every money
 *  value here. Defined alongside the proposal (not cross-imported from invoices)
 *  so the two documents can evolve independently. */
export interface ProposalItem {
  description: string
  quantity: number
  unit_amount: number
}

export interface Proposal {
  id: string
  location_id: string
  contact_id: string | null
  title: string
  slug: string
  status: string
  currency: string
  /** Document body: { intro, line_items: ProposalItem[], terms, signer_role? }. */
  content: Record<string, unknown>
  signer_name: string | null
  signed_at: string | null
  created_at: string
  updated_at: string
}

export interface ProposalInput {
  title: string
  slug: string
  contactId?: string | null
  status?: ProposalStatus
  currency?: string
  content?: Record<string, unknown>
}

export interface ProposalPatch {
  title?: string
  slug?: string
  contactId?: string | null
  currency?: string
  content?: Record<string, unknown>
}

/**
 * Proposals & estimates for one location. A proposal is a signable sales
 * document: its body (intro prose, line items, terms) lives in `content`, and
 * the dollar total is never stored — it's derived from `content.line_items`
 * (see proposal-math.ts) so the amount the client signs for can't drift from the
 * lines that justify it. Status flows draft -> sent -> viewed -> signed, with
 * `declined` as the recipient's "no". `sign` is the one honest fact we capture:
 * the typed signer name + signed_at, written once when the recipient accepts on
 * the public page. OpenLevel never forges a signature — an unsigned proposal
 * reads as an honest "awaiting signature".
 */
export class ProposalsRepo extends LocationScopedRepo {
  list(): Promise<Proposal[]> {
    return this.scopedSelect<Proposal>('SELECT * FROM proposals ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Proposal | undefined> {
    const rows = await this.scopedSelect<Proposal>('SELECT * FROM proposals WHERE id=$2', [id])
    return rows[0]
  }

  /**
   * Look a proposal up by its public slug, still scoped to this location. The
   * unauthenticated public page resolves a proposal this way, so the tenancy
   * filter is the guard that one location's URL can never reach another's row.
   */
  async getBySlug(slug: string): Promise<Proposal | undefined> {
    const rows = await this.scopedSelect<Proposal>('SELECT * FROM proposals WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: ProposalInput): Promise<Proposal> {
    const id = nanoid()
    const rows = await this.scopedWrite<Proposal>(
      `INSERT INTO proposals
         (id, location_id, contact_id, title, slug, status, currency, content)
       VALUES ($2,$1,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        input.contactId ?? null,
        input.title,
        input.slug,
        input.status ?? 'draft',
        input.currency ?? 'usd',
        JSON.stringify(input.content ?? {}),
      ],
    )
    return rows[0]!
  }

  /**
   * Patch only the provided columns (content is json-encoded). Dynamic SET from
   * $2, always bumps updated_at, id pinned last. Returns undefined when nothing
   * was provided (no query issued). Status changes go through the dedicated
   * transition methods below, not here.
   */
  async update(id: string, patch: ProposalPatch): Promise<Proposal | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.title !== undefined) push('title', patch.title)
    if (patch.slug !== undefined) push('slug', patch.slug)
    if (patch.contactId !== undefined) push('contact_id', patch.contactId)
    if (patch.currency !== undefined) push('currency', patch.currency)
    if (patch.content !== undefined) push('content', JSON.stringify(patch.content))
    if (sets.length === 0) return undefined

    sets.push('updated_at=now()')
    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  /** Move a draft to sent (the operator has shared the public link). */
  async markSent(id: string): Promise<Proposal | undefined> {
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET status='sent', updated_at=now()
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  /**
   * Record that the recipient opened the public proposal: sent -> viewed only.
   * Guarded by `AND status='sent'` so it never drags a signed/declined proposal
   * backwards; returns undefined (caller ignores) when there's nothing to flip.
   */
  async markViewed(id: string): Promise<Proposal | undefined> {
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET status='viewed', updated_at=now()
       WHERE location_id=$1 AND id=$2 AND status='sent' RETURNING *`,
      [id],
    )
    return rows[0]
  }

  /**
   * The recipient accepted: stamp the typed signer name + signed_at and move to
   * signed. This is the only place a signature is ever written, and it records
   * exactly what the recipient typed — nothing is forged or pre-filled.
   */
  async sign(id: string, signerName: string): Promise<Proposal | undefined> {
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET status='signed', signer_name=$2, signed_at=now(), updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [signerName, id],
    )
    return rows[0]
  }

  /** The recipient declined the proposal. */
  async decline(id: string): Promise<Proposal | undefined> {
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET status='declined', updated_at=now()
       WHERE location_id=$1 AND id=$2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  async setStatus(id: string, status: ProposalStatus): Promise<Proposal | undefined> {
    const rows = await this.scopedWrite<Proposal>(
      `UPDATE proposals SET status=$2, updated_at=now()
       WHERE location_id=$1 AND id=$3 RETURNING *`,
      [status, id],
    )
    return rows[0]
  }
}
