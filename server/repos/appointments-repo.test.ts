import { FakeDatabase } from '../db/fake-database'
import { AppointmentsRepo } from './appointments-repo'

test('listByRange scopes to location and passes [from, to) as $2/$3', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1' }])
  const repo = new AppointmentsRepo(db, 'locA')
  await repo.listByRange('2026-06-03T00:00:00Z', '2026-07-03T00:00:00Z')

  expect(db.calls[0]?.params).toEqual([
    'locA',
    '2026-06-03T00:00:00Z',
    '2026-07-03T00:00:00Z',
  ])
  expect(db.calls[0]?.sql).toMatch(/location_id = \$1/i)
})

test('listByCalendarRange filters by calendar + range, excludes cancelled, stays location-scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1' }])
  const repo = new AppointmentsRepo(db, 'locA')
  await repo.listByCalendarRange('cal1', '2025-06-09T00:00:00Z', '2025-06-10T00:00:00Z')

  expect(db.calls[0]?.sql).toMatch(/location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/calendar_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/status <> 'cancelled'/i)
  expect(db.calls[0]?.params).toEqual([
    'locA',
    'cal1',
    '2025-06-09T00:00:00Z',
    '2025-06-10T00:00:00Z',
  ])
})

test('create sets location_id explicitly ($1) and returns the row', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a_new', location_id: 'locA', title: 'Inspection' }])
  const repo = new AppointmentsRepo(db, 'locA')
  const appt = await repo.create({
    calendarId: 'cal1',
    title: 'Inspection',
    startsAt: '2026-06-04T15:00:00Z',
    endsAt: '2026-06-04T15:30:00Z',
    contactId: 'ct1',
  })

  expect(appt.id).toBe('a_new')
  expect(db.calls[0]?.params[0]).toBe('locA') // $1 = location_id
  expect(db.calls[0]?.params).toContain('cal1')
  expect(db.calls[0]?.params).toContain('Inspection')
  expect(db.calls[0]?.params).toContain('ct1')
})

test('reschedule sets both timestamps and scopes to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', starts_at: '2026-06-05T10:00:00Z' }])
  const repo = new AppointmentsRepo(db, 'locA')
  const appt = await repo.reschedule('a1', '2026-06-05T10:00:00Z', '2026-06-05T10:30:00Z')

  expect(appt?.id).toBe('a1')
  expect(db.calls[0]?.params).toEqual([
    'locA',
    '2026-06-05T10:00:00Z',
    '2026-06-05T10:30:00Z',
    'a1',
  ])
})

test('setStatus scopes the update to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', status: 'completed' }])
  const repo = new AppointmentsRepo(db, 'locA')
  const appt = await repo.setStatus('a1', 'completed')

  expect(appt?.status).toBe('completed')
  expect(db.calls[0]?.params).toEqual(['locA', 'completed', 'a1'])
})

test('get scopes the lookup to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'a1', location_id: 'locA' }])
  const repo = new AppointmentsRepo(db, 'locA')
  const appt = await repo.get('a1')

  expect(appt?.id).toBe('a1')
  expect(db.calls[0]?.params).toEqual(['locA', 'a1'])
})
