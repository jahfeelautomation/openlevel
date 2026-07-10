import type { PublishResult, SocialPostMessage, SocialPublisher } from './provider'

const TWEETS_URL = 'https://api.x.com/2/tweets'

export interface XAdapterConfig {
  /** The LOCATION's own OAuth2 user token (tweet.write scope) — resolved by
   *  name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * X (Twitter) adapter — a plain text post via the v2 tweets endpoint. Media
 * needs the separate chunked-upload flow, so a post with an image is refused
 * honestly instead of going out with the image dropped.
 */
export function createXAdapter(config: XAdapterConfig): SocialPublisher {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    platform: 'x',

    async publish(msg: SocialPostMessage): Promise<PublishResult> {
      if (msg.mediaUrl) {
        throw new Error('x image posts are not supported yet — remove the image URL for this channel')
      }
      const res = await fetchImpl(TWEETS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: msg.text }),
      })
      // The token must never ride along on the error (it would land in logs).
      if (!res.ok) throw new Error(`x publish failed: ${res.status}`)
      const data = (await res.json()) as { data?: { id?: string } }
      if (!data.data?.id) throw new Error('x publish response missing tweet id')
      return { externalId: data.data.id, platform: 'x' }
    },
  }
}
