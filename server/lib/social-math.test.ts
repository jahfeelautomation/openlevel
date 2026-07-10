import {
  accountsByPlatform,
  connectedCount,
  statusCounts,
  upcomingQueue,
} from './social-math'

test('statusCounts tallies each status plus a true total', () => {
  expect(
    statusCounts([
      { status: 'draft' },
      { status: 'scheduled' },
      { status: 'scheduled' },
      { status: 'published' },
    ]),
  ).toEqual({ draft: 1, scheduled: 2, published: 1, total: 4 })
})

test('statusCounts is an honest all-zero for an empty planner', () => {
  expect(statusCounts([])).toEqual({ draft: 0, scheduled: 0, published: 0, total: 0 })
})

test('statusCounts still counts an unknown status toward total (never hides a real post)', () => {
  expect(statusCounts([{ status: 'archived' }, { status: 'draft' }])).toEqual({
    draft: 1,
    scheduled: 0,
    published: 0,
    total: 2,
  })
})

test('connectedCount counts only genuinely connected accounts', () => {
  expect(
    connectedCount([{ connected: true }, { connected: false }, { connected: true }]),
  ).toBe(2)
})

test('connectedCount is an honest 0 when nothing is connected', () => {
  expect(connectedCount([{ connected: false }, { connected: false }])).toBe(0)
})

test('accountsByPlatform summarises total + connected per platform in first-seen order', () => {
  expect(
    accountsByPlatform([
      { platform: 'facebook', connected: true },
      { platform: 'instagram', connected: false },
      { platform: 'facebook', connected: false },
    ]),
  ).toEqual([
    { platform: 'facebook', total: 2, connected: 1 },
    { platform: 'instagram', total: 1, connected: 0 },
  ])
})

test('accountsByPlatform returns an empty list when there are no accounts (invents nothing)', () => {
  expect(accountsByPlatform([])).toEqual([])
})

test('upcomingQueue keeps only future scheduled posts, soonest first', () => {
  const now = '2026-06-03T00:00:00Z'
  const out = upcomingQueue(
    [
      { id: 'a', status: 'scheduled', scheduled_at: '2026-06-10T15:00:00Z' },
      { id: 'b', status: 'scheduled', scheduled_at: '2026-06-05T09:00:00Z' },
      { id: 'c', status: 'draft', scheduled_at: '2026-06-04T09:00:00Z' },
      { id: 'd', status: 'scheduled', scheduled_at: '2026-06-01T09:00:00Z' },
      { id: 'e', status: 'published', scheduled_at: '2026-06-20T09:00:00Z' },
    ],
    now,
  )
  expect(out.map((p) => p.id)).toEqual(['b', 'a'])
})

test('upcomingQueue excludes scheduled posts with no datetime', () => {
  const out = upcomingQueue(
    [{ id: 'a', status: 'scheduled', scheduled_at: null }],
    '2026-06-03T00:00:00Z',
  )
  expect(out).toEqual([])
})

test('upcomingQueue breaks ties by id (deterministic)', () => {
  const slot = '2026-06-10T15:00:00Z'
  const out = upcomingQueue(
    [
      { id: 'z', status: 'scheduled', scheduled_at: slot },
      { id: 'a', status: 'scheduled', scheduled_at: slot },
    ],
    '2026-06-03T00:00:00Z',
  )
  expect(out.map((p) => p.id)).toEqual(['a', 'z'])
})

test('upcomingQueue includes a post scheduled exactly at now (boundary is inclusive)', () => {
  const now = '2026-06-03T12:00:00Z'
  const out = upcomingQueue([{ id: 'a', status: 'scheduled', scheduled_at: now }], now)
  expect(out.map((p) => p.id)).toEqual(['a'])
})
