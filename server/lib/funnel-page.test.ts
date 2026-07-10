import type { FunnelStep } from '../repos/funnel-steps-repo'
import type { Funnel } from '../repos/funnels-repo'
import { renderFunnelNotFound, renderFunnelPage } from './funnel-page'

const funnel: Funnel = {
  id: 'fn_1',
  location_id: 'loc_test',
  name: 'Sell your house fast',
  slug: 'sell-fast',
  status: 'published',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

const optIn: FunnelStep = {
  id: 'st_optin',
  location_id: 'loc_test',
  funnel_id: 'fn_1',
  position: 0,
  name: 'Opt-in',
  type: 'opt_in',
  path: 'get-offer',
  content: {
    headline: 'Get a cash offer for your house in 24 hours',
    subhead: 'No repairs, no fees, no obligation.',
    cta: 'Get my cash offer',
    tag: 'lead',
    fields: [
      { name: 'full_name', label: 'Full name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
    ],
  },
  submissions: 0,
  created_at: '2026-06-01T00:00:00Z',
}

const thanks: FunnelStep = {
  id: 'st_thanks',
  location_id: 'loc_test',
  funnel_id: 'fn_1',
  position: 1,
  name: 'Thank you',
  type: 'thank_you',
  path: 'thanks',
  content: {
    headline: "You're all set — check your phone",
    body: 'We got your details and will text you your cash offer shortly.',
  },
  submissions: 0,
  created_at: '2026-06-01T00:00:00Z',
}

const sales: FunnelStep = {
  id: 'st_sales',
  location_id: 'loc_test',
  funnel_id: 'fn_1',
  position: 0,
  name: 'Sales',
  type: 'sales',
  path: 'offer',
  content: {
    headline: 'Why a cash offer beats listing',
    subhead: 'The honest math on selling as-is',
    body: 'No agent commission, no repairs, no months of showings.',
    cta: 'See my offer',
  },
  submissions: 0,
  created_at: '2026-06-01T00:00:00Z',
}

// --- opt-in ---------------------------------------------------------------

test('opt-in page is a self-contained html document', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toContain('<!doctype html>')
  // self-contained: no external stylesheets or remote scripts
  expect(html).not.toContain('rel="stylesheet"')
  expect(html).not.toMatch(/<script[^>]+src=/)
})

test('opt-in page renders the headline and subhead', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toContain('Get a cash offer for your house in 24 hours')
  expect(html).toContain('No repairs, no fees, no obligation.')
})

test('opt-in page renders an input for every declared field with its label', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toContain('name="full_name"')
  expect(html).toContain('name="email"')
  expect(html).toContain('name="phone"')
  // the email field carries the email input type
  expect(html).toMatch(/name="email"[^>]*type="email"/)
  expect(html).toMatch(/name="phone"[^>]*type="tel"/)
  // labels are shown to the visitor
  expect(html).toContain('Full name')
  expect(html).toContain('Phone')
})

test('opt-in page marks required fields required and leaves optional ones optional', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toMatch(/name="full_name"[^>]*required/)
  expect(html).toMatch(/name="phone"[^>]*required/)
  // email is not required in this funnel
  expect(html).not.toMatch(/name="email"[^>]*required/)
})

test('opt-in form posts to the public submit endpoint for this exact page', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toContain('action="/api/public/f/loc_test/sell-fast/get-offer/submit"')
  // and the form is wired for a JS-driven submit
  expect(html).toContain('<form')
})

test('opt-in CTA uses the provided brand color', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks], { brandColor: '#0ea5e9' })
  expect(html).toContain('Get my cash offer')
  expect(html).toContain('#0ea5e9')
})

test('opt-in CTA falls back to the default brand color', () => {
  const html = renderFunnelPage(funnel, optIn, [optIn, thanks])
  expect(html).toContain('#4f46e5')
})

// --- thank you ------------------------------------------------------------

test('thank-you page renders headline and body with no capture form', () => {
  const html = renderFunnelPage(funnel, thanks, [optIn, thanks])
  // apostrophe stays literal — text content only escapes & < >
  expect(html).toContain("You're all set")
  expect(html).toContain('We got your details')
  expect(html).not.toContain('<form')
  expect(html).not.toContain('<input')
})

// --- sales ----------------------------------------------------------------

test('sales page renders headline, body and a CTA that advances to the next page', () => {
  const html = renderFunnelPage(funnel, sales, [sales, thanks])
  expect(html).toContain('Why a cash offer beats listing')
  expect(html).toContain('No agent commission')
  expect(html).toContain('See my offer')
  // the next step in the funnel is "thanks"
  expect(html).toContain('/api/public/f/loc_test/sell-fast/thanks')
  expect(html).not.toContain('<form')
})

// --- safety ---------------------------------------------------------------

test('operator content is html-escaped, not injected raw', () => {
  const evil: FunnelStep = {
    ...thanks,
    content: { headline: 'A & B <script>alert(1)</script>', body: 'ok' },
  }
  const html = renderFunnelPage(funnel, evil, [evil])
  expect(html).toContain('A &amp; B &lt;script&gt;')
  expect(html).not.toContain('<script>alert(1)</script>')
})

// --- 404 ------------------------------------------------------------------

test('renderFunnelNotFound returns a styled html 404 document', () => {
  const html = renderFunnelNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html.toLowerCase()).toContain('not found')
})
