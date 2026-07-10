import { describe, expect, it, vi } from 'vitest'
import { createXAdapter } from './x-adapter'

const TOKEN = 'x-fake-oauth2-user-token-not-real'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

describe('x adapter: publish', () => {
  it('POSTs the text to /2/tweets with a bearer token', async () => {
    const fetchImpl = okFetch({ data: { id: '1849000000000000000', text: 'posted' } })
    const x = createXAdapter({ accessToken: TOKEN, fetchImpl })

    const result = await x.publish({ text: 'Closed in 9 days. Cash offer, no repairs.' })

    expect(result).toEqual({ externalId: '1849000000000000000', platform: 'x' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.x.com/2/tweets')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({ text: 'Closed in 9 days. Cash offer, no repairs.' })
  })

  it('honestly refuses a post with media instead of silently dropping the image', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const x = createXAdapter({ accessToken: TOKEN, fetchImpl })
    await expect(x.publish({ text: 'x', mediaUrl: 'https://cdn.example.com/a.jpg' })).rejects.toThrow(/image/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws with only the status when X rejects the post, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"title":"Unauthorized"}', { status: 401 }))
    const x = createXAdapter({ accessToken: TOKEN, fetchImpl })
    await expect(x.publish({ text: 'x' })).rejects.toThrow(/401/)
    await expect(x.publish({ text: 'x' })).rejects.not.toThrow(new RegExp(TOKEN))
  })

  it('throws when the response has no tweet id', async () => {
    const x = createXAdapter({ accessToken: TOKEN, fetchImpl: okFetch({ data: {} }) })
    await expect(x.publish({ text: 'x' })).rejects.toThrow(/missing/)
  })
})
