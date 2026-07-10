import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface SocialAccount {
  id: string
  location_id: string
  platform: string
  handle: string
  connected: boolean
  created_at: string
  updated_at: string
}

export interface SocialAccountInput {
  platform: string
  handle: string
  connected?: boolean
}

export interface SocialAccountPatch {
  handle?: string
  connected?: boolean
}

/**
 * Social accounts for one location — the Facebook page / Instagram handle / etc.
 * a post can publish to. The honest centre of this repo is `connected`: it
 * defaults false and only a real OAuth link (the pending platform adapter) should
 * ever set it true, so the planner never claims a connection it doesn't have.
 * `countConnected` is the source for the KPI band's "N connected" — a real COUNT,
 * never a stored number.
 */
export class SocialAccountsRepo extends LocationScopedRepo {
  list(): Promise<SocialAccount[]> {
    return this.scopedSelect<SocialAccount>('SELECT * FROM social_accounts ORDER BY created_at')
  }

  async get(id: string): Promise<SocialAccount | undefined> {
    const rows = await this.scopedSelect<SocialAccount>(
      'SELECT * FROM social_accounts WHERE id=$2',
      [id],
    )
    return rows[0]
  }

  /** Real count of connected accounts — feeds the honest "N connected" KPI. */
  async countConnected(): Promise<number> {
    const rows = await this.scopedSelect<{ n: string | number }>(
      'SELECT COUNT(*)::int AS n FROM social_accounts WHERE connected=true',
    )
    return Number(rows[0]?.n ?? 0)
  }

  async create(input: SocialAccountInput): Promise<SocialAccount> {
    const id = nanoid()
    const rows = await this.scopedWrite<SocialAccount>(
      `INSERT INTO social_accounts (id, location_id, platform, handle, connected)
       VALUES ($2,$1,$3,$4,$5) RETURNING *`,
      [id, input.platform, input.handle, input.connected ?? false],
    )
    return rows[0]!
  }

  /** Flip an account's connected flag. The honest truth of "linked to the
   *  network": false at creation, true only when a real OAuth link is made. */
  async setConnected(id: string, connected: boolean): Promise<SocialAccount | undefined> {
    const rows = await this.scopedWrite<SocialAccount>(
      'UPDATE social_accounts SET connected=$2, updated_at=now() WHERE location_id=$1 AND id=$3 RETURNING *',
      [connected, id],
    )
    return rows[0]
  }

  async update(id: string, patch: SocialAccountPatch): Promise<SocialAccount | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.handle !== undefined) bind('handle', patch.handle)
    if (patch.connected !== undefined) bind('connected', patch.connected)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<SocialAccount>(
      `UPDATE social_accounts SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM social_accounts WHERE location_id=$1 AND id=$2', [id])
  }
}
