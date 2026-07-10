import type { Database } from '../../db/database'
import { LocationsRepo } from '../../repos/locations-repo'
import type { SocialSettings } from '../social/resolve'
import { resolveSecret } from '../vault'
import { createFacebookReviewsSource } from './facebook-reviews-adapter'
import { createGoogleReviewsSource } from './google-reviews-adapter'
import type { ReviewSource } from './provider'

export type ResolvedReviewSource =
  | { ok: true; reviewSource: ReviewSource }
  | { ok: false; reason: string }

/** The platforms with a real review-import adapter. */
export const REVIEW_SYNC_SOURCES = ['google', 'facebook'] as const
export type ReviewSyncSource = (typeof REVIEW_SYNC_SOURCES)[number]

/**
 * Build the review source for one location + platform from its settings +
 * secrets — the import mirror of resolveSocialPublisher. The non-secret ids
 * live in settings.social (Google Business account/location ids alongside the
 * publishing ids); the tokens are the LOCATION's own keys, resolved by NAME
 * from the vault layer (D-36): <slug>:google_business:access_token, and for
 * Facebook the SAME <slug>:facebook:page_token publishing uses — one
 * connection, both directions. Missing config reports a reason instead of
 * throwing so routes can answer with honest copy.
 */
export async function resolveReviewSource(
  db: Database,
  locationId: string,
  source: string,
): Promise<ResolvedReviewSource> {
  const location = await new LocationsRepo(db).getById(locationId)
  if (!location) return { ok: false, reason: 'location not found' }

  const social = (location.settings?.social ?? {}) as SocialSettings
  const slug = location.client_slug ?? location.slug

  switch (source) {
    case 'google': {
      if (!social.googleAccountId) return { ok: false, reason: 'google business account id is not configured' }
      if (!social.googleLocationId) return { ok: false, reason: 'google business location id is not configured' }
      const accessToken = resolveSecret(`${slug}:google_business:access_token`)
      if (!accessToken) return { ok: false, reason: 'google business access token is not configured' }
      return {
        ok: true,
        reviewSource: createGoogleReviewsSource({
          accountId: social.googleAccountId,
          locationId: social.googleLocationId,
          accessToken,
        }),
      }
    }
    case 'facebook': {
      if (!social.facebookPageId) return { ok: false, reason: 'facebook page id is not configured' }
      const accessToken = resolveSecret(`${slug}:facebook:page_token`)
      if (!accessToken) return { ok: false, reason: 'facebook page token is not configured' }
      return {
        ok: true,
        reviewSource: createFacebookReviewsSource({ pageId: social.facebookPageId, accessToken }),
      }
    }
    default:
      return { ok: false, reason: `syncing reviews from ${source} is not supported yet` }
  }
}
