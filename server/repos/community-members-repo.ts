import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type CommunityMemberRole = 'member' | 'moderator' | 'admin'

export interface CommunityMember {
  id: string
  location_id: string
  community_id: string
  contact_id: string | null
  name: string
  email: string | null
  role: string
  joined_at: string
  created_at: string
}

export interface CommunityMemberInput {
  communityId: string
  name: string
  email?: string | null
  contactId?: string | null
  role?: CommunityMemberRole
}

export interface CommunityMemberPatch {
  name?: string
  email?: string | null
  role?: CommunityMemberRole
}

/**
 * The people who belong to a community. A member can be tied back to a CRM
 * contact (contact_id) or stand alone (an operator-curated roster), so contact_id
 * is nullable and clears to NULL if the contact is later deleted. The community's
 * "128 members" headline is a COUNT over these rows — never a stored number — so
 * adding or removing a row is the only way the figure moves. Members author posts
 * and comments and cast likes; deleting a member leaves their posts standing with
 * a null author rather than vanishing the activity.
 */
export class CommunityMembersRepo extends LocationScopedRepo {
  listByCommunity(communityId: string): Promise<CommunityMember[]> {
    return this.scopedSelect<CommunityMember>(
      'SELECT * FROM community_members WHERE community_id=$2 ORDER BY joined_at DESC',
      [communityId],
    )
  }

  async get(id: string): Promise<CommunityMember | undefined> {
    const rows = await this.scopedSelect<CommunityMember>(
      'SELECT * FROM community_members WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  /** Real headcount for the community — the only source of the "members" figure. */
  async countByCommunity(communityId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_members WHERE community_id=$2',
      [communityId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: CommunityMemberInput): Promise<CommunityMember> {
    const id = nanoid()
    const rows = await this.scopedWrite<CommunityMember>(
      `INSERT INTO community_members (id, location_id, community_id, contact_id, name, email, role)
       VALUES ($2,$1,$3,$4,$5,$6,$7) RETURNING *`,
      [id, input.communityId, input.contactId ?? null, input.name, input.email ?? null, input.role ?? 'member'],
    )
    return rows[0]!
  }

  /** Patch only the provided columns. Dynamic SET from $2, id pinned last.
   *  Returns undefined when nothing was provided. */
  async update(id: string, patch: CommunityMemberPatch): Promise<CommunityMember | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.email !== undefined) push('email', patch.email)
    if (patch.role !== undefined) push('role', patch.role)
    if (sets.length === 0) return undefined

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<CommunityMember>(
      `UPDATE community_members SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM community_members WHERE location_id=$1 AND id=$2', [id])
  }
}
