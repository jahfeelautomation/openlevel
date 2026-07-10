import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { FakeDatabase } from '../db/fake-database'
import { contactsRoute } from './contacts'

function harness(db: FakeDatabase, locationId = 'locA') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('operatorId', 'op1')
    c.set('locationId', locationId)
    await next()
  })
  app.route('/', contactsRoute({ db }))
  return app
}

test('lists contacts scoped to the current location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Bob' }]) // list
  const res = await harness(db).request('/')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ contacts: [{ id: 'c1', name: 'Bob' }] })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('get returns the contact with its timeline, both location-scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Bob' }]) // get
  db.enqueue([{ id: 't1', type: 'message' }]) // listByContact
  const res = await harness(db).request('/c1')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    contact: { id: 'c1', name: 'Bob' },
    timeline: [{ id: 't1', type: 'message' }],
  })
  expect(db.calls.every((call) => call.params.includes('locA'))).toBe(true)
})

test('get returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // get -> none
  const res = await harness(db).request('/missing')
  expect(res.status).toBe(404)
})

test('creates a contact from name + phone and returns 201', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c9', name: 'Admin', phones: ['+15035550142'], emails: [] }]) // upsertByMatch RETURNING *
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Admin', phone: '+15035550142' }),
  })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({
    ok: true,
    contact: { id: 'c9', name: 'Admin', phones: ['+15035550142'], emails: [] },
  })
  // upsertByMatch params: [id, locationId, name, phones, emails, key, source, externalIds]
  expect(db.calls[0]?.params[1]).toBe('locA') // location scoped
  expect(db.calls[0]?.params[2]).toBe('Admin') // name from the body
  expect(db.calls[0]?.params[6]).toBe('manual') // operator-entered source
})

test('rejects a create with no name, phone, or email before touching the db', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ' }), // whitespace-only collapses to nothing
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

// --- soft-delete (archive / restore) --------------------------------------
// The "Delete" control is operator-only (this route is behind operatorAuth) and
// is a SOFT delete — it archives, never hard-deletes. The AI assistant has no
// delete tool by construction; only the operator's own click reaches here.

test('DELETE /:id archives the contact and returns it (soft delete)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', archived_at: '2026-06-19T03:00:00Z' }]) // archive RETURNING *
  const res = await harness(db).request('/c1', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    contact: { id: 'c1', name: 'Admin', archived_at: '2026-06-19T03:00:00Z' },
  })
  expect(db.calls[0]?.params).toEqual(['locA', 'c1']) // location-scoped, by id
})

test('DELETE /:id returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // archive matched no row
  const res = await harness(db).request('/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})

test('POST /:id/restore brings an archived contact back', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', archived_at: null }]) // restore RETURNING *
  const res = await harness(db).request('/c1/restore', { method: 'POST' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    contact: { id: 'c1', name: 'Admin', archived_at: null },
  })
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('POST /:id/restore returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // restore matched no row
  const res = await harness(db).request('/missing/restore', { method: 'POST' })
  expect(res.status).toBe(404)
})

test('GET /archived lists archived contacts (routes to listArchived, not get(:id))', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', archived_at: '2026-06-19T03:00:00Z' }])
  const res = await harness(db).request('/archived')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    contacts: [{ id: 'c1', name: 'Admin', archived_at: '2026-06-19T03:00:00Z' }],
  })
  // proves it hit listArchived (archived_at IS NOT NULL), not get('archived')
  expect(db.calls[0]?.sql).toMatch(/archived_at IS NOT NULL/i)
})

test('lists a contact notes scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', body: 'Pinned note', pinned: true }])
  const res = await harness(db).request('/c1/notes')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ notes: [{ id: 'n1', body: 'Pinned note', pinned: true }] })
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('creates a note on a contact and returns 201', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', contact_id: 'c1', body: 'Called back', author: 'AL' }])
  const res = await harness(db).request('/c1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Called back', author: 'AL' }),
  })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({
    ok: true,
    note: { id: 'n1', contact_id: 'c1', body: 'Called back', author: 'AL' },
  })
  expect(db.calls[0]?.params[0]).toBe('locA') // location scoped
  expect(db.calls[0]?.params[2]).toBe('c1') // contact from the path
})

test('rejects a note with an empty body', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/c1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: '' }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('updates a note (pin toggle) and returns it', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1', pinned: true }])
  const res = await harness(db).request('/c1/notes/n1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pinned: true }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, note: { id: 'n1', pinned: true } })
})

test('patch with no fields is rejected before touching the db', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/c1/notes/n1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('patch returns 404 when the note is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update -> no row
  const res = await harness(db).request('/c1/notes/missing', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'edit' }),
  })
  expect(res.status).toBe(404)
})

test('deletes a note and returns ok', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'n1' }]) // remove -> one row
  const res = await harness(db).request('/c1/notes/n1', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  // The note is deleted through the contact it belongs to: location, contact, then note id.
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 'n1'])
})

test('delete returns 404 when the note is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // remove -> no row
  const res = await harness(db).request('/c1/notes/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})

test('lists a contact tasks scoped to the location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', title: 'Call back', completed_at: null }])
  const res = await harness(db).request('/c1/tasks')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ tasks: [{ id: 't1', title: 'Call back', completed_at: null }] })
  expect(db.calls[0]?.params).toEqual(['locA', 'c1'])
})

test('creates a task on a contact and returns 201', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', contact_id: 'c1', title: 'Send the revised quote' }])
  const res = await harness(db).request('/c1/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Send the revised quote', dueAt: '2026-06-05T17:00:00Z' }),
  })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({
    ok: true,
    task: { id: 't1', contact_id: 'c1', title: 'Send the revised quote' },
  })
  expect(db.calls[0]?.params[0]).toBe('locA') // location scoped
  expect(db.calls[0]?.params[2]).toBe('c1') // contact from the path
  expect(db.calls[0]?.params[3]).toBe('Send the revised quote') // title
  expect(db.calls[0]?.params[5]).toBe('2026-06-05T17:00:00Z') // due_at
})

test('rejects a task with an empty title', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/c1/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('completes a task (toggle) and returns it', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1', completed_at: '2026-06-03T18:00:00Z' }])
  const res = await harness(db).request('/c1/tasks/t1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completed: true }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, task: { id: 't1', completed_at: '2026-06-03T18:00:00Z' } })
  expect(db.calls[0]?.sql).toMatch(/completed_at=now\(\)/i)
})

test('task patch with no fields is rejected before touching the db', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/c1/tasks/t1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('task patch returns 404 when the task is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // update -> no row
  const res = await harness(db).request('/c1/tasks/missing', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'edit' }),
  })
  expect(res.status).toBe(404)
})

test('deletes a task and returns ok', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 't1' }]) // remove -> one row
  const res = await harness(db).request('/c1/tasks/t1', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  // The task is deleted through the contact it belongs to: location, contact, then task id.
  expect(db.calls[0]?.params).toEqual(['locA', 'c1', 't1'])
})

test('task delete returns 404 when the task is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // remove -> no row
  const res = await harness(db).request('/c1/tasks/missing', { method: 'DELETE' })
  expect(res.status).toBe(404)
})

test('adds a tag to a contact and returns the updated contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', tags: ['vip'] }]) // addTag RETURNING *
  const res = await harness(db).request('/c1/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: 'vip' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, contact: { id: 'c1', tags: ['vip'] } })
  expect(db.calls[0]?.params).toEqual(['locA', 'vip', 'c1']) // location, tag, contact id
})

test('trims a tag before adding (matches the automation runner)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', tags: ['vip'] }])
  await harness(db).request('/c1/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: '  vip  ' }),
  })
  expect(db.calls[0]?.params[1]).toBe('vip') // trimmed, not '  vip  '
})

test('rejects an empty tag before touching the db', async () => {
  const db = new FakeDatabase()
  const res = await harness(db).request('/c1/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: '   ' }),
  })
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

test('add tag returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // addTag -> no row
  const res = await harness(db).request('/missing/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: 'vip' }),
  })
  expect(res.status).toBe(404)
})

test('removes a tag from a contact and returns the updated contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', tags: [] }]) // removeTag RETURNING *
  const res = await harness(db).request('/c1/tags/vip', { method: 'DELETE' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, contact: { id: 'c1', tags: [] } })
  expect(db.calls[0]?.params).toEqual(['locA', 'vip', 'c1'])
})

test('remove tag returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // removeTag -> no row
  const res = await harness(db).request('/missing/tags/vip', { method: 'DELETE' })
  expect(res.status).toBe(404)
})

test('sets a custom-field value on a contact, coerced by the field type', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', key: 'roof_age', type: 'number' }]) // getByKey
  db.enqueue([{ id: 'c1', custom_fields: { roof_age: 12 } }]) // setCustomField RETURNING *
  const res = await harness(db).request('/c1/custom-fields/roof_age', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: '12' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    contact: { id: 'c1', custom_fields: { roof_age: 12 } },
  })
  // '12' coerced to number 12 then JSON-encoded for the jsonb merge
  expect(db.calls[1]?.params).toEqual(['locA', 'roof_age', '12', 'c1'])
})

test('clearing a custom field (null) removes the key', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', key: 'roof_age', type: 'number' }]) // getByKey
  db.enqueue([{ id: 'c1', custom_fields: {} }]) // setCustomField RETURNING *
  const res = await harness(db).request('/c1/custom-fields/roof_age', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: null }),
  })
  expect(res.status).toBe(200)
  expect(db.calls[1]?.sql).toMatch(/custom_fields - \$2/i)
  expect(db.calls[1]?.params).toEqual(['locA', 'roof_age', 'c1']) // no value param on clear
})

test('setting a value for an unknown field key is 404 (no write)', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // getByKey -> none
  const res = await harness(db).request('/c1/custom-fields/ghost', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x' }),
  })
  expect(res.status).toBe(404)
  expect(db.calls).toHaveLength(1) // only the getByKey lookup
})

test('set custom field returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'f1', key: 'roof_age', type: 'text' }]) // getByKey hits
  db.enqueue([]) // setCustomField -> no row
  const res = await harness(db).request('/missing/custom-fields/roof_age', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x' }),
  })
  expect(res.status).toBe(404)
})

// --- contact state (per-state legal texting hours) ------------------------
// The State control on the contact record pins which legal texting window the
// gateway enforces (8am-9pm in THAT state's own timezone). Operator-only
// (behind operatorAuth); free text at the route because the gateway is the
// single legal authority — the dropdown constrains input to AZ/NC/not-set in
// practice. Empty clears it back to "not set", which the gateway then refuses
// as unknown_state rather than guessing a timezone.

test('PUT /:id/state sets the state and returns the updated contact', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', state: 'AZ' }]) // setState RETURNING *
  const res = await harness(db).request('/c1/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'AZ' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, contact: { id: 'c1', name: 'Admin', state: 'AZ' } })
  expect(db.calls[0]?.params).toEqual(['locA', 'AZ', 'c1']) // location, state, contact id
})

test('PUT /:id/state with null clears the state', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', state: null }])
  const res = await harness(db).request('/c1/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: null }),
  })
  expect(res.status).toBe(200)
  expect(db.calls[0]?.params).toEqual(['locA', null, 'c1'])
})

test('PUT /:id/state treats a whitespace-only string as clearing (null)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'c1', name: 'Admin', state: null }])
  const res = await harness(db).request('/c1/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: '   ' }), // trims to empty -> null, never stored as ''
  })
  expect(res.status).toBe(200)
  expect(db.calls[0]?.params).toEqual(['locA', null, 'c1'])
})

test('PUT /:id/state returns 404 when the contact is not in this location', async () => {
  const db = new FakeDatabase()
  db.enqueue([]) // setState matched no row
  const res = await harness(db).request('/missing/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'AZ' }),
  })
  expect(res.status).toBe(404)
})


