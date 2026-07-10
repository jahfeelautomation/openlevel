import type { BadgeProps } from '../../components/ui/badge'
import type { ProposalContent, ProposalItem, ProposalStatus } from '../../lib/api'

/**
 * Sum of every line (quantity × unit_amount), in cents. This deliberately mirrors
 * the server's `proposalTotalCents` (server/lib/proposal-math.ts): a proposal's
 * total is ALWAYS derived from its line items, never stored — so the figure shown
 * here is computed the same way the server and the public signable page compute
 * it, and can never drift from the lines (or the amount the client signs for).
 */
export function proposalTotalCents(items: ProposalItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unit_amount, 0)
}

/** The line items off a proposal's content, coerced to safe numbers. Mirrors the
 *  server's `readLineItems` so client and server read the same lines from the
 *  same json — malformed entries collapse to harmless zeros, never throw. */
export function readLineItems(content: ProposalContent): ProposalItem[] {
  const raw = content.line_items
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const it = (entry ?? {}) as Partial<ProposalItem>
    return {
      description: typeof it.description === 'string' ? it.description : '',
      quantity: Number.isFinite(it.quantity) ? Number(it.quantity) : 0,
      unit_amount: Number.isFinite(it.unit_amount) ? Number(it.unit_amount) : 0,
    }
  })
}

/** How each status reads + colors in the UI. The progression is honest:
 *  draft → sent → viewed (the recipient opened it) → signed / declined. */
export const STATUS_META: Record<ProposalStatus, { label: string; badge: BadgeProps['variant'] }> = {
  draft: { label: 'Draft', badge: 'slate' },
  sent: { label: 'Sent', badge: 'amber' },
  viewed: { label: 'Viewed', badge: 'blue' },
  signed: { label: 'Signed', badge: 'green' },
  declined: { label: 'Declined', badge: 'rose' },
}

export function statusMeta(status: string): { label: string; badge: BadgeProps['variant'] } {
  return STATUS_META[status as ProposalStatus] ?? { label: status, badge: 'slate' }
}

/** Is this proposal still an editable draft? Once it's sent the recipient may
 *  already be looking at it, so its terms lock and the editor goes read-only —
 *  the operator can never quietly change what someone is about to sign. */
export function isEditable(status: string): boolean {
  return status === 'draft'
}

/** Has the recipient reached a final decision (signed or declined)? */
export function isFinal(status: string): boolean {
  return status === 'signed' || status === 'declined'
}

/** A stable UTC "June 3, 2026" for a signed date — matches the server's
 *  `formatSignedDate` so the operator reads the same date the signer saw. */
export function formatSignedDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
