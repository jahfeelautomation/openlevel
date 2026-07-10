/**
 * Contact identity helpers. A contact is deduped within a location by a
 * normalized phone (preferred) or email. The key is always location-scoped so
 * the same phone in two locations stays two distinct contacts.
 */

export function normalizePhone(raw: string): string {
  const kept = raw.replace(/[^\d+]/g, '')
  const digits = kept.replace(/\+/g, '')
  if (kept.startsWith('+')) return '+' + digits
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return '+' + digits
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function matchKey(
  locationId: string,
  c: { phone?: string; email?: string },
): string | null {
  // A phone only dedupes if it carries at least one digit. Otherwise normalizePhone
  // collapses junk like " ", "()", or "abc" to a bare "+", and every such contact
  // would share the key `<loc>|phone|+` — merging unrelated people into one record.
  // A digit-free phone falls through to email, then to an anonymous (keyless) insert.
  if (c.phone) {
    const phone = normalizePhone(c.phone)
    if (/\d/.test(phone)) return `${locationId}|phone|${phone}`
  }
  if (c.email) {
    const email = normalizeEmail(c.email)
    if (email) return `${locationId}|email|${email}`
  }
  return null
}
