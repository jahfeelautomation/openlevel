import type { Survey } from '../repos/surveys-repo'
import { renderSurveyNotFound, renderSurveyPage } from './survey-page'

const survey: Survey = {
  id: 'sv_1',
  location_id: 'loc_test',
  name: 'Seller intake',
  slug: 'seller-intake',
  status: 'published',
  content: {
    headline: 'Tell us about your property',
    subhead: 'Three quick steps — about a minute.',
    cta: 'Get my cash offer',
    successMessage: 'Got it — we’ll review and text you today.',
    steps: [
      {
        id: 's1',
        title: 'About you',
        subtitle: 'So we know who to reach.',
        fields: [
          { name: 'full_name', label: 'Full name', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'tel', required: true },
        ],
      },
      {
        id: 's2',
        title: 'The property',
        fields: [
          { name: 'address', label: 'Property address', type: 'text', required: true },
          { name: 'beds', label: 'Bedrooms', type: 'select', options: ['1', '2', '3', '4+'] },
        ],
      },
      {
        id: 's3',
        title: 'Anything else',
        fields: [{ name: 'notes', label: 'Notes for us', type: 'textarea' }],
      },
    ],
  },
  submissions: 0,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

// --- document -------------------------------------------------------------

test('survey page is a self-contained html document', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('<!doctype html>')
  expect(html).not.toContain('rel="stylesheet"')
  expect(html).not.toMatch(/<script[^>]+src=/)
})

test('survey page renders the headline and subhead', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('Tell us about your property')
  expect(html).toContain('Three quick steps')
})

// --- steps ----------------------------------------------------------------

test('every step is rendered with its title, exactly one active to start', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('About you')
  expect(html).toContain('The property')
  expect(html).toContain('Anything else')
  // three step containers, the first one active
  expect((html.match(/class="ol-step[ "]/g) ?? []).length).toBe(3)
  expect((html.match(/ol-step ol-active/g) ?? []).length).toBe(1)
  expect(html).toContain('data-step="0"')
  expect(html).toContain('data-step="2"')
})

test('the progress indicator starts at step 1 of N', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('Step 1 of 3')
  expect(html).toContain('ol-progress-bar')
})

// --- fields across steps --------------------------------------------------

test('survey page renders every field across all steps', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('name="full_name"')
  expect(html).toContain('name="phone"')
  expect(html).toContain('name="address"')
  expect(html).toContain('name="beds"')
  expect(html).toContain('name="notes"')
})

test('a select field renders a dropdown with each option', () => {
  const html = renderSurveyPage(survey)
  expect(html).toMatch(/<select[^>]*name="beds"/)
  expect(html).toContain('<option value="4+">4+</option>')
})

test('a textarea field renders a multi-line box, not a single input', () => {
  const html = renderSurveyPage(survey)
  expect(html).toMatch(/<textarea[^>]*name="notes"/)
})

test('required fields are marked required, optional ones are not', () => {
  const html = renderSurveyPage(survey)
  expect(html).toMatch(/name="full_name"[^>]*required/)
  expect(html).toMatch(/name="address"[^>]*required/)
  expect(html).not.toMatch(/name="notes"[^>]*required/)
})

// --- capture wiring -------------------------------------------------------

test('survey posts to its own public submit endpoint', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('action="/api/public/surveys/loc_test/seller-intake/submit"')
  expect(html).toContain('id="ol-survey-form"')
})

test('only the final step carries the submit button; earlier steps advance', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('data-next') // earlier steps advance client-side
  expect(html).toContain('type="submit"') // final step submits
  expect(html).toContain('Get my cash offer') // configured final CTA
  expect(html).toContain('data-back') // steps after the first can go back
})

test('survey CTA uses the provided brand color and falls back to the default', () => {
  expect(renderSurveyPage(survey, { brandColor: '#0ea5e9' })).toContain('#0ea5e9')
  expect(renderSurveyPage(survey)).toContain('#4f46e5')
})

// --- inline success -------------------------------------------------------

test('the configured success message is embedded for the inline confirmation', () => {
  const html = renderSurveyPage(survey)
  expect(html).toContain('Got it — we’ll review and text you today.')
})

test('a survey with no success message still renders a default confirmation', () => {
  const bare: Survey = {
    ...survey,
    content: { steps: [{ id: 's1', title: 'One', fields: [{ name: 'email', label: 'Email' }] }] },
  }
  const html = renderSurveyPage(bare)
  expect(html).toContain('Thanks — your answers are in.')
})

// --- edge + safety --------------------------------------------------------

test('a published survey with no steps renders a clean shell, not a broken form', () => {
  const empty: Survey = { ...survey, content: { headline: 'Coming soon', steps: [] } }
  const html = renderSurveyPage(empty)
  expect(html).toContain('Coming soon')
  expect(html).toContain('no questions yet')
  expect(html).not.toContain('id="ol-survey-form"')
})

test('operator content is html-escaped, not injected raw', () => {
  const evil: Survey = {
    ...survey,
    content: {
      headline: 'A & B <script>alert(1)</script>',
      steps: [{ id: 's1', title: 'T', fields: [] }],
    },
  }
  const html = renderSurveyPage(evil)
  expect(html).toContain('A &amp; B &lt;script&gt;')
  expect(html).not.toContain('<script>alert(1)</script>')
})

// --- 404 ------------------------------------------------------------------

test('renderSurveyNotFound returns a styled html 404 document', () => {
  const html = renderSurveyNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html.toLowerCase()).toContain('not found')
})
