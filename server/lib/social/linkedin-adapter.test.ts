import { describe, expect, it, vi } from 'vitest'
import { createLinkedinAdapter } from './linkedin-adapter'

const TOKEN = 'li-fake-access-token-not-real'
const AUTHOR = 'urn:li:organization:5515715'

function okFetch(json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 201 }))
}

describe('linkedin adapter: publish', () => {
  it('POSTs a public UGC share as the configured author with a bearer token', async () => {
    const fetchImpl = okFetch({ id: 'urn:li:share:712' })
    const li = createLinkedinAdapter({ authorUrn: AUTHOR, accessToken: TOKEN, fetchImpl })

    const result = await li.publish({ text: 'Hiring a project manager in Phoenix.' })

    expect(result).toEqual({ externalId: 'urn:li:share:712', platform: 'linkedin' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.linkedin.com/v2/ugcPosts')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers['x-restli-protocol-version']).toBe('2.0.0')
    const body = JSON.parse(String(init.body)) as {
      author: string
      lifecycleState: string
      specificContent: Record<string, { shareCommentary: { text: string }; shareMediaCategory: string }>
      visibility: Record<string, string>
    }
    expect(body.author).toBe(AUTHOR)
    expect(body.lifecycleState).toBe('PUBLISHED')
    const share = body.specificContent['com.linkedin.ugc.ShareContent']
    expect(share?.shareCommentary.text).toBe('Hiring a project manager in Phoenix.')
    expect(share?.shareMediaCategory).toBe('NONE')
    expect(body.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('PUBLIC')
  })

  it('honestly refuses a post with media instead of silently dropping the image', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const li = createLinkedinAdapter({ authorUrn: AUTHOR, accessToken: TOKEN, fetchImpl })
    await expect(li.publish({ text: 'x', mediaUrl: 'https://cdn.example.com/a.jpg' })).rejects.toThrow(/image/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws with only the status when LinkedIn rejects the share, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"denied"}', { status: 401 }))
    const li = createLinkedinAdapter({ authorUrn: AUTHOR, accessToken: TOKEN, fetchImpl })
    await expect(li.publish({ text: 'x' })).rejects.toThrow(/401/)
    await expect(li.publish({ text: 'x' })).rejects.not.toThrow(new RegExp(TOKEN))
  })

  it('throws when the response has no share id', async () => {
    const li = createLinkedinAdapter({ authorUrn: AUTHOR, accessToken: TOKEN, fetchImpl: okFetch({}) })
    await expect(li.publish({ text: 'x' })).rejects.toThrow(/missing/)
  })
})
