/**
 * Social publishing provider contracts (Module 50). Same shape discipline as
 * lib/payments + lib/sending: tiny interfaces, adapters own the HTTP, the
 * resolver owns settings + secret names. Posts go out through the LOCATION's
 * own page/profile tokens — OpenLevel never owns the audience relationship.
 */

/** One composed post, ready to hand to a network. */
export interface SocialPostMessage {
  text: string
  /** Optional hosted image URL. Facebook posts it through the photos edge,
   *  Instagram requires it; LinkedIn/X adapters honestly refuse a post with
   *  media rather than silently dropping the image. */
  mediaUrl?: string
}

export interface PublishResult {
  /** Platform-side post id, for audits. */
  externalId: string
  platform: string
}

export interface SocialPublisher {
  platform: string
  publish(msg: SocialPostMessage): Promise<PublishResult>
}
