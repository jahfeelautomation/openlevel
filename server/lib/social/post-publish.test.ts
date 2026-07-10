import { describe, expect, it, vi } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import { publishSocialPost } from './post-publish'
import type { ResolvedSocialPublisher } from './resolve'

// The engine never talks to a real network — the resolver is injected and
// returns fake publishers. What we pin here is the ORCHESTRATION: per-target
// isolation, honest aggregate refusals, resolver caching, and pacing.

function fakePublisher(platform: string, opts?: { fail?: string }) {
  return {
    platform,
    publish: vi.fn(async (msg: { text: string; mediaUrl?: string }) => {
      if (opts?.fail) throw new Error(opts.fail)
      return { externalId: `${platform}_${msg.text.length}`, platform }
    }),
  }
}

function resolverReturning(byPlatform: Record<string, ResolvedSocialPublisher>) {
  return vi.fn(async (_db: unknown, _locationId: string, platform: string) =>
    byPlatform[platform] ?? { ok: false as const, reason: `publishing to ${platform} is not supported yet` },
  )
}

const noSleep = vi.fn(async () => {})

describe('publishSocialPost', () => {
  it('refuses a post with no targets instead of pretending', async () => {
    const result = await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolverReturning({}), sleep: noSleep },
      { locationId: 'locA', post: { body: 'hello' }, targets: [] },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'no channels selected — add at least one channel to this post',
    })
  })

  it('publishes to every resolvable target and reports per-target outcomes', async () => {
    const fb = fakePublisher('facebook')
    const x = fakePublisher('x')
    const resolve = resolverReturning({
      facebook: { ok: true, publisher: fb },
      x: { ok: true, publisher: x },
    })
    const result = await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolve, sleep: noSleep },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'accFb', platform: 'facebook' },
          { accountId: 'accX', platform: 'x' },
        ],
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.publishedCount).toBe(2)
    expect(result.outcomes).toEqual([
      { accountId: 'accFb', platform: 'facebook', status: 'published', detail: null, externalId: 'facebook_5' },
      { accountId: 'accX', platform: 'x', status: 'published', detail: null, externalId: 'x_5' },
    ])
    expect(fb.publish).toHaveBeenCalledWith({ text: 'hello', mediaUrl: undefined })
  })

  it('passes the media url through to the publishers', async () => {
    const fb = fakePublisher('facebook')
    const result = await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolverReturning({ facebook: { ok: true, publisher: fb } }), sleep: noSleep },
      {
        locationId: 'locA',
        post: { body: 'pic day', mediaUrl: 'https://img.example/a.jpg' },
        targets: [{ accountId: 'accFb', platform: 'facebook' }],
      },
    )
    expect(result.ok).toBe(true)
    expect(fb.publish).toHaveBeenCalledWith({ text: 'pic day', mediaUrl: 'https://img.example/a.jpg' })
  })

  it('isolates one failing target — the rest still publish and the failure is recorded honestly', async () => {
    const fb = fakePublisher('facebook')
    const ig = fakePublisher('instagram', { fail: 'instagram needs an image — add an image URL to this post' })
    const result = await publishSocialPost(
      {
        db: new FakeDatabase(),
        resolvePublisher: resolverReturning({
          facebook: { ok: true, publisher: fb },
          instagram: { ok: true, publisher: ig },
        }),
        sleep: noSleep,
      },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'accIg', platform: 'instagram' },
          { accountId: 'accFb', platform: 'facebook' },
        ],
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.publishedCount).toBe(1)
    expect(result.outcomes).toEqual([
      {
        accountId: 'accIg',
        platform: 'instagram',
        status: 'failed',
        detail: 'instagram needs an image — add an image URL to this post',
        externalId: null,
      },
      { accountId: 'accFb', platform: 'facebook', status: 'published', detail: null, externalId: 'facebook_5' },
    ])
  })

  it('reports ok:false with the unique reasons when NOTHING published (post must stay put)', async () => {
    const resolve = resolverReturning({}) // nothing configured
    const result = await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolve, sleep: noSleep },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'a1', platform: 'tiktok' },
          { accountId: 'a2', platform: 'tiktok' },
          { accountId: 'a3', platform: 'youtube' },
        ],
      },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'publishing to tiktok is not supported yet; publishing to youtube is not supported yet',
    })
  })

  it('resolves each platform once even with several targets on it', async () => {
    const fb = fakePublisher('facebook')
    const resolve = resolverReturning({ facebook: { ok: true, publisher: fb } })
    await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolve, sleep: noSleep },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'page1', platform: 'facebook' },
          { accountId: 'page2', platform: 'facebook' },
        ],
      },
    )
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(fb.publish).toHaveBeenCalledTimes(2)
  })

  it('paces provider calls — sleeps between targets, not before the first', async () => {
    const fb = fakePublisher('facebook')
    const x = fakePublisher('x')
    const sleep = vi.fn(async () => {})
    await publishSocialPost(
      {
        db: new FakeDatabase(),
        resolvePublisher: resolverReturning({
          facebook: { ok: true, publisher: fb },
          x: { ok: true, publisher: x },
        }),
        throttleMs: 250,
        sleep,
      },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'accFb', platform: 'facebook' },
          { accountId: 'accX', platform: 'x' },
        ],
      },
    )
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(250)
  })

  it('an unresolvable target does not block a resolvable one', async () => {
    const fb = fakePublisher('facebook')
    const result = await publishSocialPost(
      { db: new FakeDatabase(), resolvePublisher: resolverReturning({ facebook: { ok: true, publisher: fb } }), sleep: noSleep },
      {
        locationId: 'locA',
        post: { body: 'hello' },
        targets: [
          { accountId: 'accTk', platform: 'tiktok' },
          { accountId: 'accFb', platform: 'facebook' },
        ],
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.publishedCount).toBe(1)
    expect(result.outcomes[0]).toEqual({
      accountId: 'accTk',
      platform: 'tiktok',
      status: 'failed',
      detail: 'publishing to tiktok is not supported yet',
      externalId: null,
    })
  })
})
