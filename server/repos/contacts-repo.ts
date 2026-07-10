import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'
import { matchKey, normalizePhone, normalizeEmail } from '../lib/contact-match'

export interface Contact {
  id: string
  location_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  phones: string[]
  emails: string[]
  tags: string[]
  custom_fields: Record<string, unknown>
  source: string | null
  external_ids: Record<string, unknown>
  match_key: string | null
  created_at: string
  updated_at: string
  /** Soft-delete stamp: null = live (in the book); a timestamp = archived
   *  (hidden, restorable). Set by archive(), cleared by restore(). */
  archived_at: string | null
  /** US state (2-letter code) the contact is in. Pins which legal texting
   *  window the gateway enforces (8am-9pm in THAT state's timezone). null =
   *  not set, which the gateway blocks as unknown_state. Set by setState(). */
  state: string | null
}

export interface ContactInput {
  name?: string
  phone?: string
  email?: string
  externalIds?: Record<string, unknown>
}

export class ContactsRepo extends LocationScopedRepo {
  /**
   * Find a contact by its location-scoped match key, or insert a new one, in one
   * atomic statement. SELECT-then-INSERT races: two inbound webhooks for the same
   * phone both miss the lookup and both insert, and the contacts_match_key unique
   * index then turns the loser into a 500. The ON CONFLICT collapses that to one
   * row - the no-op DO UPDATE makes the existing row eligible for RETURNING, so the
   * loser gets it back. The conflict arbiter is the partial index (match_key IS NOT
   * NULL), so a keyless anonymous contact (no phone/email) never conflicts and
   * always inserts fresh. The existing contact's name/phones/emails are preserved -
   * a sparser later webhook never clobbers richer earlier data.
   */
  async upsertByMatch(input: ContactInput, source: string): Promise<Contact> {
    const key = matchKey(this.locationId, input)
    const id = nanoid()
    const phones = input.phone ? [normalizePhone(input.phone)] : []
    const emails = input.email ? [normalizeEmail(input.email)] : []
    const rows = await this.db.query<Contact>(
      `INSERT INTO contacts (id, location_id, name, phones, emails, match_key, source, external_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (location_id, match_key) WHERE match_key IS NOT NULL
       DO UPDATE SET match_key = EXCLUDED.match_key
       RETURNING *`,
      [id, this.locationId, input.name ?? null, phones, emails, key, source, input.externalIds ?? {}],
    )
    return rows[0]!
  }

  list(limit = 50): Promise<Contact[]> {
    return this.scopedSelect<Contact>(
      'SELECT * FROM contacts WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT $2',
      [limit],
    )
  }

  /**
   * Total contacts in this location. Backs the operator assistant's list_contacts
   * tool — the headline answer to "how many leads/contacts do I have?", which the
   * search-only surface could not give. COUNT(*) returns a bigint that node-pg
   * hands back as a string, so the ::int cast keeps it a real number here and in
   * the FakeDatabase tests alike.
   */
  async count(): Promise<number> {
    const rows = await this.scopedSelect<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM contacts WHERE archived_at IS NULL',
      [],
    )
    return Number(rows[0]?.n ?? 0)
  }

  /**
   * Free-text lookup over name / phone / email, location-scoped, newest first.
   * Backs the operator assistant's search_contacts tool — it lets the agent turn
   * "book Altstatt" into a real contact id rather than guessing one. The arrays are
   * flattened to text so a single ILIKE pattern can match across all numbers/emails.
   */
  search(query: string, limit = 20): Promise<Contact[]> {
    const like = `%${query}%`
    return this.scopedSelect<Contact>(
      `SELECT * FROM contacts
         WHERE (name ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2
                OR array_to_string(phones, ' ') ILIKE $2
                OR array_to_string(emails, ' ') ILIKE $2)
           AND archived_at IS NULL
         ORDER BY updated_at DESC LIMIT $3`,
      [like, limit],
    )
  }

  /** Contacts carrying a given tag (pg text[] membership). Used for campaign
   *  audience segments. */
  listByTag(tag: string): Promise<Contact[]> {
    return this.scopedSelect<Contact>(
      'SELECT * FROM contacts WHERE $2 = ANY(tags) AND archived_at IS NULL ORDER BY updated_at DESC',
      [tag],
    )
  }

  async get(id: string): Promise<Contact | undefined> {
    // No archived_at filter on purpose: the detail page and the restore flow
    // must still be able to read an archived contact by id.
    const rows = await this.scopedSelect<Contact>('SELECT * FROM contacts WHERE id=$2', [id])
    return rows[0]
  }

  /**
   * Soft-delete a contact (the operator's "Delete" control). Stamps archived_at
   * so the row drops out of list/count/search/segments but is kept intact and
   * restorable — a hard delete would cascade away its notes/tasks/timeline and
   * null out its conversations/opportunities. Operator-only; the AI assistant
   * has no delete tool. Returns undefined if the id is not in this location.
   */
  async archive(id: string): Promise<Contact | undefined> {
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts SET archived_at = now(), updated_at = now()
        WHERE location_id = $1 AND id = $2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  /** Undo an archive — bring the contact back into the book. Mirror of archive;
   *  backs the Archived view's "Restore" control. Undefined if not in location. */
  async restore(id: string): Promise<Contact | undefined> {
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts SET archived_at = NULL, updated_at = now()
        WHERE location_id = $1 AND id = $2 RETURNING *`,
      [id],
    )
    return rows[0]
  }

  /** The archived contacts, newest-archived first — backs the Archived view so
   *  the operator can find and restore something they removed. */
  listArchived(limit = 200): Promise<Contact[]> {
    return this.scopedSelect<Contact>(
      'SELECT * FROM contacts WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT $2',
      [limit],
    )
  }

  /** Append a tag, idempotently — a repeat tag is a no-op (no duplicate). Used by
   *  the automation runner's add_tag action. */
  async addTag(contactId: string, tag: string): Promise<Contact | undefined> {
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts
          SET tags = CASE WHEN $2 = ANY(tags) THEN tags ELSE array_append(tags, $2) END,
              updated_at = now()
        WHERE location_id = $1 AND id = $3 RETURNING *`,
      [tag, contactId],
    )
    return rows[0]
  }

  /**
   * Set (or clear) the contact's US state — the per-state legal texting-hours
   * setting. Stores the 2-letter code; passing null clears it back to "not
   * set", which the gateway then refuses as unknown_state rather than guessing
   * a timezone. One statement for both (a plain column null is just state =
   * $2), mirroring archive/restore. Location-scoped; undefined if not in
   * location. The gateway is the legal authority, so this is a plain store —
   * no normalization here; legalTextWindow() normalizes on read.
   */
  async setState(id: string, state: string | null): Promise<Contact | undefined> {
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts SET state = $2, updated_at = now()
        WHERE location_id = $1 AND id = $3 RETURNING *`,
      [state, id],
    )
    return rows[0]
  }

  /** Strip a tag from one contact, idempotently — removing an absent tag is a
   *  no-op. Mirror of addTag; backs the contact tag editor. */
  async removeTag(contactId: string, tag: string): Promise<Contact | undefined> {
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts
          SET tags = array_remove(tags, $2),
              updated_at = now()
        WHERE location_id = $1 AND id = $3 RETURNING *`,
      [tag, contactId],
    )
    return rows[0]
  }

  /**
   * Set (or clear) one custom-field value on a contact, keyed by the field's
   * stable slug. A null value removes the key from the jsonb bag entirely (no
   * empty ghost values); any other value is merged under that key. Mirrors
   * addTag/removeTag — one value at a time, location-scoped.
   */
  async setCustomField(
    contactId: string,
    key: string,
    value: unknown,
  ): Promise<Contact | undefined> {
    if (value === null) {
      const rows = await this.scopedWrite<Contact>(
        `UPDATE contacts
            SET custom_fields = custom_fields - $2,
                updated_at = now()
          WHERE location_id = $1 AND id = $3 RETURNING *`,
        [key, contactId],
      )
      return rows[0]
    }
    const rows = await this.scopedWrite<Contact>(
      `UPDATE contacts
          SET custom_fields = custom_fields || jsonb_build_object($2::text, $3::jsonb),
              updated_at = now()
        WHERE location_id = $1 AND id = $4 RETURNING *`,
      [key, JSON.stringify(value), contactId],
    )
    return rows[0]
  }
}
