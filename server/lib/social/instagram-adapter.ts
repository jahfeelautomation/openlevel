import type { PublishResult, SocialPostMessage, SocialPublisher } from './provider'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface InstagramAdapterConfig {
  /** The Instagram professional-account id (non-secret, lives in settings). */
  userId: string
  /** The LOCATION's own access token — resolved by name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Instagram adapter — the Graph API two-step: create a media container with
 * the hosted image + caption, then publish the container. Instagram has no
 * text-only feed post, so a post without media is refused honestly up front
 * instead of going out mangled or pretending to.
 */
export function createInstagramAdapter(config: InstagramAdapterConfig): SocialPublisher {
  const fetchImpl = config.fetchImpl ?? fetch

  async function graphPost(edge: string, payload: Record<string, string>): Promise<string> {
    const res = await fetchImpl(`${GRAPH_BASE}/${config.userId}/${edge}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, access_token: config.accessToken }),
    })
    // The token must never ride along on the error (it would land in logs).
    if (!res.ok) throw new Error(`instagram publish failed: ${res.status}`)
    const data = (await res.json()) as { id?: string }
    if (!data.id) throw new Error(`instagram ${edge} response missing id`)
    return data.id
  }

  return {
    platform: 'instagram',

    async publish(msg: SocialPostMessage): Promise<PublishResult> {
      if (!msg.mediaUrl) {
        throw new Error('instagram needs an image — add an image URL to this post')
      }
      const creationId = await graphPost('media', { image_url: msg.mediaUrl, caption: msg.text })
      const mediaId = await graphPost('media_publish', { creation_id: creationId })
      return { externalId: mediaId, platform: 'instagram' }
    },
  }
}
