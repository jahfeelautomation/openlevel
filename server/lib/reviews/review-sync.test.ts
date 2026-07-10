import { describe, expect, it, vi } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import type { ResolvedReviewSource } from './resolve'
import { syncReviews } from './review-sync'

function resolverFor(map: Record<string, ResolvedReviewSource>) {
  return vi.fn(async (_db: unknown, _loc: string, source: string) => {
    const resolved = map[source]
    if (!resolved) throw new Error(`unexpected source ${source}`)
    return resolved
  })
}

describe('syncReviews', () => {
  it('imports + updates per connected source and reports unconnected ones honestly', async () => {
    const db = new FakeDatabase()
    db.enqueue([{ id: 'rv1', location_id: 'locA', inserted: true }]) // first upsert -> new row
    db.enqueue([{ id: 'rv2', location_id: 'locA', inserted: false }]) // second upsert -> refresh
    const resolveSource = resolverFor({
      google: {
        ok: true,
        reviewSource: {
          source: 'google',
          fetchReviews: async () => [
            { externalId: 'gr_1', rating: 5, body: 'Great.', reviewerName: 'M', createdAt: null },
            { externalId: 'gr_2', rating: 4, body: null, reviewerName: null, createdAt: null },
          ],
        },
      },
      facebook: { ok: false, reason: 'facebook page id is not configured' },
    })

    const results = await syncReviews({ db, resolveSource }, 'locA')

    expect(results).toEqual([
      { source: 'google', ok: true, imported: 1, updated: 1 },
      { source: 'facebook', ok: false, reason: 'facebook page id is not configured' },
    ])
    // every upsert is scoped to the location ($1)
    expect(db.calls).toHaveLength(2)
    expect(db.calls[0]?.params?.[0]).toBe('locA')
    expect(db.calls[1]?.params?.[0]).toBe('locA')
    expect(resolveSource).toHaveBeenCalledWith(db, 'locA', 'google')
    expect(resolveSource).toHaveBeenCalledWith(db, 'locA', 'facebook')
  })

  it('reports a platform fetch failure as that source reason without sinking the other source', async () => {
    const db = new FakeDatabase()
    db.enqueue([{ id: 'rv_fb', location_id: 'locA', inserted: true }])
    const resolveSource = resolverFor({
      google: {
        ok: true,
        reviewSource: {
          source: 'google',
          fetchReviews: async () => {
            throw new Error('google reviews fetch failed: 403')
          },
        },
      },
      facebook: {
        ok: true,
        reviewSource: {
          source: 'facebook',
          fetchReviews: async () => [
            { externalId: 'og_1', rating: 5, body: null, reviewerName: null, createdAt: null },
          ],
        },
      },
    })

    const results = await syncReviews({ db, resolveSource }, 'locA')

    expect(results).toEqual([
      // adapter errors carry only the HTTP status — safe to surface verbatim
      { source: 'google', ok: false, reason: 'google reviews fetch failed: 403' },
      { source: 'facebook', ok: true, imported: 1, updated: 0 },
    ])
  })

  it('counts an empty platform answer as an honest zero', async () => {
    const db = new FakeDatabase()
    const resolveSource = resolverFor({
      google: {
        ok: true,
        reviewSource: { source: 'google', fetchReviews: async () => [] },
      },
      facebook: { ok: false, reason: 'facebook page token is not configured' },
    })

    const results = await syncReviews({ db, resolveSource }, 'locA')
    expect(results[0]).toEqual({ source: 'google', ok: true, imported: 0, updated: 0 })
    expect(db.calls).toHaveLength(0) // nothing fabricated
  })
})
