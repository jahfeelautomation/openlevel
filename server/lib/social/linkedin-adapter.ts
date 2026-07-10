import type { PublishResult, SocialPostMessage, SocialPublisher } from './provider'

const UGC_POSTS_URL = 'https://api.linkedin.com/v2/ugcPosts'

export interface LinkedinAdapterConfig {
  /** Who the post is published as — a member or organization URN (non-secret). */
  authorUrn: string
  /** The LOCATION's own access token — resolved by name, never stored here. */
  accessToken: string
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * LinkedIn UGC adapter — a public text share as the configured author.
 * Image shares need LinkedIn's separate asset-upload flow, so a post with
 * media is refused honestly instead of going out with the image dropped.
 */
export function createLinkedinAdapter(config: LinkedinAdapterConfig): SocialPublisher {
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    platform: 'linkedin',

    async publish(msg: SocialPostMessage): Promise<PublishResult> {
      if (msg.mediaUrl) {
        throw new Error('linkedin image posts are not supported yet — remove the image URL for this channel')
      }
      const res = await fetchImpl(UGC_POSTS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({
          author: config.authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: msg.text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
      })
      // The token must never ride along on the error (it would land in logs).
      if (!res.ok) throw new Error(`linkedin publish failed: ${res.status}`)
      const data = (await res.json()) as { id?: string }
      if (!data.id) throw new Error('linkedin publish response missing share id')
      return { externalId: data.id, platform: 'linkedin' }
    },
  }
}
