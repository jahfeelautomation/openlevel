import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { Database } from '../db/database'
import { coerceCustomFieldValue } from '../lib/custom-field-key'
import { ContactNotesRepo } from '../repos/contact-notes-repo'
import { ContactTasksRepo } from '../repos/contact-tasks-repo'
import { ContactsRepo } from '../repos/contacts-repo'
import { CustomFieldsRepo } from '../repos/custom-fields-repo'
import { TimelineRepo } from '../repos/timeline-repo'

// Operator-typed new contact. All three fields are optional and trimmed; the
// refine requires at least one non-empty value so a blank form is a 400 at
// validation (db untouched) rather than inserting an anonymous ghost. A
// whitespace-only name collapses to '' here, so it does NOT count as present.
const createContactSchema = z
  .object({
    name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().optional(),
  })
  .refine((v) => Boolean(v.name || v.phone || v.email), {
    message: 'provide a name, phone, or email',
  })

const createNoteSchema = z.object({
  body: z.string().min(1),
  author: z.string().min(1).nullish(),
})

// At least one editable field must be present, so an empty patch is a 400 at
// validation rather than a misleading 404 from the repo's no-op guard.
const patchNoteSchema = z
  .object({
    body: z.string().min(1).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.pinned !== undefined, {
    message: 'provide body or pinned',
  })

const createTaskSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1).nullish(),
  // A due date is optional; a non-empty string (date or datetime). Omitted/cleared
  // tasks simply have no due status in the worklist math.
  dueAt: z.string().min(1).nullish(),
})

// Any one editable field is enough. `completed` is a toggle: true marks done,
// false re-opens. body/dueAt accept null so the operator can clear them.
const patchTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().nullish(),
    dueAt: z.string().min(1).nullish(),
    completed: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.body !== undefined ||
      v.dueAt !== undefined ||
      v.completed !== undefined,
    { message: 'provide at least one field' },
  )

// A tag is free text; trim it and require something left (matches the automation
// runner's add_tag, which also trims, so manual and automated tags stay aligned).
const contactTagSchema = z.object({ tag: z.string().trim().min(1) })

// A custom-field value as the operator typed it; coerced server-side by the
// field's declared type. null clears the value (removes the key).
const customFieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

// The contact's US state for legal texting hours. Free text (trimmed) or null —
// NOT an enum here on purpose: the gateway is the single legal authority for
// which states are valid (it blocks anything it can't pin), and the UI dropdown
// constrains input to AZ/NC/not-set in practice. The key must be present; a
// blank/whitespace value is normalized to null (cleared) in the handler.
const contactStateSchema = z.object({ state: z.string().trim().nullable() })

/**
 * Contacts for the current location. Mounted behind operatorAuth +
 * locationAccess, so `locationId` is set and verified. GET /:id returns the
 * unified contact record plus its timeline (newest first).
 *
 * Each contact also carries free-text notes (the GHL "Notes" panel), nested at
 * /:id/notes, and operator to-dos (the "Tasks" panel), nested at /:id/tasks.
 * Both are operator-only and never move money or send anything.
 */
export function contactsRoute(deps: { db: Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const loc = c.get('locationId')
    // ContactsPage filters this list CLIENT-SIDE (search box runs over the array
    // it's given), so the whole book must come down in one fetch — anything past
    // the cap is invisible AND unsearchable in the UI. 1000 covers a full
    // personal book (largest live location is 135) with wide headroom while
    // keeping the payload small. Revisit with real pagination if a location ever
    // approaches this.
    const contacts = await new ContactsRepo(deps.db, loc).list(1000)
    return c.json({ contacts })
  })

  // Operator adds a contact by hand (the "Add contact" button). upsertByMatch is
  // the create path: a matching phone/email resolves to the existing row instead
  // of a duplicate, and a keyless contact inserts fresh. Source 'manual' marks it
  // operator-entered (vs. a Beeper/Chatwoot inbound). Never sends or charges.
  app.post('/', zValidator('json', createContactSchema), async (c) => {
    const loc = c.get('locationId')
    const { name, phone, email } = c.req.valid('json')
    const contact = await new ContactsRepo(deps.db, loc).upsertByMatch(
      { name: name || undefined, phone: phone || undefined, email: email || undefined },
      'manual',
    )
    return c.json({ ok: true, contact }, 201)
  })

  // Archived (soft-deleted) contacts — the "Archived" view, newest-archived
  // first. Registered BEFORE GET /:id so the literal /archived path is not
  // swallowed as a contact id. Read-only.
  app.get('/archived', async (c) => {
    const loc = c.get('locationId')
    const contacts = await new ContactsRepo(deps.db, loc).listArchived()
    return c.json({ contacts })
  })

  app.get('/:id', async (c) => {
    const loc = c.get('locationId')
    const id = c.req.param('id')
    const contact = await new ContactsRepo(deps.db, loc).get(id)
    if (!contact) return c.json({ error: 'not found' }, 404)
    const timeline = await new TimelineRepo(deps.db, loc).listByContact(id)
    return c.json({ contact, timeline })
  })

  // Operator "Delete" — a SOFT delete (archive). The contact drops out of the
  // book but is kept intact and restorable; a hard delete would cascade away
  // its notes/tasks/timeline. This route is behind operatorAuth and is NOT an
  // AI tool — only the operator's own click reaches it. 404 if not in location.
  app.delete('/:id', async (c) => {
    const loc = c.get('locationId')
    const contact = await new ContactsRepo(deps.db, loc).archive(c.req.param('id'))
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  // Restore an archived contact back into the book (the Archived view's
  // "Restore" control). 404 if the contact is not in this location.
  app.post('/:id/restore', async (c) => {
    const loc = c.get('locationId')
    const contact = await new ContactsRepo(deps.db, loc).restore(c.req.param('id'))
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  // Set (or clear) the contact's US state — the per-state legal texting-hours
  // setting that the assistant's send path passes to the gateway. A
  // blank/whitespace value clears it back to "not set", which the gateway then
  // refuses as unknown_state (it never guesses a timezone). Operator-only; NOT
  // an AI tool. 404 if the contact is not in this location.
  app.put('/:id/state', zValidator('json', contactStateSchema), async (c) => {
    const loc = c.get('locationId')
    const raw = c.req.valid('json').state
    const state = raw ? raw : null // '' (trimmed) or null both clear
    const contact = await new ContactsRepo(deps.db, loc).setState(c.req.param('id'), state)
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  app.get('/:id/notes', async (c) => {
    const loc = c.get('locationId')
    const notes = await new ContactNotesRepo(deps.db, loc).listByContact(c.req.param('id'))
    return c.json({ notes })
  })

  app.post('/:id/notes', zValidator('json', createNoteSchema), async (c) => {
    const loc = c.get('locationId')
    const { body, author } = c.req.valid('json')
    const note = await new ContactNotesRepo(deps.db, loc).create({
      contactId: c.req.param('id'),
      body,
      author: author ?? null,
    })
    return c.json({ ok: true, note }, 201)
  })

  app.patch('/:id/notes/:noteId', zValidator('json', patchNoteSchema), async (c) => {
    const loc = c.get('locationId')
    const note = await new ContactNotesRepo(deps.db, loc).update(
      c.req.param('id'),
      c.req.param('noteId'),
      c.req.valid('json'),
    )
    if (!note) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, note })
  })

  app.delete('/:id/notes/:noteId', async (c) => {
    const loc = c.get('locationId')
    const ok = await new ContactNotesRepo(deps.db, loc).remove(
      c.req.param('id'),
      c.req.param('noteId'),
    )
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/:id/tasks', async (c) => {
    const loc = c.get('locationId')
    const tasks = await new ContactTasksRepo(deps.db, loc).listByContact(c.req.param('id'))
    return c.json({ tasks })
  })

  app.post('/:id/tasks', zValidator('json', createTaskSchema), async (c) => {
    const loc = c.get('locationId')
    const { title, body, dueAt } = c.req.valid('json')
    const task = await new ContactTasksRepo(deps.db, loc).create({
      contactId: c.req.param('id'),
      title,
      body: body ?? null,
      dueAt: dueAt ?? null,
    })
    return c.json({ ok: true, task }, 201)
  })

  app.patch('/:id/tasks/:taskId', zValidator('json', patchTaskSchema), async (c) => {
    const loc = c.get('locationId')
    const task = await new ContactTasksRepo(deps.db, loc).update(
      c.req.param('id'),
      c.req.param('taskId'),
      c.req.valid('json'),
    )
    if (!task) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, task })
  })

  app.delete('/:id/tasks/:taskId', async (c) => {
    const loc = c.get('locationId')
    const ok = await new ContactTasksRepo(deps.db, loc).remove(
      c.req.param('id'),
      c.req.param('taskId'),
    )
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  // Tag the contact (the "Add tag" control on the record). Idempotent: re-adding
  // a present tag is a no-op. Returns the updated contact so the UI re-renders
  // its chips. 404 if the contact is not in this location.
  app.post('/:id/tags', zValidator('json', contactTagSchema), async (c) => {
    const loc = c.get('locationId')
    const contact = await new ContactsRepo(deps.db, loc).addTag(
      c.req.param('id'),
      c.req.valid('json').tag,
    )
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  // Untag the contact (the chip's remove control). The tag travels URL-encoded in
  // the path; idempotent — removing an absent tag still returns the contact.
  app.delete('/:id/tags/:tag', async (c) => {
    const loc = c.get('locationId')
    const contact = await new ContactsRepo(deps.db, loc).removeTag(
      c.req.param('id'),
      c.req.param('tag'),
    )
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  // Set one custom-field value on the contact (the contact record's "Custom
  // Fields" editor). The field key travels URL-encoded in the path; the value is
  // coerced by the field's declared type, and a null value clears it. 404 if the
  // key has no definition in this location, or the contact is not in it.
  app.put('/:id/custom-fields/:key', zValidator('json', customFieldValueSchema), async (c) => {
    const loc = c.get('locationId')
    const key = c.req.param('key')
    const field = await new CustomFieldsRepo(deps.db, loc).getByKey(key)
    if (!field) return c.json({ error: 'unknown field' }, 404)
    const coerced = coerceCustomFieldValue(field.type, c.req.valid('json').value)
    const contact = await new ContactsRepo(deps.db, loc).setCustomField(
      c.req.param('id'),
      key,
      coerced,
    )
    if (!contact) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, contact })
  })

  return app
}
