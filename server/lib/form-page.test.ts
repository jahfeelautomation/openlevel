import type { Form } from '../repos/forms-repo'
import { renderFormNotFound, renderFormPage } from './form-page'

const form: Form = {
  id: 'fm_1',
  location_id: 'loc_test',
  name: 'Cash offer request',
  slug: 'cash-offer',
  status: 'published',
  content: {
    headline: 'Request your cash offer',
    subhead: 'Tell us about your property and we’ll be in touch today.',
    cta: 'Send my request',
    tag: 'lead',
    successMessage: 'Got it — we’ll text you within the hour.',
    fields: [
      { name: 'full_name', label: 'Full name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'address', label: 'Property address', type: 'text' },
    ],
  },
  submissions: 0,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

// --- document -------------------------------------------------------------

test('form page is a self-contained html document', () => {
  const html = renderFormPage(form)
  expect(html).toContain('<!doctype html>')
  // self-contained: no external stylesheets or remote scripts
  expect(html).not.toContain('rel="stylesheet"')
  expect(html).not.toMatch(/<script[^>]+src=/)
})

test('form page renders the headline and subhead', () => {
  const html = renderFormPage(form)
  expect(html).toContain('Request your cash offer')
  expect(html).toContain('Tell us about your property')
})

// --- fields ---------------------------------------------------------------

test('form page renders an input for every declared field with its label and type', () => {
  const html = renderFormPage(form)
  expect(html).toContain('name="full_name"')
  expect(html).toContain('name="email"')
  expect(html).toContain('name="phone"')
  expect(html).toContain('name="address"')
  expect(html).toMatch(/name="email"[^>]*type="email"/)
  expect(html).toMatch(/name="phone"[^>]*type="tel"/)
  // labels are shown to the visitor
  expect(html).toContain('Full name')
  expect(html).toContain('Property address')
})

test('form page marks required fields required and leaves optional ones optional', () => {
  const html = renderFormPage(form)
  expect(html).toMatch(/name="full_name"[^>]*required/)
  expect(html).toMatch(/name="email"[^>]*required/)
  // phone and address are not required in this form
  expect(html).not.toMatch(/name="phone"[^>]*required/)
  expect(html).not.toMatch(/name="address"[^>]*required/)
})

// --- capture wiring -------------------------------------------------------

test('form posts to the public forms submit endpoint for this exact form', () => {
  const html = renderFormPage(form)
  expect(html).toContain('action="/api/public/forms/loc_test/cash-offer/submit"')
  expect(html).toContain('<form')
})

test('form CTA uses the provided brand color and falls back to the default', () => {
  expect(renderFormPage(form, { brandColor: '#0ea5e9' })).toContain('#0ea5e9')
  expect(renderFormPage(form)).toContain('#4f46e5')
})

test('form shows the configured call to action', () => {
  expect(renderFormPage(form)).toContain('Send my request')
})

// --- inline success -------------------------------------------------------

test('the configured success message is embedded for the inline confirmation', () => {
  const html = renderFormPage(form)
  expect(html).toContain('Got it — we’ll text you within the hour.')
})

test('a form with no success message still renders with a default confirmation', () => {
  const bare: Form = {
    ...form,
    content: { headline: 'Quick question', fields: [{ name: 'email', label: 'Email', type: 'email' }] },
  }
  const html = renderFormPage(bare)
  expect(html).toContain('Quick question')
  expect(html).toContain('Thanks — we got your details.')
})

// --- safety ---------------------------------------------------------------

test('operator content is html-escaped, not injected raw', () => {
  const evil: Form = {
    ...form,
    content: { headline: 'A & B <script>alert(1)</script>', fields: [] },
  }
  const html = renderFormPage(evil)
  expect(html).toContain('A &amp; B &lt;script&gt;')
  expect(html).not.toContain('<script>alert(1)</script>')
})

test('an operator success message cannot break out of the inline capture script', () => {
  // successMessage is embedded inside the inline <script>; a naive JSON.stringify
  // would let a literal </script> close the element and inject a new one.
  const evil: Form = {
    ...form,
    content: {
      headline: 'Hi',
      fields: [],
      successMessage: 'pwn</script><script>alert(document.domain)</script>',
    },
  }
  const html = renderFormPage(evil)
  expect(html).not.toContain('pwn</script>')
  expect(html).not.toContain('<script>alert(document.domain)</script>')
  // It survives, neutralized, as <-escaped JSON inside the existing script.
  expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003e')
})

// --- 404 ------------------------------------------------------------------

test('renderFormNotFound returns a styled html 404 document', () => {
  const html = renderFormNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html.toLowerCase()).toContain('not found')
})
