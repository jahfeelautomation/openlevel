import { FakeDatabase } from '../db/fake-database'
import { LocationsRepo } from './locations-repo'

test('getById returns the location row and queries by id', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { id: 'locA', name: 'Jamal', slug: 'jamal', client_slug: 'jamal', branding: {}, settings: { replyMode: 'autonomous' } },
  ])
  const loc = await new LocationsRepo(db).getById('locA')
  expect(loc?.id).toBe('locA')
  expect(loc?.settings).toEqual({ replyMode: 'autonomous' })
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('getById returns undefined when the location is missing', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  expect(await new LocationsRepo(db).getById('nope')).toBeUndefined()
})
