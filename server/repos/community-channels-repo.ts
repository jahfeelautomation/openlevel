import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface CommunityChannel {
  id: string
  location_id: string
  community_id: string
  position: number
  name: string
  slug: string
  created_at: string
}

export interface CommunityChannelInput {
  communityId: string
  name: string
  slug: string
  position?: number
}

export interface CommunityChannelPatch {
  name?: string
  slug?: string
  position?: number
}

/**
 * The ordered channels within a community — its "General", "Wins", "Intros"
 * spaces. `position` carries the sidebar order the operator sets; a post belongs
 * to exactly one channel. A channel holds only its own facts; how many posts it
 * carries is derived from real post rows (community-math.ts), never stored here.
 * `getBySlug` resolves a channel within its community for the public feed's
 * per-channel URL.
 */
export class CommunityChannelsRepo extends LocationScopedRepo {
  listByCommunity(communityId: string): Promise<CommunityChannel[]> {
    return this.scopedSelect<CommunityChannel>(
      'SELECT * FROM community_channels WHERE community_id=$2 ORDER BY position',
      [communityId],
    )
  }

  async get(id: string): Promise<CommunityChannel | undefined> {
    const rows = await this.scopedSelect<CommunityChannel>(
      'SELECT * FROM community_channels WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  async getBySlug(communityId: string, slug: string): Promise<CommunityChannel | undefined> {
    const rows = await this.scopedSelect<CommunityChannel>(
      'SELECT * FROM community_channels WHERE community_id=$2 AND slug=$3',
      [communityId, slug],
    )
    return rows[0]
  }

  /** How many channels the community holds — used to default a new channel's
   *  position to the end of the list. */
  async countByCommunity(communityId: string): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM community_channels WHERE community_id=$2',
      [communityId],
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: CommunityChannelInput): Promise<CommunityChannel> {
    const id = nanoid()
    const rows = await this.scopedWrite<CommunityChannel>(
      `INSERT INTO community_channels (id, location_id, community_id, position, name, slug)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.communityId, input.position ?? 0, input.name, input.slug],
    )
    return rows[0]!
  }

  /** Patch only the provided columns. Dynamic SET from $2, id pinned last.
   *  Returns undefined when nothing was provided. */
  async update(id: string, patch: CommunityChannelPatch): Promise<CommunityChannel | undefined> {
    const sets: string[] = []
    const extra: unknown[] = []
    const push = (col: string, value: unknown) => {
      extra.push(value)
      sets.push(`${col}=$${extra.length + 1}`) // +1 because $1 is the location
    }
    if (patch.name !== undefined) push('name', patch.name)
    if (patch.slug !== undefined) push('slug', patch.slug)
    if (patch.position !== undefined) push('position', patch.position)
    if (sets.length === 0) return undefined

    extra.push(id)
    const idParam = extra.length + 1
    const rows = await this.scopedWrite<CommunityChannel>(
      `UPDATE community_channels SET ${sets.join(', ')} WHERE location_id=$1 AND id=$${idParam} RETURNING *`,
      extra,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM community_channels WHERE location_id=$1 AND id=$2', [id])
  }
}
