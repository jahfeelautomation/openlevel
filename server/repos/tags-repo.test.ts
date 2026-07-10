import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PgliteDatabase } from '../db/pglite-database'
import { TagsRepo } from './tags-repo'

// Tag math (counts, rename dedup, array_remove) lives in real array SQL, so this
// suite runs against a live in-process Postgres rather than FakeDatabase — a
// string check can't prove unnest/array_replace behave.
const SCHEMA = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8')

async function setup() {
  const pg = new PGlite()
  await pg.exec(SCHEMA)
  const db = new PgliteDatabase(pg)
  const loc = 'loc_test'
  const other = 'loc_other'
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Test','test')", [loc])
  await db.query("INSERT INTO locations (id, name, slug) VALUES ($1,'Other','other')", [other])
  return { db, loc, other }
}

function addContact(db: PgliteDatabase, loc: string, id: string, tags: string[]) {
  return db.query('INSERT INTO contacts (id, location_id, name, tags) VALUES ($1,$2,$3,$4)', [
    id,
    loc,
    id,
    tags,
  ])
}

function tagsOf(db: PgliteDatabase, id: string) {
  return db
    .query<{ tags: string[] }>('SELECT tags FROM contacts WHERE id=$1', [id])
    .then((r) => r[0]?.tags ?? [])
}

test('list returns distinct tags with contact counts, busiest first', async () => {
  const { db, loc } = await setup()
  await addContact(db, loc, 'c1', ['vip', 'lead'])
  await addContact(db, loc, 'c2', ['lead'])
  await addContact(db, loc, 'c3', ['lead', 'seller'])
  await addContact(db, loc, 'c4', []) // an untagged contact contributes nothing

  const tags = await new TagsRepo(db, loc).list()
  expect(tags).toEqual([
    { tag: 'lead', count: 3 },
    { tag: 'seller', count: 1 },
    { tag: 'vip', count: 1 },
  ])
})

test('list is scoped to the location (no cross-tenant bleed)', async () => {
  const { db, loc, other } = await setup()
  await addContact(db, loc, 'c1', ['lead'])
  await addContact(db, other, 'o1', ['secret'])

  expect(await new TagsRepo(db, loc).list()).toEqual([{ tag: 'lead', count: 1 }])
})

test('rename moves a tag across all contacts and reports the count', async () => {
  const { db, loc } = await setup()
  await addContact(db, loc, 'c1', ['lead'])
  await addContact(db, loc, 'c2', ['lead', 'vip'])

  const n = await new TagsRepo(db, loc).rename('lead', 'prospect')
  expect(n).toBe(2)
  expect(await tagsOf(db, 'c1')).toEqual(['prospect'])
  expect([...(await tagsOf(db, 'c2'))].sort()).toEqual(['prospect', 'vip'])
})

test('rename into an existing tag merges without duplicating', async () => {
  const { db, loc } = await setup()
  await addContact(db, loc, 'c1', ['lead', 'vip'])

  const n = await new TagsRepo(db, loc).rename('lead', 'vip')
  expect(n).toBe(1)
  expect(await tagsOf(db, 'c1')).toEqual(['vip']) // merged, not ['vip','vip']
})

test('rename of an absent tag touches nobody', async () => {
  const { db, loc } = await setup()
  await addContact(db, loc, 'c1', ['lead'])

  expect(await new TagsRepo(db, loc).rename('ghost', 'spirit')).toBe(0)
  expect(await tagsOf(db, 'c1')).toEqual(['lead'])
})

test('remove strips a tag from every contact and reports the count', async () => {
  const { db, loc } = await setup()
  await addContact(db, loc, 'c1', ['lead', 'vip'])
  await addContact(db, loc, 'c2', ['lead'])
  await addContact(db, loc, 'c3', ['seller'])

  const n = await new TagsRepo(db, loc).remove('lead')
  expect(n).toBe(2)
  expect(await tagsOf(db, 'c1')).toEqual(['vip'])
  expect(await tagsOf(db, 'c2')).toEqual([])
  expect(await tagsOf(db, 'c3')).toEqual(['seller']) // untouched
})

test('rename and remove only touch the target location', async () => {
  const { db, loc, other } = await setup()
  await addContact(db, loc, 'c1', ['lead'])
  await addContact(db, other, 'o1', ['lead'])

  await new TagsRepo(db, loc).rename('lead', 'prospect')
  expect(await tagsOf(db, 'o1')).toEqual(['lead']) // other tenant untouched

  await new TagsRepo(db, loc).remove('prospect')
  expect(await tagsOf(db, 'o1')).toEqual(['lead']) // still untouched
})
