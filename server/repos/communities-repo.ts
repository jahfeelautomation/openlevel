import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export type CommunityStatus = 'draft' | 'published'

export interface Community {
  id: string
  location_id: string
  name: string
  slug: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface CommunityInput {
  name: string
  slug: string
  description?: string | null
  status?: CommunityStatus
}

export interface CommunityPatch {
  name?: string
  slug?: string
  description?: string | null
  status?: CommunityStatus
}

/**
 * Communities for one location — the group space a body of channels, members and
 * posts hangs off of. A community is only ever a draft until the operator
 * publishes it; the public feed never serves a draft. The headline "128 members ·
 * 42 posts" lives nowhere on this row — it is derived from real member/post rows
 * in community-math.ts — so this repo only owns the community's own facts (name,
 * slug, status). `getBySlug` powers a stable, human-readable public URL, still
 * bound to the location so it stays tenancy-safe.
 */
export class CommunitiesRepo extends LocationScopedRepo {
  list(): Promise<Community[]> {
    return this.scopedSelect<Community>('SELECT * FROM communities ORDER BY created_at DESC')
  }

  async get(id: string): Promise<Community | undefined> {
    const rows = await this.scopedSelect<Community>('SELECT * FROM communities WHERE id=$2', [id])
    return rows[0]
  }

  async getBySlug(slug: string): Promise<Community | undefined> {
    const rows = await this.scopedSelect<Community>('SELECT * FROM communities WHERE slug=$2', [slug])
    return rows[0]
  }

  async create(input: CommunityInput): Promise<Community> {
    const id = nanoid()
    const rows = await this.scopedWrite<Community>(
      `INSERT INTO communities (id, location_id, name, slug, description, status)
       VALUES ($2,$1,$3,$4,$5,$6) RETURNING *`,
      [id, input.name, input.slug, input.description ?? null, input.status ?? 'draft'],
    )
    return rows[0]!
  }

  /** Patch the supplied fields only; always refresh updated_at. Returns the row
   *  (scoped to this location) or undefined if it isn't ours / nothing was set. */
  async update(id: string, patch: CommunityPatch): Promise<Community | undefined> {
    const sets: string[] = []
    const params: unknown[] = []
    const bind = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col}=$${params.length + 1}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.slug !== undefined) bind('slug', patch.slug)
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.status !== undefined) bind('status', patch.status)
    if (sets.length === 0) return undefined
    sets.push('updated_at=now()')
    params.push(id)
    const idParam = `$${params.length + 1}`
    const rows = await this.scopedWrite<Community>(
      `UPDATE communities SET ${sets.join(', ')} WHERE location_id=$1 AND id=${idParam} RETURNING *`,
      params,
    )
    return rows[0]
  }

  async remove(id: string): Promise<void> {
    await this.scopedWrite('DELETE FROM communities WHERE location_id=$1 AND id=$2', [id])
  }
}
