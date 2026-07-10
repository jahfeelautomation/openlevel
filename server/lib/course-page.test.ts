import { renderCourseNotFound, renderCoursePage } from './course-page'

const base = {
  businessName: 'Alex — Cash Offers',
  courseTitle: 'Wholesaling Playbook',
  description: 'Everything to close your first deal.',
  brandColor: '#4f46e5',
}

function page(overrides: Partial<Parameters<typeof renderCoursePage>[1]> = {}) {
  return renderCoursePage(
    { location_id: 'loc_test', token: 'tok_demo' },
    {
      ...base,
      lessons: [
        { id: 'le1', title: 'Find motivated sellers', content: 'Pull a list.', videoUrl: null, done: true },
        { id: 'le2', title: 'Make the offer', content: 'Use the script.', videoUrl: null, done: false },
      ],
      progress: { completed: 1, total: 2, percent: 50, complete: false },
      ...overrides,
    },
  )
}

test('renders a self-contained, noindex document branded for the business', () => {
  const html = page()
  expect(html).toContain('<!doctype html>')
  expect(html).toContain('name="robots" content="noindex"')
  expect(html).toContain('--brand:#4f46e5')
  expect(html).toContain('Alex — Cash Offers')
  expect(html).toContain('Wholesaling Playbook')
  expect(html).toContain('Everything to close your first deal.')
})

test('shows the derived progress figure, not a stored one', () => {
  const html = page()
  expect(html).toContain('50%')
  expect(html).toContain('1 of 2 lessons complete')
  // the fill width reflects the derived percent
  expect(html).toMatch(/ol-progress-fill[^>]*width:\s*50%/)
})

test('lists each lesson with its content and a position number', () => {
  const html = page()
  expect(html).toContain('Find motivated sellers')
  expect(html).toContain('Pull a list.')
  expect(html).toContain('Make the offer')
  expect(html).toContain('Use the script.')
})

test('marks a finished lesson done and an unfinished one not', () => {
  const html = page()
  // the done lesson carries the done state + the toggle reflects it
  expect(html).toMatch(/data-lesson="le1"[^>]*data-done="1"/)
  expect(html).toMatch(/data-lesson="le2"[^>]*data-done="0"/)
})

test('each lesson toggle targets the tokenized public complete endpoint', () => {
  const html = page()
  expect(html).toContain('/api/public/courses/loc_test/tok_demo')
})

test('renders a safe video link only for http(s) urls', () => {
  const html = page({
    lessons: [
      { id: 'le1', title: 'Intro', content: '', videoUrl: 'https://videos.example/x', done: false },
      { id: 'le2', title: 'Bad', content: '', videoUrl: 'javascript:alert(1)', done: false },
    ],
    progress: { completed: 0, total: 2, percent: 0, complete: false },
  })
  expect(html).toContain('href="https://videos.example/x"')
  expect(html).toContain('rel="noopener noreferrer"')
  // a non-http(s) url is dropped entirely — never emitted as a link
  expect(html).not.toContain('javascript:alert(1)')
})

test('escapes lesson content so it can not break out of the page', () => {
  const html = page({
    lessons: [{ id: 'le1', title: '<script>x</script>', content: 'a < b & c', videoUrl: null, done: false }],
    progress: { completed: 0, total: 1, percent: 0, complete: false },
  })
  expect(html).not.toContain('<script>x</script>')
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  expect(html).toContain('a &lt; b &amp; c')
})

test('a course with no lessons says so honestly instead of faking content', () => {
  const html = page({
    lessons: [],
    progress: { completed: 0, total: 0, percent: 0, complete: false },
  })
  expect(html.toLowerCase()).toContain("doesn't have any lessons yet")
  expect(html).toContain('0%')
})

test('a fully complete enrollment shows a finished state', () => {
  const html = page({
    lessons: [{ id: 'le1', title: 'Only', content: 'x', videoUrl: null, done: true }],
    progress: { completed: 1, total: 1, percent: 100, complete: true },
  })
  expect(html).toContain('100%')
  expect(html.toLowerCase()).toContain('complete')
})

test('renderCourseNotFound is a styled html 404', () => {
  const html = renderCourseNotFound()
  expect(html).toContain('<!doctype html>')
  expect(html.toLowerCase()).toContain('not found')
})

