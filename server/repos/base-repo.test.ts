import { FakeDatabase } from '../db/fake-database'
import { LocationScopedRepo } from './base-repo'

class ProbeRepo extends LocationScopedRepo {
  listAll() {
    return this.scopedSelect('SELECT * FROM contacts')
  }
  findById(id: string) {
    return this.scopedSelect('SELECT * FROM contacts WHERE id=$2', [id])
  }
  ordered() {
    return this.scopedSelect('SELECT * FROM contacts ORDER BY created_at DESC LIMIT $2', [10])
  }
}

test('scopedSelect always filters by location_id as $1', async () => {
  const db = new FakeDatabase()
  const repo = new ProbeRepo(db, 'locA')
  await repo.listAll()
  await repo.findById('c1')
  await repo.ordered()
  for (const call of db.calls) {
    expect(call.sql.toLowerCase()).toContain('location_id = $1')
    expect(call.params[0]).toBe('locA')
  }
})

test('extra params keep their $2+ positions after the injected location_id', async () => {
  const db = new FakeDatabase()
  await new ProbeRepo(db, 'locA').findById('c1')
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('two repos with different locations never share scope', async () => {
  const db = new FakeDatabase()
  await new ProbeRepo(db, 'locA').listAll()
  await new ProbeRepo(db, 'locB').listAll()
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(db.calls[1]?.params[0]).toBe('locB')
})

test('constructing without a locationId throws (tenancy guard)', () => {
  const db = new FakeDatabase()
  expect(() => new ProbeRepo(db, '')).toThrow(/locationId/)
})
