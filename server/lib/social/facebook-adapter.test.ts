import { describe, expect, it, vi } from 'vitest'
import { createFacebookAdapter } from './facebook-adapter'

const TOKEN = 'EAAfake-page-token-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
}

describe('facebook adapter: publish', () => {
  it('POSTs a text post to the page feed with the page token in the body, never the URL', async () => {
    const fetchImpl = okFetch({ id: '1234_5678' })
    const fb = createFacebookAdapter({ pageId: '1234', accessToken: TOKEN, fetchImpl })

    const result = await fb.publish({ text: 'We buy houses in any condition.' })

    expect(result).toEqual({ externalId: '1234_5678', platform: 'facebook' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v21.0/1234/feed')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.message).toBe('We buy houses in any condition.')
    expect(body.access_token).toBe(TOKEN)
    // The token must never land in the URL (URLs end up in proxy/server logs).
    expect(url).not.toContain(TOKEN)
  })

  it('publishes an image post through the photos edge when the post has media', async () => {
    const fetchImpl = okFetch({ id: 'photo_99' })
    const fb = createFacebookAdapter({ pageId: '1234', accessToken: TOKEN, fetchImpl })

    const result = await fb.publish({
      text: 'Before and after.',
      mediaUrl: 'https://cdn.example.com/flip.jpg',
    })

    expect(result).toEqual({ externalId: 'photo_99', platform: 'facebook' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v21.0/1234/photos')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.url).toBe('https://cdn.example.com/flip.jpg')
    expect(body.caption).toBe('Before and after.')
  })

  it('throws with only the status when the Graph API rejects the post, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"code":190}}', { status: 400 }))
    const fb = createFacebookAdapter({ pageId: '1234', accessToken: TOKEN, fetchImpl })
    await expect(fb.publish({ text: 'x' })).rejects.toThrow(/400/)
    await expect(fb.publish({ text: 'x' })).rejects.not.toThrow(new RegExp(TOKEN))
  })

  it('throws when the response has no post id', async () => {
    const fb = createFacebookAdapter({ pageId: '1234', accessToken: TOKEN, fetchImpl: okFetch({}) })
    await expect(fb.publish({ text: 'x' })).rejects.toThrow(/missing/)
  })
})
