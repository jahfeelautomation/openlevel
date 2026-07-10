import { renderReviewPage } from './review-page'

const request = { location_id: 'loc_test', token: 'tok_abc' }

test('review page is a self-contained html document with the star picker', () => {
  const html = renderReviewPage(request, { businessName: 'Acme Roofing' })
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('How did we do?')
  expect(html).toContain('name="rating"')
  // posts to this exact review token endpoint
  expect(html).toContain('action="/api/public/reviews/loc_test/tok_abc/submit"')
})

test('review page escapes the business name in its text nodes', () => {
  const html = renderReviewPage(request, { businessName: 'A & B <Co>' })
  expect(html).toContain('A &amp; B &lt;Co&gt;')
  expect(html).not.toContain('<Co>')
})

test('an operator business name cannot break out of the inline review script', () => {
  // businessName is interpolated into the success string embedded in the inline
  // <script>; a literal </script> must not close the element and inject script.
  const html = renderReviewPage(request, {
    businessName: 'Acme</script><script>alert(1)</script>',
  })
  expect(html).not.toContain('Acme</script>')
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('\\u003c/script\\u003e')
})
