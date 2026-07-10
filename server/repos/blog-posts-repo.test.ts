import { FakeDatabase } from '../db/fake-database'
import { BlogPostsRepo } from './blog-posts-repo'

test('list scopes the read to the location ($1), newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', location_id: 'locA' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.list()
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('listPublished filters to published, scoped, newest-published first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'published' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.listPublished()
  // The location filter is injected before the existing WHERE predicate.
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND status='published'/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY published_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA'])
})

test('get reads one post scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.get('p1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})

test('getBySlug reads one post scoped to location + slug', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', slug: 'cash-offers' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.getBySlug('cash-offers')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND slug=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'cash-offers'])
})

test('create sets location $1, defaults status draft, stamps published_at only when published', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new', location_id: 'locA', status: 'draft' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.create({ title: 'Cash Offers 101', slug: 'cash-offers-101' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/INSERT INTO blog_posts/i)
  // published_at is derived in SQL from the status param, never trusted from input.
  expect(call?.sql).toMatch(/CASE WHEN \$9='published' THEN now\(\) ELSE NULL END/i)
  expect(call?.params?.[0]).toBe('locA') // location_id is $1
  expect(call?.params).toContain('Cash Offers 101')
  expect(call?.params).toContain('cash-offers-101')
  expect(call?.params).toContain('draft') // default status ($9)
})

test('create honors an explicit published status', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p_new' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.create({ title: 'T', slug: 's', status: 'published' })
  expect(db.calls[0]?.params).toContain('published')
})

test('update patches only supplied fields, scoped, refreshing updated_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', title: 'New' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.update('p1', { title: 'New' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE blog_posts SET title=\$2, updated_at=now\(\)/i)
  expect(call?.sql).toMatch(/WHERE location_id=\$1 AND id=\$3/i)
  expect(call?.params).toEqual(['locA', 'New', 'p1'])
})

test('publishing stamps published_at the first time only (COALESCE)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'published' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.update('p1', { status: 'published' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(
    /SET status=\$2, published_at=COALESCE\(published_at, now\(\)\), updated_at=now\(\)/i,
  )
  expect(call?.params).toEqual(['locA', 'published', 'p1'])
})

test('unpublishing sets status without touching published_at', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'p1', status: 'draft' }])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.update('p1', { status: 'draft' })
  const call = db.calls[0]
  expect(call?.sql).toMatch(/SET status=\$2, updated_at=now\(\)/i)
  expect(call?.sql).not.toMatch(/published_at/i)
  expect(call?.params).toEqual(['locA', 'draft', 'p1'])
})

test('remove deletes scoped to location + id', async () => {
  const db = new FakeDatabase()
  db.enqueue([])
  const repo = new BlogPostsRepo(db, 'locA')

  await repo.remove('p1')
  expect(db.calls[0]?.sql).toMatch(/DELETE FROM blog_posts WHERE location_id=\$1 AND id=\$2/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'p1'])
})
