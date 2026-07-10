import { FakeDatabase } from '../db/fake-database'
import { CalendarsRepo } from './calendars-repo'

test('list scopes to the location (location_id = $1)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1' }, { id: 'c2' }])
  const repo = new CalendarsRepo(db, 'locA')
  await repo.list()

  expect(db.calls[0]?.params).toEqual(['locA'])
  expect(db.calls[0]?.sql).toMatch(/location_id = \$1/i)
})

test('create sets location_id explicitly ($1) and defaults color/duration', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c_new', location_id: 'locA', name: 'Inspections' }])
  const repo = new CalendarsRepo(db, 'locA')
  const cal = await repo.create({ name: 'Inspections' })

  expect(cal.id).toBe('c_new')
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
  expect(db.calls[0]?.params).toContain('Inspections')
  expect(db.calls[0]?.params).toContain('indigo') // default color
  expect(db.calls[0]?.params).toContain(30) // default duration_min
})

test('get scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA' }])
  const repo = new CalendarsRepo(db, 'locA')
  const cal = await repo.get('c1')

  expect(cal?.id).toBe('c1')
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('getByBookingSlug stays tenancy-bound (location_id = $1) for the public path', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', location_id: 'locA', booking_slug: 'cash-offer' }])
  const repo = new CalendarsRepo(db, 'locA')
  const cal = await repo.getByBookingSlug('cash-offer')

  expect(cal?.id).toBe('c1')
  expect(db.calls[0]?.sql).toMatch(/location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/booking_slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cash-offer'])
})

test('update builds a dynamic SET, json-encodes availability, and pins id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', booking_enabled: true }])
  const repo = new CalendarsRepo(db, 'locA')
  const windows = [{ weekday: 1, start: '09:00', end: '17:00' }]
  await repo.update('c1', { bookingEnabled: true, bookingSlug: 'cash-offer', availability: windows })

  const call = db.calls[0]
  expect(call?.sql).toMatch(/booking_enabled=\$2/i)
  expect(call?.sql).toMatch(/booking_slug=\$3/i)
  expect(call?.sql).toMatch(/availability=\$4/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$5/i)
  expect(call?.params).toEqual(['locA', true, 'cash-offer', JSON.stringify(windows), 'c1'])
})

test('update is a no-op (no query) when the patch is empty', async () => {
  const db = new FakeDatabase()
  const repo = new CalendarsRepo(db, 'locA')
  const result = await repo.update('c1', {})

  expect(result).toBeUndefined()
  expect(db.calls).toHaveLength(0)
})

test('update can clear the booking slug by passing null', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', booking_slug: null }])
  const repo = new CalendarsRepo(db, 'locA')
  await repo.update('c1', { bookingSlug: null })

  expect(db.calls[0]?.sql).toMatch(/booking_slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', null, 'c1'])
})
