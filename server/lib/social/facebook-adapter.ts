import type { PublishResult, SocialPostMessage, SocialPublisher } from './provider'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface FacebookAdapterConfig {
  /** The Facebook Page id the location publishes as (non-secret, lives in settings). */
  pageId: string
  /** The LOCATION's own Page access token — resolved by name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Facebook Page adapter. Posts go out as the location's own Page through the
 * Graph API: text posts hit the /feed edge, posts with an image hit /photos.
 * The token rides in the POST body — never the URL, which lands in proxy logs.
 */
export function createFacebookAdapter(config: FacebookAdapterConfig): SocialPublisher {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    platform: 'facebook',

    async publish(msg: SocialPostMessage): Promise<PublishResult> {
      const url = msg.mediaUrl
        ? `${GRAPH_BASE}/${config.pageId}/photos`
        : `${GRAPH_BASE}/${config.pageId}/feed`
      const payload = msg.mediaUrl
        ? { url: msg.mediaUrl, caption: msg.text, access_token: config.accessToken }
        : { message: msg.text, access_token: config.accessToken }

      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // The token must never ride along on the error (it would land in logs).
      if (!res.ok) throw new Error(`facebook publish failed: ${res.status}`)
      const data = (await res.json()) as { id?: string }
      if (!data.id) throw new Error('facebook publish response missing post id')
      return { externalId: data.id, platform: 'facebook' }
    },
  }
}
