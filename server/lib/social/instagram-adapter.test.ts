import { describe, expect, it, vi } from 'vitest'
import { createInstagramAdapter } from './instagram-adapter'

const TOKEN = 'IGfake-access-token-not-real'

describe('instagram adapter: publish', () => {
  it('creates a media container then publishes it (the Graph two-step)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'CREATION_1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'IG_MEDIA_9' }), { status: 200 }))
    const ig = createInstagramAdapter({ userId: '178414', accessToken: TOKEN, fetchImpl })

    const result = await ig.publish({
      text: 'Another Phoenix flip done.',
      mediaUrl: 'https://cdn.example.com/flip.jpg',
    })

    expect(result).toEqual({ externalId: 'IG_MEDIA_9', platform: 'instagram' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const [containerUrl, containerInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(containerUrl).toBe('https://graph.facebook.com/v21.0/178414/media')
    const containerBody = JSON.parse(String(containerInit.body)) as Record<string, unknown>
    expect(containerBody.image_url).toBe('https://cdn.example.com/flip.jpg')
    expect(containerBody.caption).toBe('Another Phoenix flip done.')
    expect(containerBody.access_token).toBe(TOKEN)
    expect(containerUrl).not.toContain(TOKEN)

    const [publishUrl, publishInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(publishUrl).toBe('https://graph.facebook.com/v21.0/178414/media_publish')
    const publishBody = JSON.parse(String(publishInit.body)) as Record<string, unknown>
    expect(publishBody.creation_id).toBe('CREATION_1')
  })

  it('honestly refuses a text-only post — Instagram needs an image', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const ig = createInstagramAdapter({ userId: '178414', accessToken: TOKEN, fetchImpl })
    await expect(ig.publish({ text: 'no image' })).rejects.toThrow(/image/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws with only the status when the container step fails, never echoing the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{}}', { status: 403 }))
    const ig = createInstagramAdapter({ userId: '178414', accessToken: TOKEN, fetchImpl })
    const attempt = () => ig.publish({ text: 'x', mediaUrl: 'https://cdn.example.com/a.jpg' })
    await expect(attempt()).rejects.toThrow(/403/)
    await expect(attempt()).rejects.not.toThrow(new RegExp(TOKEN))
  })

  it('throws when the publish step returns no media id', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'CREATION_1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const ig = createInstagramAdapter({ userId: '178414', accessToken: TOKEN, fetchImpl })
    await expect(ig.publish({ text: 'x', mediaUrl: 'https://cdn.example.com/a.jpg' })).rejects.toThrow(/missing/)
  })
})
