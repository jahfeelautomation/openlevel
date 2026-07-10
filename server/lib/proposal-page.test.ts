import type { Proposal } from '../repos/proposals-repo'
import { formatSignedDate, renderProposalNotFound, renderProposalPage } from './proposal-page'

function makeProposal(p: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    location_id: 'loc_test',
    contact_id: null,
    title: 'Marketing retainer',
    slug: 'marketing',
    status: 'sent',
    currency: 'usd',
    content: {},
    signer_name: null,
    signed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...p,
  }
}

test('renders a self-contained, noindex document with the title and intro', () => {
  const html = renderProposalPage(
    makeProposal({ content: { intro: 'Here is what we propose.' } }),
  )
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('<meta name="robots" content="noindex" />')
  expect(html).toContain('<title>Marketing retainer</title>')
  expect(html).toContain('Marketing retainer')
  expect(html).toContain('Here is what we propose.')
})

test('renders each line item, its unit price, and the DERIVED total', () => {
  const html = renderProposalPage(
    makeProposal({
      content: {
        line_items: [
          { description: 'Strategy retainer', quantity: 2, unit_amount: 150000 },
          { description: 'Setup', quantity: 1, unit_amount: 50000 },
        ],
      },
    }),
  )
  expect(html).toContain('Strategy retainer')
  expect(html).toContain('Setup')
  expect(html).toContain('$1,500.00') // unit price of the retainer
  expect(html).toContain('$3,000.00') // 2 × $1,500 line amount
  expect(html).toContain('$3,500.00') // derived total: 2×150000 + 50000
})

test('an unsigned proposal shows a sign form posting to its own /sign endpoint', () => {
  const html = renderProposalPage(makeProposal())
  expect(html).toContain('id="ol-proposal-form"')
  expect(html).toContain('action="/api/public/proposals/loc_test/marketing/sign"')
  expect(html).toContain('name="signer_name"')
  expect(html).toContain('Agree &amp; sign')
  // The decline endpoint is wired into the inline script.
  expect(html).toContain('/api/public/proposals/loc_test/marketing/decline')
})

test('a signed proposal shows the real signer + date and NO sign form', () => {
  const html = renderProposalPage(
    makeProposal({
      status: 'signed',
      signer_name: 'Jamal Carter',
      signed_at: '2026-06-03T12:00:00Z',
    }),
  )
  expect(html).toContain('Signed by')
  expect(html).toContain('Jamal Carter')
  expect(html).toContain('June 3, 2026')
  // No way to sign again, and no client script on a finished proposal.
  expect(html).not.toContain('id="ol-proposal-form"')
  expect(html).not.toContain('Agree &amp; sign')
  expect(html).not.toContain('<script>')
})

test('a declined proposal shows a declined note and NO sign form', () => {
  const html = renderProposalPage(makeProposal({ status: 'declined' }))
  expect(html).toContain('Proposal declined')
  expect(html).not.toContain('id="ol-proposal-form"')
  expect(html).not.toContain('<script>')
})

test('escapes HTML in the title and line item descriptions (no injection)', () => {
  const html = renderProposalPage(
    makeProposal({
      title: '<script>alert(1)</script>',
      content: { line_items: [{ description: '<img src=x onerror=alert(1)>', quantity: 1, unit_amount: 100 }] },
    }),
  )
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>alert(1)')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).not.toContain('<img src=x')
})

test('applies a safe brand color and falls back when it is unsafe', () => {
  expect(renderProposalPage(makeProposal(), { brandColor: '#ff0000' })).toContain('--brand:#ff0000')
  expect(renderProposalPage(makeProposal(), { brandColor: 'red;}<script>' })).toContain(
    '--brand:#4f46e5',
  )
})

test('a proposal with no line items still renders the sign form, without a table', () => {
  const html = renderProposalPage(makeProposal({ content: { intro: 'A simple agreement.' } }))
  expect(html).toContain('id="ol-proposal-form"')
  expect(html).not.toContain('<table class="ol-items"') // no quote table
  expect(html).not.toContain('ol-total">') // and no total cell
})

test('formatSignedDate is a stable UTC date string', () => {
  expect(formatSignedDate('2026-06-03T12:00:00Z')).toBe('June 3, 2026')
  expect(formatSignedDate('not-a-date')).toBe('')
})

test('renderProposalNotFound returns a styled, self-contained 404 page', () => {
  const html = renderProposalNotFound()
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('Page not found')
})
