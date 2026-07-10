import { FakeDatabase } from '../db/fake-database'
import { CoursesRepo } from './courses-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co1', location_id: 'locA' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.list()
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads one course scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co1' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.get('co1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'co1'])
})

test('getBySlug reads one course scoped to location + slug', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co1', slug: 'wholesaling' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.getBySlug('wholesaling')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'wholesaling'])
})

test('create sets location $1 and defaults status to draft', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co_new', location_id: 'locA', status: 'draft' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.create({ title: 'Wholesaling Playbook', slug: 'wholesaling' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO courses/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('Wholesaling Playbook')
  expect(call?.params).toContain('wholesaling')
  expect(call?.params).toContain('draft') // default status
})

test('create honors an explicit published status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co_new' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.create({ title: 'T', slug: 's', status: 'published' })
  expect(db.calls[0]?.params).toContain('published')
})

test('update patches only supplied fields, scoped, refreshing updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co1', status: 'published' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.update('co1', { status: 'published' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE courses SET status=\$2, updated_at=now\(\)/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(call?.params).toEqual(['locA', 'published', 'co1'])
})

test('update numbers multiple fields from $2 and binds id last', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'co1' }])
  const repo = new CoursesRepo(db, 'locA')

  await repo.update('co1', { title: 'New', slug: 'new-slug' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/SET title=\$2, slug=\$3, updated_at=now\(\)/i)
  expect(call?.sql).toMatch(/id=\$4/i)
  expect(call?.params).toEqual(['locA', 'New', 'new-slug', 'co1'])
})

test('remove deletes scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new CoursesRepo(db, 'locA')

  await repo.remove('co1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM courses WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'co1'])
})
