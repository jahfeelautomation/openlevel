import type { Database } from '../../db/database'
import { LocationsRepo } from '../../repos/locations-repo'
import { resolveSecret } from '../vault'
import { createFacebookAdapter } from './facebook-adapter'
import { createInstagramAdapter } from './instagram-adapter'
import { createLinkedinAdapter } from './linkedin-adapter'
import type { SocialPublisher } from './provider'
import { createXAdapter } from './x-adapter'

/** What a location configured under settings.social — only the NON-secret ids.
 *  Tokens stay in the vault and resolve by name (D-36). */
export interface SocialSettings {
  /** The Facebook Page the location publishes as. */
  facebookPageId?: string
  /** The Instagram professional-account id. */
  instagramUserId?: string
  /** Who LinkedIn posts publish as — a member or organization URN. */
  linkedinAuthorUrn?: string
  /** Google Business Profile account + location ids — review sync (Module 51)
   *  reads the listing's reviews; there is no publish adapter for GBP. */
  googleAccountId?: string
  googleLocationId?: string
}

export type ResolvedSocialPublisher =
  | { ok: true; publisher: SocialPublisher }
  | { ok: false; reason: string }

/** The platforms with a real publish adapter. The planner's other platforms
 *  (TikTok, YouTube, Google Business) resolve to an honest "not supported". */
export const PUBLISHABLE_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'x'] as const
export type PublishablePlatform = (typeof PUBLISHABLE_PLATFORMS)[number]

/**
 * Build the publisher for one location + platform from its settings + secrets —
 * the social mirror of resolvePaymentProvider / resolveEmailSender. Non-secret
 * ids (page id, IG account id, author URN) live in settings.social; the tokens
 * are the LOCATION's own keys, resolved by NAME from the vault layer (D-36):
 * <slug>:facebook:page_token, <slug>:instagram:access_token,
 * <slug>:linkedin:access_token, <slug>:x:access_token. Missing config reports
 * a reason instead of throwing so routes can answer with honest copy.
 */
export async function resolveSocialPublisher(
  db: Database,
  locationId: string,
  platform: string,
): Promise<ResolvedSocialPublisher> {
  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, reason: 'location not found' }

  const social = (location.settings?.social ?? {}) as SocialSettings
  const slug = location.client_slug ?? location.slug

  switch (platform) {
    case 'facebook': {
      if (!social.facebookPageId) return { ok: false, reason: 'facebook page id is not configured' }
      const accessToken = resolveSecret(`${slug}:facebook:page_token`)
      if (!accessToken) return { ok: false, reason: 'facebook page token is not configured' }
      return { ok: true, publisher: createFacebookAdapter({ pageId: social.facebookPageId, accessToken }) }
    }
    case 'instagram': {
      if (!social.instagramUserId) return { ok: false, reason: 'instagram account id is not configured' }
      const accessToken = resolveSecret(`${slug}:instagram:access_token`)
      if (!accessToken) return { ok: false, reason: 'instagram access token is not configured' }
      return { ok: true, publisher: createInstagramAdapter({ userId: social.instagramUserId, accessToken }) }
    }
    case 'linkedin': {
      if (!social.linkedinAuthorUrn) return { ok: false, reason: 'linkedin author urn is not configured' }
      const accessToken = resolveSecret(`${slug}:linkedin:access_token`)
      if (!accessToken) return { ok: false, reason: 'linkedin access token is not configured' }
      return { ok: true, publisher: createLinkedinAdapter({ authorUrn: social.linkedinAuthorUrn, accessToken }) }
    }
    case 'x': {
      const accessToken = resolveSecret(`${slug}:x:access_token`)
      if (!accessToken) return { ok: false, reason: 'x access token is not configured' }
      return { ok: true, publisher: createXAdapter({ accessToken }) }
    }
    default:
      return { ok: false, reason: `publishing to ${platform} is not supported yet` }
  }
}
