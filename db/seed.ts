import { pathToFileURL } from 'node:url'
import { nanoid } from 'nanoid'
import type { Database } from '../server/db/database'
import { commissionCents } from '../server/lib/affiliate-math'
import { invoiceTotalCents } from '../server/lib/invoice-math'
import { hashPassword } from '../server/lib/password'
import { proposalTotalCents, readLineItems } from '../server/lib/proposal-math'
import { AffiliateProgramsRepo } from '../server/repos/affiliate-programs-repo'
import { AffiliatesRepo } from '../server/repos/affiliates-repo'
import { AppointmentsRepo } from '../server/repos/appointments-repo'
import { CalendarsRepo } from '../server/repos/calendars-repo'
import { BlogPostsRepo } from '../server/repos/blog-posts-repo'
import { CampaignRecipientsRepo } from '../server/repos/campaign-recipients-repo'
import { CampaignsRepo } from '../server/repos/campaigns-repo'
import { CommunitiesRepo } from '../server/repos/communities-repo'
import { CommunityChannelsRepo } from '../server/repos/community-channels-repo'
import { CommunityCommentsRepo } from '../server/repos/community-comments-repo'
import { CommunityMembersRepo } from '../server/repos/community-members-repo'
import { CommunityPostLikesRepo } from '../server/repos/community-post-likes-repo'
import { CommunityPostsRepo } from '../server/repos/community-posts-repo'
import { ContactNotesRepo } from '../server/repos/contact-notes-repo'
import { ContactTasksRepo } from '../server/repos/contact-tasks-repo'
import { ContactsRepo } from '../server/repos/contacts-repo'
import { ConversationsRepo } from '../server/repos/conversations-repo'
import { CouponsRepo } from '../server/repos/coupons-repo'
import { CoursesRepo } from '../server/repos/courses-repo'
import { CustomFieldsRepo } from '../server/repos/custom-fields-repo'
import { CustomValuesRepo } from '../server/repos/custom-values-repo'
import { EnrollmentsRepo } from '../server/repos/enrollments-repo'
import { FormSubmissionsRepo } from '../server/repos/form-submissions-repo'
import { FormsRepo } from '../server/repos/forms-repo'
import { FunnelStepsRepo } from '../server/repos/funnel-steps-repo'
import { FunnelsRepo } from '../server/repos/funnels-repo'
import { InvoicesRepo } from '../server/repos/invoices-repo'
import { LessonCompletionsRepo } from '../server/repos/lesson-completions-repo'
import { LessonsRepo } from '../server/repos/lessons-repo'
import { MessagesRepo } from '../server/repos/messages-repo'
import { OpportunitiesRepo } from '../server/repos/opportunities-repo'
import { ProductsRepo } from '../server/repos/products-repo'
import { ProposalsRepo } from '../server/repos/proposals-repo'
import { ReviewRequestsRepo } from '../server/repos/review-requests-repo'
import { ReviewsRepo } from '../server/repos/reviews-repo'
import { SocialAccountsRepo } from '../server/repos/social-accounts-repo'
import { SocialPostsRepo } from '../server/repos/social-posts-repo'
import { SubscriptionsRepo } from '../server/repos/subscriptions-repo'
import { SurveySubmissionsRepo } from '../server/repos/survey-submissions-repo'
import { SurveysRepo } from '../server/repos/surveys-repo'
import { TemplatesRepo } from '../server/repos/templates-repo'
import { TimelineRepo } from '../server/repos/timeline-repo'
import { type TriggerLink, TriggerLinksRepo } from '../server/repos/trigger-links-repo'
import { WorkflowActionsRepo } from '../server/repos/workflow-actions-repo'
import { WorkflowsRepo } from '../server/repos/workflows-repo'

/**
 * Seed one demo tenant so the app has something to show: location "Alex"
 * (a cash-offer real-estate operation), operator AL with access to it, a
 * Chatwoot channel link, and a few contacts/conversations/messages/timeline
 * events. Idempotent: a no-op if any location already exists, so it is safe to
 * call on every dev boot.
 *
 * Login: admin@acmecorp.com / openlevel
 */
export async function seedDatabase(db: Database): Promise<void> {
  const existing = await db.query('SELECT id FROM locations LIMIT 1')
  if (existing.length > 0) return

  const locId = 'loc_alex'
  const opId = 'op_AL'

  await db.query(
    `INSERT INTO locations (id, name, slug, client_slug, branding, settings)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      locId,
      'Alex — Cash Offers',
      'Alex',
      'Alex',
      JSON.stringify({ color: '#4f46e5' }),
      JSON.stringify({
        // Reply mode stays at the safe default: the agent drafts for a human to
        // approve and every action tool is withheld. The agent block under it is
        // what the AI Agent settings page reads and writes.
        replyMode: 'approve-first',
        agent: {
          enabled: true,
          persona:
            'You are Alex\'s assistant, the friendly first point of contact for homeowners exploring a fast, no-obligation cash offer on their house.',
          instructions:
            'Be warm and concise. Offer to book a free 15-minute consultation when someone is interested. Never quote a specific offer amount — say Alex confirms every offer personally after a quick look at the property.',
          facts: [
            'We buy houses in any condition — no repairs, no cleaning, no showings.',
            'There are no agent fees or closing costs to the seller.',
            'A typical cash close takes 7 to 14 days, and the seller picks the date.',
            'Consultations are free and there is never any obligation to accept an offer.',
          ],
        },
        // Voice provider CHOICE only — the Twilio keys themselves live in the
        // vault (Alex:twilio:*), so the Settings page honestly reads
        // "not connected" until they exist. Numbers are the fictional 555 range.
        voice: {
          provider: 'twilio',
          fromNumber: '+14805550100',
          operatorNumber: '+14805550199',
        },
      }),
    ],
  )

  await db.query(
    `INSERT INTO operators (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)`,
    [opId, 'admin@acmecorp.com', 'AL', 'owner', await hashPassword('openlevel')],
  )
  await db.query(`INSERT INTO operator_locations (operator_id, location_id) VALUES ($1,$2)`, [opId, locId])

  await db.query(
    `INSERT INTO channel_links (id, location_id, provider, inbox_id, config) VALUES ($1,$2,$3,$4,$5)`,
    [
      'cl_Alex_chatwoot',
      locId,
      'chatwoot',
      '1',
      JSON.stringify({
        baseUrl: 'https://chat.acmecorp.com',
        accountId: '1',
        tokenSecretName: 'Alex:chatwoot:api_token',
      }),
    ],
  )

  const contacts = new ContactsRepo(db, locId)
  const conversations = new ConversationsRepo(db, locId)
  const messages = new MessagesRepo(db, locId)
  const timeline = new TimelineRepo(db, locId)
  const contactNotes = new ContactNotesRepo(db, locId)
  const contactTasks = new ContactTasksRepo(db, locId)
  const contactIdByName: Record<string, string> = {}

  // Three contacts, newest activity last so it sorts to the top of the inbox.
  const seedThreads: {
    name: string
    phone: string
    cwConv: string
    inbound: string[]
    outbound?: string
  }[] = [
    {
      name: 'Jordan Doe',
      phone: '+16785550188',
      cwConv: '101',
      inbound: ['Can you call me tomorrow about the duplex?'],
    },
    {
      name: 'Taylor Reed',
      phone: '+14045550173',
      cwConv: '102',
      inbound: ['Is the cash offer still good?'],
      outbound: 'Yes! It is. Sending the paperwork over now — give it a quick look when you can.',
    },
    {
      name: 'Sam Smith',
      phone: '+16785550142',
      cwConv: '103',
      inbound: [
        'Hey, saw your post about selling fast.',
        'What can you offer for 482 Oakland Ave? Roof is newer, needs some paint.',
      ],
    },
  ]

  for (const t of seedThreads) {
    const contact = await contacts.upsertByMatch({ name: t.name, phone: t.phone }, 'seed')
    contactIdByName[t.name] = contact.id
    const conversation = await conversations.upsertByExternal({
      provider: 'chatwoot',
      externalId: t.cwConv,
      contactId: contact.id,
      channel: 'chatwoot',
    })

    let mid = 1
    for (const body of t.inbound) {
      const msg = await messages.insertInbound({
        conversationId: conversation.id,
        contactId: contact.id,
        channel: 'chatwoot',
        provider: 'chatwoot',
        externalId: `${t.cwConv}-in-${mid++}`,
        body,
      })
      await timeline.add({
        contactId: contact.id,
        type: 'message',
        refTable: 'messages',
        refId: msg?.id,
        payload: { direction: 'inbound', body, channel: 'chatwoot' },
      })
    }

    if (t.outbound) {
      const msg = await messages.insertOutbound({
        conversationId: conversation.id,
        contactId: contact.id,
        channel: 'chatwoot',
        provider: 'chatwoot',
        externalId: `${t.cwConv}-out-1`,
        body: t.outbound,
        authorType: 'operator',
        authorId: opId,
        status: 'sent',
      })
      await timeline.add({
        contactId: contact.id,
        type: 'message',
        refTable: 'messages',
        refId: msg.id,
        payload: { direction: 'outbound', body: t.outbound, channel: 'chatwoot' },
      })
    }

    await conversations.touch(conversation.id)
  }

  // Notes on a contact record (the GHL "Notes" panel). The pinned one floats to
  // the top; the rest sort newest-first. Inserted oldest-first so the timestamps
  // order the way the UI renders them.
  const marcusId = contactIdByName['Sam Smith']
  if (marcusId) {
    await contactNotes.create({
      contactId: marcusId,
      body: 'Found us through the Facebook post about selling fast. Owns 482 Oakland Ave.',
      author: 'AL',
    })
    await contactNotes.create({
      contactId: marcusId,
      body: 'Roof was replaced two years ago. Interior needs paint and new carpet in two bedrooms.',
      author: 'AL',
    })
    const pinned = await contactNotes.create({
      contactId: marcusId,
      body: 'Prefers a text over a call — works second shift, so reach out before 2pm.',
      author: 'AL',
    })
    await contactNotes.update(marcusId, pinned.id, { pinned: true })
  }

  // Tasks across a few contacts (the GHL "Tasks" panel + global worklist). Due
  // dates are anchored to today (UTC) at seed time so the demo always shows a
  // believable overdue / due-today / upcoming spread whenever it is seeded. One
  // task is already completed. These are internal operator to-dos only — they
  // never send a message or move money.
  const startOfTodayUtc = (() => {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  })()
  const dueAt = (offsetDays: number, hourUtc: number) =>
    new Date(startOfTodayUtc + offsetDays * 86_400_000 + hourUtc * 3_600_000).toISOString()

  const derekId = contactIdByName['Jordan Doe']
  const tanyaId = contactIdByName['Taylor Reed']
  if (marcusId && derekId && tanyaId) {
    await contactTasks.create({
      contactId: marcusId,
      title: 'Send the revised cash offer for 482 Oakland Ave',
      body: 'Bumped the number after the roof note. Text it, do not call before 2pm.',
      dueAt: dueAt(-1, 15), // overdue, yesterday
    })
    await contactTasks.create({
      contactId: derekId,
      title: 'Call back about the duplex',
      dueAt: dueAt(-2, 17), // overdue, two days ago
    })
    await contactTasks.create({
      contactId: tanyaId,
      title: 'Email the signed paperwork link',
      dueAt: dueAt(0, 16), // due today
    })
    await contactTasks.create({
      contactId: marcusId,
      title: 'Schedule the property walkthrough',
      dueAt: dueAt(2, 14), // upcoming
    })
    await contactTasks.create({
      contactId: derekId,
      title: 'Follow up on financing options', // no due date -> upcoming bucket
    })
    const closed = await contactTasks.create({
      contactId: tanyaId,
      title: 'Confirm closing date with the title company',
      dueAt: dueAt(-3, 12),
    })
    await contactTasks.update(tanyaId, closed.id, { completed: true })
  }

  // A default sales pipeline + stages so the Opportunities board has columns,
  // and a few demo deals tied to the seed contacts spread across the stages.
  const pipelineId = 'pl_cash_offer'
  await db.query(`INSERT INTO pipelines (id, location_id, name, position) VALUES ($1,$2,$3,$4)`, [
    pipelineId,
    locId,
    'Cash Offer Pipeline',
    0,
  ])

  const stages = [
    { id: 'st_new', name: 'New Lead' },
    { id: 'st_contacted', name: 'Contacted' },
    { id: 'st_offer', name: 'Offer Made' },
    { id: 'st_contract', name: 'Under Contract' },
    { id: 'st_won', name: 'Closed Won' },
  ]
  for (const [i, s] of stages.entries()) {
    await db.query(
      `INSERT INTO pipeline_stages (id, location_id, pipeline_id, name, position) VALUES ($1,$2,$3,$4,$5)`,
      [s.id, locId, pipelineId, s.name, i],
    )
  }

  const opportunities = new OpportunitiesRepo(db, locId)
  const seedOpps: {
    name: string
    contact: string | null
    stageId: string
    valueCents: number
    status: string
  }[] = [
    { name: '482 Oakland Ave', contact: 'Sam Smith', stageId: 'st_new', valueCents: 185_000_00, status: 'open' },
    { name: 'Duplex on 5th', contact: 'Jordan Doe', stageId: 'st_contacted', valueCents: 240_000_00, status: 'open' },
    { name: 'Tanya — single family', contact: 'Taylor Reed', stageId: 'st_offer', valueCents: 162_000_00, status: 'open' },
    { name: 'Maple St rental', contact: null, stageId: 'st_contract', valueCents: 119_500_00, status: 'open' },
    // One closed-won deal so the final stage and the "Won value" KPI aren't empty.
    { name: 'Cedar Ct — closed', contact: 'Jordan Doe', stageId: 'st_won', valueCents: 142_000_00, status: 'won' },
  ]
  for (const o of seedOpps) {
    const opp = await opportunities.create({
      pipelineId,
      stageId: o.stageId,
      name: o.name,
      contactId: o.contact ? (contactIdByName[o.contact] ?? null) : null,
      valueCents: o.valueCents,
      source: 'seed',
    })
    if (o.status !== 'open') await opportunities.setStatus(opp.id, o.status)
  }

  // A second, deal-free pipeline so the Settings -> Pipelines manager shows more
  // than one. It also lets the operator exercise rename/reorder/delete on a
  // pipeline that no opportunities are holding open (the Cash Offer one above is
  // guarded against deletion precisely because it still has deals).
  const sellerPipelineId = 'pl_seller_financing'
  await db.query(`INSERT INTO pipelines (id, location_id, name, position) VALUES ($1,$2,$3,$4)`, [
    sellerPipelineId,
    locId,
    'Seller Financing',
    1,
  ])
  const sellerStages = [
    { id: 'sf_inquiry', name: 'Inquiry' },
    { id: 'sf_terms', name: 'Terms Sent' },
    { id: 'sf_signed', name: 'Agreement Signed' },
  ]
  for (const [i, s] of sellerStages.entries()) {
    await db.query(
      `INSERT INTO pipeline_stages (id, location_id, pipeline_id, name, position) VALUES ($1,$2,$3,$4,$5)`,
      [s.id, locId, sellerPipelineId, s.name, i],
    )
  }

  // Two calendars + a handful of upcoming appointments so the Calendars agenda
  // has something to show. Times are relative to seed time and biased to the
  // future so they fall inside the default now..+30d window.
  const calendars = new CalendarsRepo(db, locId)
  const inspections = await calendars.create({
    name: 'Property Inspections',
    color: 'indigo',
    durationMin: 60,
    position: 0,
  })
  const consults = await calendars.create({
    name: 'Seller Consultations',
    color: 'emerald',
    durationMin: 30,
    position: 1,
  })

  // Turn the consultations calendar into a live public booking page — open
  // weekdays 9–5 Eastern, 2-hour notice, 14-day rolling window — so the hosted
  // "/api/public/booking/<loc>/cash-offer" page has real, clickable openings.
  await calendars.update(consults.id, {
    bookingEnabled: true,
    bookingSlug: 'cash-offer',
    timezone: 'America/New_York',
    slotIntervalMin: 0,
    bufferMin: 0,
    noticeMin: 120,
    rollingDays: 14,
    availability: [
      { weekday: 1, start: '09:00', end: '17:00' },
      { weekday: 2, start: '09:00', end: '17:00' },
      { weekday: 3, start: '09:00', end: '17:00' },
      { weekday: 4, start: '09:00', end: '17:00' },
      { weekday: 5, start: '09:00', end: '17:00' },
    ],
    bookingHeadline: 'Book a cash-offer consultation',
    bookingBlurb: 'Pick a 30-minute slot that works for you and we will call to walk through your offer.',
  })

  const now = new Date()
  const at = (dayOffset: number, hour: number, minute = 0): Date => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d
  }
  const iso = (d: Date) => d.toISOString()
  const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000)

  const appointments = new AppointmentsRepo(db, locId)
  const seedAppts: {
    calendarId: string
    title: string
    start: Date
    durationMin: number
    contact: string | null
    status: string
    locationText?: string
  }[] = [
    {
      calendarId: inspections.id,
      title: 'Inspection — 482 Oakland Ave',
      start: new Date(now.getTime() + 2 * 60 * 60_000), // ~2h from now, today
      durationMin: 60,
      contact: 'Sam Smith',
      status: 'confirmed',
      locationText: '482 Oakland Ave',
    },
    {
      calendarId: consults.id,
      title: 'Cash-offer consultation',
      start: at(1, 10),
      durationMin: 30,
      contact: 'Jordan Doe',
      status: 'scheduled',
    },
    {
      calendarId: inspections.id,
      title: 'Walkthrough — single family',
      start: at(1, 14),
      durationMin: 60,
      contact: 'Taylor Reed',
      status: 'scheduled',
      locationText: 'Tanya — single family',
    },
    {
      calendarId: consults.id,
      title: 'Follow-up call',
      start: at(3, 11),
      durationMin: 30,
      contact: 'Taylor Reed',
      status: 'scheduled',
    },
    {
      calendarId: inspections.id,
      title: 'Inspection — Maple St rental',
      start: at(6, 9),
      durationMin: 60,
      contact: null,
      status: 'scheduled',
      locationText: 'Maple St rental',
    },
  ]
  for (const a of seedAppts) {
    const appt = await appointments.create({
      calendarId: a.calendarId,
      title: a.title,
      startsAt: iso(a.start),
      endsAt: iso(plus(a.start, a.durationMin)),
      contactId: a.contact ? (contactIdByName[a.contact] ?? null) : null,
      locationText: a.locationText ?? null,
    })
    if (a.status !== 'scheduled') await appointments.setStatus(appt.id, a.status)
  }

  // Tag the contacts so the Tags page, segments, and the draft campaign all have
  // real data. Tanya + Marcus keep "seller" (the draft email below targets that
  // segment); the wider spread gives the Tags page a believable distribution — a
  // couple of shared tags and several one-offs.
  const contactTags: Record<string, string[]> = {
    'Jordan Doe': ['lead', 'cash-offer', 'website'],
    'Taylor Reed': ['seller', 'hot-lead', 'cash-offer'],
    'Sam Smith': ['seller', 'investor'],
  }
  for (const [name, tags] of Object.entries(contactTags)) {
    const id = contactIdByName[name]
    if (id) {
      await db.query('UPDATE contacts SET tags = $2 WHERE location_id = $1 AND id = $3', [
        locId,
        tags,
        id,
      ])
    }
  }

  // A few custom-field definitions so the Custom Fields settings page and the
  // contact-record editor open onto real fields, with two contacts already
  // carrying values. Mirrors a real-estate intake: where the lead came from,
  // the property type, their budget, and whether they are pre-approved.
  const customFields = new CustomFieldsRepo(db, locId)
  const cfLeadSource = await customFields.create({
    label: 'Lead Source',
    type: 'dropdown',
    options: ['Website', 'Referral', 'Cold Call', 'Facebook'],
  })
  const cfPropertyType = await customFields.create({
    label: 'Property Type',
    type: 'dropdown',
    options: ['Single Family', 'Multi-Family', 'Condo', 'Land'],
  })
  const cfBudget = await customFields.create({
    label: 'Budget',
    type: 'number',
    placeholder: 'e.g. 350000',
  })
  await customFields.create({ label: 'Pre-Approved', type: 'checkbox' })

  const cfDerek = contactIdByName['Jordan Doe']
  if (cfDerek) {
    await contacts.setCustomField(cfDerek, cfLeadSource.key, 'Website')
    await contacts.setCustomField(cfDerek, cfBudget.key, 325000)
  }
  const cfTanya = contactIdByName['Taylor Reed']
  if (cfTanya) {
    await contacts.setCustomField(cfTanya, cfLeadSource.key, 'Referral')
    await contacts.setCustomField(cfTanya, cfPropertyType.key, 'Single Family')
  }

  // Location-level custom values: business constants that templates and
  // automations splice in as {{custom_values.<key>}} merge tags, so a seeded
  // SMS/email template renders with a real business name and booking link.
  const customValues = new CustomValuesRepo(db, locId)
  await customValues.create({ name: 'Business Name', value: 'Lighthouse Realty' })
  await customValues.create({ name: 'Booking Link', value: 'https://book.lighthouse.example/tour' })
  await customValues.create({ name: 'Support Phone', value: '(415) 555-0142' })

  // Two marketing campaigns so the Marketing module has history: one SMS blast
  // already sent to every contact, and one email still in draft aimed at the
  // "seller" segment.
  const campaigns = new CampaignsRepo(db, locId)
  const recipients = new CampaignRecipientsRepo(db, locId)

  const blast = await campaigns.create({
    name: 'May cash-offer blast',
    channel: 'sms',
    body: 'Hi {{first_name}}, still buying homes for cash this month — reply YES for a no-pressure offer on your place.',
    audienceTag: null,
  })
  const allContactIds = Object.values(contactIdByName)
  await recipients.bulkInsert(blast.id, allContactIds)
  await campaigns.markSent(blast.id, allContactIds.length, allContactIds.length)

  await campaigns.create({
    name: 'Spring seller check-in',
    channel: 'email',
    subject: 'Still thinking about selling?',
    body:
      'Hi {{first_name}},\n\nJust checking in — if selling your home is still on your mind this ' +
      'spring, I can put together a cash offer with no pressure and no fees. Reply anytime.\n\n— AL',
    audienceTag: 'seller',
  })

  // A small reusable template library so the Templates page opens onto real
  // saved drafts: a couple of email templates with subjects and a few SMS
  // one-liners, all using merge fields. Created oldest-first so "New offer
  // follow-up" lands at the top of the newest-first list.
  const templates = new TemplatesRepo(db, locId)
  await templates.create({
    name: 'Welcome — new lead',
    channel: 'email',
    subject: 'Thanks for reaching out, {{first_name}}',
    body:
      'Hi {{first_name}},\n\nThanks for getting in touch. I help homeowners sell quickly for a fair ' +
      'cash price — no repairs, no fees, no pressure. When is a good time for a quick call?\n\n— AL',
  })
  await templates.create({
    name: 'Appointment reminder',
    channel: 'sms',
    subject: null,
    body: 'Hi {{first_name}}, just a reminder about our call today. Talk soon! — AL',
  })
  await templates.create({
    name: 'Missed you',
    channel: 'sms',
    subject: null,
    body: 'Hi {{first_name}}, tried reaching you and missed you. Reply here when you have a minute.',
  })
  await templates.create({
    name: 'New offer follow-up',
    channel: 'email',
    subject: 'Your cash offer for the property',
    body:
      'Hi {{first_name}},\n\nFollowing up on the cash offer for your home. The number is good for ' +
      '14 days and there are no fees or closing costs on your side. Happy to walk you through it ' +
      'whenever works.\n\n— AL',
  })

  // Two automation workflows so the Automations builder opens onto real flows:
  // a live "new lead welcome" (tag + first-touch SMS) and a draft appointment
  // confirmation. These are definitions; the dev-server pre-runs the live one so
  // the runs panel shows a real execution (prod runs them on real trigger events).
  const workflows = new WorkflowsRepo(db, locId)
  const workflowActions = new WorkflowActionsRepo(db, locId)

  const welcome = await workflows.create({
    name: 'New lead welcome',
    triggerType: 'contact_created',
  })
  await workflowActions.replaceAll(welcome.id, [
    { type: 'add_tag', config: { tag: 'lead' } },
    {
      type: 'send_sms',
      config: {
        body: "Hi {{first_name}}, thanks for reaching out — I'll be in touch shortly about your property.",
      },
    },
  ])
  await workflows.update(welcome.id, { status: 'live' })

  const confirm = await workflows.create({
    name: 'Appointment confirmation',
    triggerType: 'appointment_booked',
  })
  await workflowActions.replaceAll(confirm.id, [
    { type: 'wait', config: { minutes: 5 } },
    {
      type: 'send_sms',
      config: { body: "You're booked! See you then — reply here if anything changes." },
    },
  ])

  // A published funnel so Sites & Funnels opens onto a real page. The opt-in
  // page captures a lead → tags it `lead` → fires contact_created, which the
  // live "New lead welcome" workflow above is wired to — so a public submit runs
  // the whole capture → automation loop. Submission counts are real (start at 0).
  const funnels = new FunnelsRepo(db, locId)
  const funnelSteps = new FunnelStepsRepo(db, locId)
  const sellFast = await funnels.create({
    name: 'Sell your house fast',
    slug: 'sell-fast',
    status: 'published',
  })
  await funnelSteps.create({
    funnelId: sellFast.id,
    name: 'Opt-in',
    type: 'opt_in',
    path: 'get-offer',
    position: 0,
    content: {
      headline: 'Get a cash offer for your house in 24 hours',
      subhead: 'No repairs, no fees, no obligation. Tell us where to send your offer.',
      cta: 'Get my cash offer',
      tag: 'lead',
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: false },
        { name: 'phone', label: 'Phone', type: 'tel', required: true },
      ],
    },
  })
  await funnelSteps.create({
    funnelId: sellFast.id,
    name: 'Thank you',
    type: 'thank_you',
    path: 'thanks',
    position: 1,
    content: {
      headline: "You're all set — check your phone",
      body: "We got your details and a member of the team will text you your cash offer shortly. Keep an eye on your messages.",
    },
  })

  // A published standalone form so Forms & Surveys opens onto a real page with
  // real history. Unlike a funnel step (which only counts), a form keeps every
  // submission's values — so the submissions viewer has rows to show. The two
  // seeded submissions are tied to real seed contacts and the counter matches
  // the stored rows exactly (2): nothing here is faked.
  const forms = new FormsRepo(db, locId)
  const formSubmissions = new FormSubmissionsRepo(db, locId)
  const cashOffer = await forms.create({
    name: 'Get your cash offer',
    slug: 'cash-offer',
    status: 'published',
    content: {
      headline: 'Get your cash offer',
      subhead: "Tell us about your property and we'll send a no-obligation cash offer within 24 hours.",
      cta: 'Get my offer',
      tag: 'lead',
      successMessage: "Got it — we'll text you your cash offer shortly. Keep an eye on your phone.",
      fields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
        { name: 'phone', label: 'Phone', type: 'tel', required: true },
        { name: 'address', label: 'Property address', type: 'text', required: false },
      ],
    },
  })

  const seedFormSubs: { contact: string; values: Record<string, string> }[] = [
    {
      contact: 'Sam Smith',
      values: { full_name: 'Sam Smith', phone: '+16785550142', address: '482 Oakland Ave' },
    },
    {
      contact: 'Jordan Doe',
      values: { full_name: 'Jordan Doe', phone: '+16785550188', address: 'Duplex on 5th St' },
    },
  ]
  for (const s of seedFormSubs) {
    const contactId = contactIdByName[s.contact] ?? null
    await formSubmissions.create({ formId: cashOffer.id, contactId, values: s.values })
    await forms.incrementSubmissions(cashOffer.id)
    await timeline.add({
      contactId,
      type: 'form_submission',
      refTable: 'forms',
      refId: cashOffer.id,
      payload: { form: 'cash-offer' },
    })
  }

  // A published multi-step survey so Surveys opens onto a real page with real
  // history. A survey is a form split across steps behind a progress bar; it
  // keeps every submission's answers, so the submissions viewer has rows. The
  // three seeded submissions are tied to real seed contacts and the honest
  // counter matches the stored rows exactly (3): nothing here is faked.
  const surveys = new SurveysRepo(db, locId)
  const surveySubmissions = new SurveySubmissionsRepo(db, locId)
  const sellerIntake = await surveys.create({
    name: 'Seller intake',
    slug: 'seller-intake',
    status: 'published',
    content: {
      headline: 'Tell us about your property',
      subhead: 'Three quick steps — about a minute and you’re done.',
      cta: 'Get my cash offer',
      tag: 'seller-lead',
      successMessage: 'Got it — we’ll review your answers and text you a cash offer today.',
      steps: [
        {
          id: 'step-1',
          title: 'About you',
          subtitle: 'So we know who to reach.',
          fields: [
            { name: 'full_name', label: 'Full name', type: 'text', required: true },
            { name: 'phone', label: 'Phone', type: 'tel', required: true },
          ],
        },
        {
          id: 'step-2',
          title: 'The property',
          subtitle: 'A few details so the offer is accurate.',
          fields: [
            { name: 'address', label: 'Property address', type: 'text', required: true },
            { name: 'beds', label: 'Bedrooms', type: 'select', options: ['1', '2', '3', '4', '5+'] },
            {
              name: 'timeline',
              label: 'How soon are you looking to sell?',
              type: 'select',
              options: ['ASAP', '1–3 months', '3–6 months', 'Just exploring'],
            },
          ],
        },
        {
          id: 'step-3',
          title: 'Anything else',
          fields: [
            {
              name: 'condition',
              label: 'Overall condition',
              type: 'select',
              options: ['Move-in ready', 'Needs minor work', 'Needs major work'],
            },
            { name: 'notes', label: 'Anything we should know?', type: 'textarea' },
          ],
        },
      ],
    },
  })

  const seedSurveySubs: { contact: string; values: Record<string, string> }[] = [
    {
      contact: 'Jordan Doe',
      values: {
        full_name: 'Jordan Doe',
        phone: '+16785550188',
        address: 'Duplex on 5th St',
        beds: '4',
        timeline: '1–3 months',
        condition: 'Needs minor work',
        notes: 'Tenant occupied, lease ends in the spring.',
      },
    },
    {
      contact: 'Taylor Reed',
      values: {
        full_name: 'Taylor Reed',
        phone: '+16785550133',
        address: '912 Magnolia Dr',
        beds: '3',
        timeline: 'ASAP',
        condition: 'Move-in ready',
        notes: 'Relocating for work — need a fast, clean close.',
      },
    },
    {
      contact: 'Sam Smith',
      values: {
        full_name: 'Sam Smith',
        phone: '+16785550142',
        address: '482 Oakland Ave',
        beds: '2',
        timeline: 'Just exploring',
        condition: 'Needs major work',
        notes: 'Inherited the property, weighing whether to sell or rent.',
      },
    },
  ]
  for (const s of seedSurveySubs) {
    const contactId = contactIdByName[s.contact] ?? null
    await surveySubmissions.create({ surveyId: sellerIntake.id, contactId, values: s.values })
    await surveys.incrementSubmissions(sellerIntake.id)
    await timeline.add({
      contactId,
      type: 'survey_submission',
      refTable: 'surveys',
      refId: sellerIntake.id,
      payload: { survey: 'seller-intake' },
    })
  }

  // Product catalog: the reusable items the location sells, so an invoice or
  // proposal can be built from a saved price instead of retyping it. These mirror
  // the real line items used by the seeded invoices and proposals below — the
  // catalog is the believable source those documents were built from. Mixed
  // one_time and recurring, plus one archived item to prove archive retires a
  // product from the picker without deleting its history. Order is the operator's
  // chosen catalog order (position), assigned as each is created.
  const products = new ProductsRepo(db, locId)
  await products.create({
    name: 'Property Inspection',
    description: 'Full single-family property inspection with same-day report.',
    priceCents: 25_000,
  })
  await products.create({
    name: 'Re-Inspection Follow-up',
    description: 'Return visit to verify completed repairs.',
    priceCents: 10_000,
  })
  await products.create({
    name: 'Cash-Offer Consultation',
    description: 'One-on-one consultation to review a cash offer.',
    priceCents: 15_000,
  })
  await products.create({
    name: 'Onboarding and Setup',
    description: 'One-time onboarding, account setup and configuration.',
    priceCents: 150_000,
  })
  const retainer = await products.create({
    name: 'Monthly Management Retainer',
    description: 'Ongoing monthly management, month-to-month.',
    priceCents: 125_000,
    type: 'recurring',
    recurringInterval: 'month',
  })
  // Archived: a legacy package no longer offered, kept so any past document that
  // referenced it still reads true. It is hidden from the active picker.
  const legacyPackage = await products.create({
    name: 'Annual Inspection Package',
    description: 'Discontinued yearly package — retained for past records.',
    priceCents: 240_000,
    type: 'recurring',
    recurringInterval: 'year',
  })
  await products.update(legacyPackage.id, { status: 'archived' })

  // Subscriptions: the recurring commitments contacts are on (Payments ->
  // Subscriptions). Each is SNAPSHOT off a catalog product above exactly the way
  // the live route does it, so a figure ties back to a real catalog price. These
  // are bookkeeping records — the seed never charges anyone, it only records that
  // an arrangement exists. A mix of active, paused and canceled, including one
  // started from the now-archived annual package to prove a subscription outlives
  // the product it came from. MRR over the two active rows is $1,450.00/mo
  // ($1,250 retainer + $2,400/yr package normalised to $200/mo).
  const subscriptions = new SubscriptionsRepo(db, locId)
  // Marcus is on the monthly management retainer.
  await subscriptions.create({
    productId: retainer.id,
    contactId: contactIdByName['Sam Smith'] ?? null,
    name: retainer.name,
    amountCents: retainer.price_cents,
    currency: retainer.currency,
    interval: retainer.recurring_interval ?? 'month',
    startedAt: '2026-03-15T00:00:00.000Z',
  })
  // Tanya kept the annual package even after it was retired from the catalog.
  await subscriptions.create({
    productId: legacyPackage.id,
    contactId: contactIdByName['Taylor Reed'] ?? null,
    name: legacyPackage.name,
    amountCents: legacyPackage.price_cents,
    currency: legacyPackage.currency,
    interval: legacyPackage.recurring_interval ?? 'year',
    startedAt: '2025-11-01T00:00:00.000Z',
  })
  // Derek paused his retainer while he is between properties.
  const derekRetainer = await subscriptions.create({
    productId: retainer.id,
    contactId: contactIdByName['Jordan Doe'] ?? null,
    name: retainer.name,
    amountCents: retainer.price_cents,
    currency: retainer.currency,
    interval: retainer.recurring_interval ?? 'month',
    startedAt: '2026-02-01T00:00:00.000Z',
  })
  await subscriptions.update(derekRetainer.id, { status: 'paused' })
  // Tanya's earlier month-to-month retainer was canceled when she moved to annual.
  const tanyaOldRetainer = await subscriptions.create({
    productId: retainer.id,
    contactId: contactIdByName['Taylor Reed'] ?? null,
    name: retainer.name,
    amountCents: retainer.price_cents,
    currency: retainer.currency,
    interval: retainer.recurring_interval ?? 'month',
    startedAt: '2025-09-01T00:00:00.000Z',
  })
  await subscriptions.update(tanyaOldRetainer.id, { status: 'canceled' })

  // Coupons: reusable discount codes (Payments -> Coupons). Definitions only —
  // the seed never charges anyone; applying a coupon (a later module) would just
  // lower a recorded invoice total. A spread of shapes so the manager opens onto
  // real history: percent and fixed, capped and uncapped, one already expired and
  // one archived. The expired-but-active coupon proves the DERIVED "redeemable"
  // state (active AND not past expiry AND under its cap) is lower than the bare
  // active count. times_redeemed is only ever advanced through the real
  // incrementRedeemed path, never set directly, so the usage figures stay honest.
  const coupons = new CouponsRepo(db, locId)
  const redeem = async (id: string, n: number) => {
    for (let i = 0; i < n; i++) await coupons.incrementRedeemed(id)
  }

  const welcomeCoupon = await coupons.create({
    code: 'WELCOME10',
    description: 'New-customer welcome - 10% off a first invoice.',
    discountType: 'percent',
    discountValue: 10,
  })
  await redeem(welcomeCoupon.id, 14)

  const summer = await coupons.create({
    code: 'SUMMER25',
    description: 'Summer promo - 25% off, capped at 100 uses.',
    discountType: 'percent',
    discountValue: 25,
    maxRedemptions: 100,
    expiresAt: '2026-09-30T00:00:00.000Z',
  })
  await redeem(summer.id, 9)

  const first50 = await coupons.create({
    code: 'FIRST50',
    description: '$50 off the first month of any plan.',
    discountType: 'fixed',
    discountValue: 5_000,
  })
  await redeem(first50.id, 4)

  // Active but already past its expiry — an active coupon that can't be redeemed,
  // so the Redeemable KPI reads below the Active count.
  const spring = await coupons.create({
    code: 'SPRING15',
    description: 'Spring sale (ended) - 15% off.',
    discountType: 'percent',
    discountValue: 15,
    expiresAt: '2026-04-30T00:00:00.000Z',
  })
  await redeem(spring.id, 6)

  // Retired from use but kept for its redemption history.
  const launch = await coupons.create({
    code: 'LAUNCHDEAL',
    description: 'Launch week - $100 off (retired).',
    discountType: 'fixed',
    discountValue: 10_000,
  })
  await redeem(launch.id, 21)
  await coupons.update(launch.id, { status: 'archived' })

  // Three invoices in mixed states so the Payments module opens onto real
  // history and its outstanding/paid KPIs aren't empty. Each total is DERIVED
  // from the line items below (never stored on the row), so a figure shown can
  // never drift from the lines that justify it. Numbers are assigned exactly the
  // way the API does — `nextNumber()` — giving INV-1001/1002/1003 in order.
  // markSent / recordPayment here are bookkeeping only: the seed records what
  // happened, it never charges a card or moves money. Send + payment also log
  // the contact's timeline, mirroring the live routes.
  const invoices = new InvoicesRepo(db, locId)

  // 1) Paid — Sam Smith's inspection, sent then settled by card ($265.00).
  const inv1Items = [
    { description: 'Property inspection — 482 Oakland Ave', quantity: 1, unit_amount: 25_000 },
    { description: 'Travel', quantity: 1, unit_amount: 1_500 },
  ]
  const inv1 = await invoices.create({
    number: await invoices.nextNumber(),
    contactId: contactIdByName['Sam Smith'] ?? null,
    items: inv1Items,
    notes: 'Thanks for your business.',
    dueAt: iso(at(-3, 9)),
  })
  await invoices.markSent(inv1.id)
  await invoices.recordPayment(inv1.id, 'card')
  if (inv1.contact_id) {
    await timeline.add({
      contactId: inv1.contact_id,
      type: 'invoice_sent',
      refTable: 'invoices',
      refId: inv1.id,
      payload: { number: inv1.number, total_cents: invoiceTotalCents(inv1Items) },
    })
    await timeline.add({
      contactId: inv1.contact_id,
      type: 'payment_received',
      refTable: 'invoices',
      refId: inv1.id,
      payload: { number: inv1.number, total_cents: invoiceTotalCents(inv1Items), method: 'card' },
    })
  }

  // 2) Sent — Taylor Reed's consultation, awaiting payment ($150.00). This is
  // the one "outstanding" row, so the outstanding KPI reads exactly its total.
  const inv2Items = [{ description: 'Cash-offer consultation', quantity: 1, unit_amount: 15_000 }]
  const inv2 = await invoices.create({
    number: await invoices.nextNumber(),
    contactId: contactIdByName['Taylor Reed'] ?? null,
    items: inv2Items,
    dueAt: iso(at(10, 9)),
  })
  await invoices.markSent(inv2.id)
  if (inv2.contact_id) {
    await timeline.add({
      contactId: inv2.contact_id,
      type: 'invoice_sent',
      refTable: 'invoices',
      refId: inv2.id,
      payload: { number: inv2.number, total_cents: invoiceTotalCents(inv2Items) },
    })
  }

  // 3) Draft — Jordan Doe's duplex inspection, not yet sent ($400.00). A draft
  // hasn't reached the contact, so it logs no timeline activity and is excluded
  // from the outstanding KPI.
  await invoices.create({
    number: await invoices.nextNumber(),
    contactId: contactIdByName['Jordan Doe'] ?? null,
    items: [
      { description: 'Duplex inspection — 5th St', quantity: 1, unit_amount: 30_000 },
      { description: 'Re-inspection follow-up', quantity: 1, unit_amount: 10_000 },
    ],
    notes: 'Draft — confirm scope with Derek before sending.',
  })

  // A handful more settled invoices, backdated across the last several weeks and
  // spread over every payment method, so the Transactions ledger (Payments ->
  // Transactions) opens onto real history instead of a single row. recordPayment
  // stamps paid_at to now(), so the paper trail is backdated directly below —
  // still bookkeeping only, no money moves. Timeline events are intentionally
  // skipped here: the ledger reads paid_at straight off the invoice, and a
  // weeks-old payment shouldn't plant a "today" entry on the contact's timeline.
  const morePaid: {
    contact: string
    method: string
    daysAgo: number
    items: { description: string; quantity: number; unit_amount: number }[]
  }[] = [
    {
      contact: 'Sam Smith',
      method: 'bank_transfer',
      daysAgo: 4,
      items: [
        { description: 'Roof certification — 482 Oakland Ave', quantity: 1, unit_amount: 20_000 },
        { description: 'Report rush fee', quantity: 1, unit_amount: 2_500 },
      ],
    },
    {
      contact: 'Taylor Reed',
      method: 'cash',
      daysAgo: 8,
      items: [{ description: 'Pre-listing walkthrough', quantity: 1, unit_amount: 12_000 }],
    },
    {
      contact: 'Jordan Doe',
      method: 'check',
      daysAgo: 23,
      items: [
        { description: 'Duplex re-inspection — 5th St', quantity: 1, unit_amount: 30_000 },
        { description: 'Moisture scan', quantity: 1, unit_amount: 5_000 },
      ],
    },
    {
      contact: 'Sam Smith',
      method: 'card',
      daysAgo: 39,
      items: [{ description: 'Foundation inspection — Maple Ct', quantity: 1, unit_amount: 28_000 }],
    },
  ]
  for (const p of morePaid) {
    const inv = await invoices.create({
      number: await invoices.nextNumber(),
      contactId: contactIdByName[p.contact] ?? null,
      items: p.items,
    })
    await invoices.markSent(inv.id)
    await invoices.recordPayment(inv.id, p.method)
    // Backdate the paper trail so the ledger reads as genuine history: issued the
    // day before, settled on the day. paid_at is the column the Transactions read
    // model orders and dates by, so it carries the real spread.
    await db.query(
      'UPDATE invoices SET created_at=$1, issued_at=$1, paid_at=$2 WHERE location_id=$3 AND id=$4',
      [iso(at(-(p.daysAgo + 1), 9)), iso(at(-p.daysAgo, 13)), locId, inv.id],
    )
  }

  // Proposals seed: three signable sales documents in mixed states so the
  // Proposals module opens onto real history. Every dollar total — on a row, on
  // the public page, in a timeline payload — is DERIVED from the document's
  // line_items (proposal-math.ts), never stored, so the amount a client signs
  // for can't drift from the lines that justify it. The one signed proposal
  // records exactly the name the recipient typed (sign()), never a forged
  // signature — an unsigned proposal honestly reads "awaiting signature". We
  // mirror the live loop: send (proposal_sent) → the recipient signs on the
  // public page (proposal_signed). One is left sent (awaiting) and one draft.
  const proposals = new ProposalsRepo(db, locId)

  // 1) Signed — Tanya accepted the management retainer. send → sign, both logged.
  const propTanyaContent = {
    intro:
      "Thanks for the great call, Tanya. Here's exactly what we'll run for you and what it costs — no surprises.",
    line_items: [
      { description: 'Onboarding & setup (one-time)', quantity: 1, unit_amount: 150000 },
      { description: 'Monthly management', quantity: 1, unit_amount: 125000 },
    ],
    terms: 'Valid for 30 days. Month-to-month after setup; cancel anytime with 30 days notice.',
  }
  const propTanya = await proposals.create({
    title: 'Marketing management — Taylor Reed',
    slug: 'tanya-management',
    contactId: contactIdByName['Taylor Reed'] ?? null,
    content: propTanyaContent,
  })
  await proposals.markSent(propTanya.id)
  await proposals.sign(propTanya.id, 'Taylor Reed')
  if (propTanya.contact_id) {
    await timeline.add({
      contactId: propTanya.contact_id,
      type: 'proposal_sent',
      refTable: 'proposals',
      refId: propTanya.id,
      payload: { title: propTanya.title, total_cents: proposalTotalCents(readLineItems(propTanyaContent)) },
    })
    await timeline.add({
      contactId: propTanya.contact_id,
      type: 'proposal_signed',
      refTable: 'proposals',
      refId: propTanya.id,
      payload: { proposal: propTanya.slug, signer_name: 'Taylor Reed' },
    })
  }

  // 2) Sent — Marcus's growth proposal, awaiting his signature. Stable slug so the
  //    public signable page has a fixed demo URL for screenshots.
  const propMarcusContent = {
    intro:
      "Here's the growth plan we discussed for 482 Oakland Ave and your other listings, Marcus. Review and sign below to get started.",
    line_items: [
      { description: 'Strategy & setup (one-time)', quantity: 1, unit_amount: 350000 },
      { description: 'Monthly management', quantity: 1, unit_amount: 125000 },
      { description: 'Paid-ads management', quantity: 1, unit_amount: 75000 },
    ],
    terms: 'Valid for 30 days. Month-to-month after setup; cancel anytime with 30 days notice.',
  }
  const propMarcus = await proposals.create({
    title: 'Growth proposal — Sam Smith',
    slug: 'marcus-growth',
    contactId: contactIdByName['Sam Smith'] ?? null,
    content: propMarcusContent,
  })
  await proposals.markSent(propMarcus.id)
  if (propMarcus.contact_id) {
    await timeline.add({
      contactId: propMarcus.contact_id,
      type: 'proposal_sent',
      refTable: 'proposals',
      refId: propMarcus.id,
      payload: { title: propMarcus.title, total_cents: proposalTotalCents(readLineItems(propMarcusContent)) },
    })
  }

  // 3) Draft — Derek's proposal, not yet sent. A draft hasn't reached the contact,
  //    so it logs no timeline activity and its public link is a 404 until sent.
  await proposals.create({
    title: 'Foundation proposal — Jordan Doe',
    slug: 'derek-foundation',
    contactId: contactIdByName['Jordan Doe'] ?? null,
    content: {
      intro: 'Draft — confirm scope on our next call before sending.',
      line_items: [{ description: 'Foundation setup (one-time)', quantity: 1, unit_amount: 150000 }],
      terms: 'Valid for 30 days once sent.',
    },
  })

  // Reputation seed: real reviews and the requests that produced them, so the
  // Reputation module opens onto an honest history. The headline average is
  // DERIVED from these rows (review-math.ts), never stored — the seed can't
  // invent a rating the rows don't justify. We mirror the live loop exactly:
  // ask (review_request) → customer submits on the public page (review) → the
  // request flips to completed. One request is left pending so the "awaiting"
  // KPI and the response rate are real counts, not guesses.
  const reviewRequests = new ReviewRequestsRepo(db, locId)
  const reviews = new ReviewsRepo(db, locId)

  // 1) Sam Smith — asked by SMS, left 5 stars. Request → review → completed.
  const rqMarcus = await reviewRequests.create({
    contactId: contactIdByName['Sam Smith'] ?? null,
    channel: 'sms',
    token: nanoid(),
  })
  if (rqMarcus.contact_id) {
    await timeline.add({
      contactId: rqMarcus.contact_id,
      type: 'review_request',
      refTable: 'review_requests',
      refId: rqMarcus.id,
      payload: { channel: 'sms' },
    })
  }
  const rvMarcus = await reviews.create({
    contactId: rqMarcus.contact_id,
    requestId: rqMarcus.id,
    rating: 5,
    body: 'Alex gave us a fair cash offer and closed in under two weeks. No surprises, no pressure.',
    reviewerName: 'Sam Smith',
    source: 'direct',
  })
  await reviewRequests.markCompleted(rqMarcus.id)
  if (rqMarcus.contact_id) {
    await timeline.add({
      contactId: rqMarcus.contact_id,
      type: 'review_received',
      refTable: 'reviews',
      refId: rvMarcus.id,
      payload: { rating: 5 },
    })
  }

  // 2) Taylor Reed — asked by SMS, left 5 stars.
  const rqTanya = await reviewRequests.create({
    contactId: contactIdByName['Taylor Reed'] ?? null,
    channel: 'sms',
    token: nanoid(),
  })
  if (rqTanya.contact_id) {
    await timeline.add({
      contactId: rqTanya.contact_id,
      type: 'review_request',
      refTable: 'review_requests',
      refId: rqTanya.id,
      payload: { channel: 'sms' },
    })
  }
  const rvTanya = await reviews.create({
    contactId: rqTanya.contact_id,
    requestId: rqTanya.id,
    rating: 5,
    body: 'Smooth process from the first call to closing. Alex answered every question quickly.',
    reviewerName: 'Taylor Reed',
    source: 'direct',
  })
  await reviewRequests.markCompleted(rqTanya.id)
  if (rqTanya.contact_id) {
    await timeline.add({
      contactId: rqTanya.contact_id,
      type: 'review_received',
      refTable: 'reviews',
      refId: rvTanya.id,
      payload: { rating: 5 },
    })
  }

  // 3) A direct 4-star review left through the public link with no prior request
  //    — not every review comes from outreach, and it's honest to show that.
  await reviews.create({
    contactId: null,
    rating: 4,
    body: 'Good experience overall. Fair price; the paperwork took a little longer than I expected.',
    reviewerName: 'Priya Nair',
    source: 'direct',
  })

  // 4) Jordan Doe — asked, hasn't responded yet. Keeps the "awaiting" KPI at 1
  //    and the response rate honest (2 of 3 requests answered). Stable token so
  //    the public star-rating page has a fixed demo URL for screenshots.
  const rqDerek = await reviewRequests.create({
    contactId: contactIdByName['Jordan Doe'] ?? null,
    channel: 'sms',
    token: 'demo-review-derek',
  })
  if (rqDerek.contact_id) {
    await timeline.add({
      contactId: rqDerek.contact_id,
      type: 'review_request',
      refTable: 'review_requests',
      refId: rqDerek.id,
      payload: { channel: 'sms' },
    })
  }

  // Memberships seed: a published course with real lessons and three enrollees at
  // different stages, plus a draft course. Every "% complete" the operator and the
  // student see is DERIVED from the lesson_completions written here (course-math.ts),
  // never stored — so the seed can't show progress the completions don't justify.
  // We mirror the live loop exactly: enroll (course_enrolled) → the student finishes
  // lessons on the public player (lesson_completions) → at a true 100% the enrollment
  // flips to completed (course_completed).
  const courses = new CoursesRepo(db, locId)
  const lessons = new LessonsRepo(db, locId)
  const enrollments = new EnrollmentsRepo(db, locId)
  const completions = new LessonCompletionsRepo(db, locId)

  const playbook = await courses.create({
    title: 'Wholesaling Playbook',
    slug: 'wholesaling-playbook',
    description: 'The exact steps Alex uses to find, underwrite, and assign a cash deal.',
    status: 'published',
  })
  const pbLessons = []
  for (const [i, l] of [
    {
      title: 'Find motivated sellers',
      content:
        'Where the deals actually come from: driving for dollars, a skip-traced list, and the three signs a seller is ready to move.',
    },
    {
      title: 'Underwrite the offer',
      content: 'Pull comps, back out repairs, and land on a number that leaves room for the assignment.',
    },
    {
      title: 'Make the call',
      content:
        'The opening script, the questions that surface motivation, and how to present the cash number without flinching.',
    },
    {
      title: 'Assign the contract',
      content: 'Lock the contract, line up a cash buyer, and collect the assignment fee at closing.',
    },
  ].entries()) {
    pbLessons.push(
      await lessons.create({ courseId: playbook.id, position: i, title: l.title, content: l.content }),
    )
  }

  // 1) Sam Smith — mid-course (2 of 4 done = 50%). Stable token so the public
  //    course player has a fixed demo URL for screenshots.
  const enMarcus = await enrollments.create({
    courseId: playbook.id,
    contactId: contactIdByName['Sam Smith'] ?? null,
    token: 'demo-course-Alex',
  })
  if (enMarcus.contact_id) {
    await timeline.add({
      contactId: enMarcus.contact_id,
      type: 'course_enrolled',
      refTable: 'enrollments',
      refId: enMarcus.id,
      payload: { courseId: playbook.id },
    })
  }
  await completions.add(enMarcus.id, pbLessons[0]!.id)
  await completions.add(enMarcus.id, pbLessons[1]!.id)

  // 2) Taylor Reed — finished every lesson (100%). Mirrors the public player's
  //    path: all completions land, then the enrollment flips to completed.
  const enTanya = await enrollments.create({
    courseId: playbook.id,
    contactId: contactIdByName['Taylor Reed'] ?? null,
    token: nanoid(),
  })
  if (enTanya.contact_id) {
    await timeline.add({
      contactId: enTanya.contact_id,
      type: 'course_enrolled',
      refTable: 'enrollments',
      refId: enTanya.id,
      payload: { courseId: playbook.id },
    })
  }
  for (const l of pbLessons) await completions.add(enTanya.id, l.id)
  await enrollments.markCompleted(enTanya.id)
  if (enTanya.contact_id) {
    await timeline.add({
      contactId: enTanya.contact_id,
      type: 'course_completed',
      refTable: 'enrollments',
      refId: enTanya.id,
      payload: { courseId: playbook.id },
    })
  }

  // 3) Jordan Doe — just enrolled, nothing finished yet (0%). An enrollee at 0
  //    pulls the course average down, as it honestly should.
  const enDerek = await enrollments.create({
    courseId: playbook.id,
    contactId: contactIdByName['Jordan Doe'] ?? null,
    token: nanoid(),
  })
  if (enDerek.contact_id) {
    await timeline.add({
      contactId: enDerek.contact_id,
      type: 'course_enrolled',
      refTable: 'enrollments',
      refId: enDerek.id,
      payload: { courseId: playbook.id },
    })
  }

  // A second course still in draft with no enrollees — an honest "not published
  // yet" state on the list, not a hidden empty.
  const mastery = await courses.create({
    title: 'Cash Offer Mastery',
    slug: 'cash-offer-mastery',
    description: 'A short follow-up on presenting your number with confidence.',
    status: 'draft',
  })
  await lessons.create({
    courseId: mastery.id,
    position: 0,
    title: 'Reading the comps',
    content: 'Turn raw sales data into a defensible after-repair value.',
  })
  await lessons.create({
    courseId: mastery.id,
    position: 1,
    title: 'Presenting your number',
    content: 'Frame the offer around what the seller needs, not just the price.',
  })

  // Blog seed: two published posts and one draft. The "X min read" badge on every
  // entry is DERIVED from the body's real word count (blog-math.ts), never stored,
  // so it can't drift from the post. published_at is stamped on publish (the repo's
  // CASE/COALESCE), and only the two published posts are ever served on the public
  // blog — the draft proves the operator list shows what the public can't see.
  const blog = new BlogPostsRepo(db, locId)
  // Created oldest-first so published_at orders the index naturally (newest on top).
  await blog.create({
    title: 'How a Cash Offer Actually Works, Start to Finish',
    slug: 'how-cash-offers-work',
    author: 'Alex Mercer',
    status: 'published',
    excerpt: 'From your first call to closing day — every step of a cash sale, with no surprises.',
    body: [
      'When people hear "cash offer," they picture a stranger showing up with a briefcase. The reality is calmer than that, and a lot more predictable. Here is exactly how it goes.',
      'It starts with a short call. We ask about the house, why you are selling, and the timeline that works for you — not the other way around. There is no obligation, and nothing happens until you decide it should.',
      'Next, we look at the property. Sometimes that is an in-person walkthrough, sometimes it is photos and a few questions. We are not looking for reasons to lower the number; we are confirming what we already estimated so the offer we give you is the offer that holds.',
      'Then you get a written offer. It spells out the price, who covers closing costs, and the date you would have your money. You can sit with it, ask questions, or walk away. We would rather you feel sure than feel rushed.',
      'If you say yes, we open escrow with a title company and they handle the paperwork. On closing day you sign, and the funds are wired to you. No repairs, no staging, no waiting on a buyer\'s mortgage to come through.',
      'That is the whole process. The point of paying cash is to take the uncertainty off your plate — so the hard part of selling becomes the easy part.',
    ].join('\n\n'),
  })
  await blog.create({
    title: 'Should You Sell Your House As-Is? Here\'s the Honest Math',
    slug: 'sell-as-is-honest-math',
    author: 'Alex Mercer',
    status: 'published',
    excerpt: 'Repairs, agent fees, and months on the market — what selling as-is actually saves you.',
    body: [
      'Selling "as-is" sounds like leaving money on the table. Sometimes it is. Often it is not. The only way to know is to run the real numbers for your situation, so let us do that honestly.',
      'On the open market, the sale price is the headline — but it is not what you keep. Subtract the repairs a buyer\'s inspector will flag, the agent commission on both sides, the months of mortgage and utilities while it sits, and the price you drop to get it moving. What is left is your real number.',
      'A cash, as-is sale trades a lower headline price for certainty and speed. You skip the repairs, you skip the commissions, and you skip the waiting. For some sellers the market still wins after all of that. For others — especially if the house needs work or you need to move fast — as-is comes out ahead.',
      'We will never tell you a cash offer is the right move when the math says otherwise. If listing it nets you more and you have the time, we will say so. The goal is the decision that is actually best for you, not the one that is best for us.',
    ].join('\n\n'),
  })
  await blog.create({
    title: 'Avoiding Foreclosure: Your Options Before It\'s Too Late',
    slug: 'avoiding-foreclosure-options',
    author: 'Alex Mercer',
    status: 'draft',
    excerpt: 'A draft in progress — the paths still open once you fall behind, and how much time each one buys.',
    body: 'Draft in progress. This post will walk through forbearance, short sales, and a cash sale as ways to stay ahead of a foreclosure timeline.',
  })

  // Trigger links: trackable short links whose figures — total clicks, distinct
  // contacts reached, last clicked — are DERIVED from the real click rows below
  // (a LEFT JOIN aggregate), never a stored counter, so they can't be inflated.
  // Three links show the honest spread: a popular quote link, a modest guide
  // link, and a brand-new link nobody has opened (its stats aggregate to a real
  // zero, which the UI renders as an honest "—").
  const triggerLinks = new TriggerLinksRepo(db, locId)
  const quote = await triggerLinks.create({
    name: 'Free Cash Offer Quote',
    slug: 'free-offer',
    destinationUrl: 'https://acmehomebuyers.example/cash-offer',
  })
  const guide = await triggerLinks.create({
    name: 'Foreclosure Help Guide',
    slug: 'foreclosure-help',
    destinationUrl: 'https://acmehomebuyers.example/foreclosure-guide',
  })
  // Brand-new link, never opened — proves the list shows an honest zero.
  await triggerLinks.create({
    name: 'New Listing Alerts',
    slug: 'listing-alerts',
    destinationUrl: 'https://acmehomebuyers.example/alerts',
  })

  // Real click rows, backdated so the activity feed and "last clicked" read
  // naturally. Each is one open: some attributed to a known contact (and mirrored
  // onto that contact's timeline, exactly as the live redirect route does), some
  // anonymous (contact null) — those still count but never claim an identity.
  // clicked_at can't be set through the repo (it always stamps now()), so these
  // backdated rows are inserted directly, the same way the pipeline/stage seed is.
  const hoursAgoIso = (h: number) => iso(new Date(now.getTime() - h * 3_600_000))
  const clickPlan: { link: TriggerLink; contact: string | null; hoursAgo: number }[] = [
    { link: quote, contact: 'Sam Smith', hoursAgo: 2 },
    { link: quote, contact: 'Taylor Reed', hoursAgo: 27 },
    { link: quote, contact: 'Jordan Doe', hoursAgo: 50 },
    { link: quote, contact: null, hoursAgo: 73 },
    { link: quote, contact: null, hoursAgo: 99 },
    { link: guide, contact: 'Jordan Doe', hoursAgo: 19 },
    { link: guide, contact: null, hoursAgo: 64 },
  ]
  for (const c of clickPlan) {
    const contactId = c.contact ? (contactIdByName[c.contact] ?? null) : null
    const when = hoursAgoIso(c.hoursAgo)
    await db.query(
      `INSERT INTO trigger_link_clicks (id, location_id, link_id, contact_id, clicked_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [nanoid(), locId, c.link.id, contactId, when],
    )
    if (contactId) {
      await db.query(
        `INSERT INTO timeline_events (id, location_id, contact_id, type, ref_table, ref_id, payload, occurred_at)
         VALUES ($1,$2,$3,'trigger_link_click','trigger_links',$4,$5,$6)`,
        [nanoid(), locId, contactId, c.link.id, JSON.stringify({ link: c.link.slug, name: c.link.name }), when],
      )
    }
  }

  // Communities seed: one published Skool-style group space so Communities opens
  // onto a real feed, plus a draft space that proves the list shows what the
  // public can't yet see. Every figure the operator and a visitor read — the
  // member count, the post count, a channel's post count, a post's likes and
  // comments, the "most active channel" — is DERIVED from the rows written here
  // (community-math.ts / live COUNTs), never stored, so the seed can't show
  // engagement the rows don't justify. Only the published space is ever served on
  // the public feed; the draft 404s until the operator publishes it.
  const communities = new CommunitiesRepo(db, locId)
  const channels = new CommunityChannelsRepo(db, locId)
  const communityMembers = new CommunityMembersRepo(db, locId)
  const communityPosts = new CommunityPostsRepo(db, locId)
  const communityComments = new CommunityCommentsRepo(db, locId)
  const communityLikes = new CommunityPostLikesRepo(db, locId)

  const insiders = await communities.create({
    name: 'Cash Offer Insiders',
    slug: 'cash-offer-insiders',
    description:
      'A private space for homeowners and investors working with Alex — wins, walkthroughs, and straight answers about selling for cash.',
    status: 'published',
  })

  // Three channels, ordered the way the rail should read.
  const announcements = await channels.create({
    communityId: insiders.id,
    name: 'Announcements',
    slug: 'announcements',
    position: 0,
  })
  const wins = await channels.create({ communityId: insiders.id, name: 'Wins', slug: 'wins', position: 1 })
  const questions = await channels.create({ communityId: insiders.id, name: 'Q&A', slug: 'qa', position: 2 })

  // Members: Alex as the admin host (no CRM contact), and three real seed
  // contacts brought into the space so a member can author a post or a comment.
  const coachAlex = await communityMembers.create({ communityId: insiders.id, name: 'Coach Alex', role: 'admin' })
  const memberByContact: Record<string, string> = {}
  for (const name of ['Sam Smith', 'Taylor Reed', 'Jordan Doe']) {
    const member = await communityMembers.create({
      communityId: insiders.id,
      name,
      contactId: contactIdByName[name] ?? null,
      role: 'member',
    })
    memberByContact[name] = member.id
  }

  // A pinned welcome from the host in Announcements (no engagement — an honest
  // pinned post can stand on its own).
  await communityPosts.create({
    communityId: insiders.id,
    channelId: announcements.id,
    memberId: coachAlex.id,
    title: 'Welcome to the Insiders space',
    body: [
      'Glad you are here. This is where I post walkthroughs, answer questions, and where members share how their sale went.',
      'Two ground rules: ask anything, and be straight with each other. If a cash sale is not the right move for you, I will say so here just like I would on a call.',
    ].join('\n\n'),
    pinned: true,
  })

  // A member win in Wins with real engagement: two likes + two comments.
  const tanyaWin = await communityPosts.create({
    communityId: insiders.id,
    channelId: wins.id,
    memberId: memberByContact['Taylor Reed'] ?? null,
    title: 'Closed in 11 days — no repairs',
    body: 'Just wanted to share that we closed on the house in eleven days. No repairs, no showings, no agent fees. Exactly what was promised. Thank you Alex.',
  })
  await communityLikes.add(tanyaWin.id, coachAlex.id)
  if (memberByContact['Sam Smith']) await communityLikes.add(tanyaWin.id, memberByContact['Sam Smith'])
  await communityComments.create({
    postId: tanyaWin.id,
    memberId: coachAlex.id,
    body: 'So happy for you, Tanya. You made the whole thing easy on your end too.',
  })
  if (memberByContact['Sam Smith']) {
    await communityComments.create({
      postId: tanyaWin.id,
      memberId: memberByContact['Sam Smith'],
      body: 'This is encouraging — I have a similar timeline in mind.',
    })
  }

  // A genuine question in Q&A with one answer from the host: one like, one comment.
  const marcusQuestion = await communityPosts.create({
    communityId: insiders.id,
    channelId: questions.id,
    memberId: memberByContact['Sam Smith'] ?? null,
    title: 'How do you handle a tenant-occupied property?',
    body: 'I have a duplex with tenants on a lease that runs into the spring. Can you still make a cash offer on something that is occupied?',
  })
  await communityComments.create({
    postId: marcusQuestion.id,
    memberId: coachAlex.id,
    body: 'Absolutely. We buy tenant-occupied all the time — the lease just transfers with the sale. Happy to walk through the specifics on a call.',
  })
  if (memberByContact['Jordan Doe']) await communityLikes.add(marcusQuestion.id, memberByContact['Jordan Doe'])

  // A second community left in draft — an honest "not published yet" on the list,
  // and a 404 on the public feed until the operator flips it live.
  await communities.create({
    name: 'Investor Roundtable',
    slug: 'investor-roundtable',
    description: 'A space for repeat cash buyers. Still being set up.',
    status: 'draft',
  })

  // ── Social Planner ──────────────────────────────────────────────────────────
  // Three accounts, all honestly UNCONNECTED — there is no live platform OAuth
  // yet, so the planner shows "0 connected" and an honest "Connect to auto-
  // publish" prompt. The scheduler itself is fully real: a content calendar of
  // drafts, scheduled posts, and published posts (published = recorded in
  // OpenLevel's ledger; the live network push is the pending adapter). No reach
  // or engagement is seeded anywhere — those figures would be invented.
  const socialAccounts = new SocialAccountsRepo(db, locId)
  const socialPosts = new SocialPostsRepo(db, locId)

  const fbAccount = await socialAccounts.create({ platform: 'facebook', handle: 'Acme Home Buyers' })
  const igAccount = await socialAccounts.create({ platform: 'instagram', handle: '@acmehomebuyers' })
  const gbpAccount = await socialAccounts.create({ platform: 'google_business', handle: 'Acme Home Buyers' })

  // Two posts already published (past dates, recorded in our ledger).
  const closedPost = await socialPosts.create({
    body: 'Closed on a duplex in 9 days — no repairs, no agent fees. If your property needs to move fast, this is exactly what we do. DM me "FAST" to talk.',
    accountIds: [fbAccount.id, igAccount.id],
  })
  await socialPosts.publish(closedPost.id, iso(at(-6, 9)))
  const truthsPost = await socialPosts.create({
    body: 'Three quick truths about cash offers: you skip the showings, you pick the closing date, and you sell completely as-is. Questions? Send a message.',
    accountIds: [fbAccount.id],
  })
  await socialPosts.publish(truthsPost.id, iso(at(-3, 11)))

  // Three posts scheduled across the coming weeks — the upcoming queue.
  await socialPosts.create({
    body: "Free home-value check this week. Reply VALUE and I'll run the numbers on your place — no obligation, no pressure.",
    status: 'scheduled',
    scheduledAt: iso(at(6, 10)),
    accountIds: [fbAccount.id, igAccount.id, gbpAccount.id],
  })
  await socialPosts.create({
    body: 'Client story Friday: a tenant-occupied sale that closed without the tenants ever moving. The lease just transferred with the property.',
    status: 'scheduled',
    scheduledAt: iso(at(11, 9)),
    accountIds: [igAccount.id],
  })
  await socialPosts.create({
    body: 'Q&A Thursday — "How fast can you really close?" Short answer: as fast as the title company allows. The real timeline is in the post.',
    status: 'scheduled',
    scheduledAt: iso(at(18, 14)),
    accountIds: [fbAccount.id, gbpAccount.id],
  })

  // One draft still being worked on — an honest "not scheduled yet".
  await socialPosts.create({
    body: 'DRAFT — neighborhood spotlight on the east side. Need two exterior photos before this goes out.',
    accountIds: [fbAccount.id],
  })

  // ── Affiliate Manager ───────────────────────────────────────────────────────
  // One 10% referral program with four partners showing an honest spread: a top
  // performer with a paid + an owed referral, a partner with one approved-but-
  // unpaid sale, a partner who drove clicks but no sales yet (honest 0% conversion),
  // and a brand-new partner with nothing recorded (an honest all-zero). Every
  // figure the manager shows — clicks, referrals, sales volume, commission, the
  // conversion rate — is DERIVED from the click + referral rows below (correlated
  // COUNTs, never a stored counter), so nothing claims activity the rows don't
  // justify. Each referral's commission is LOCKED at the program rate the moment it
  // is recorded (commissionCents), so a later rate change can't rewrite history.
  // Clicks and referrals are backdated, so — like the trigger-link clicks — they
  // are inserted directly (the repos always stamp now()).
  const affiliatePrograms = new AffiliateProgramsRepo(db, locId)
  const affiliates = new AffiliatesRepo(db, locId)
  const program = await affiliatePrograms.create({
    name: 'Partner Referral Program',
    commissionType: 'percent',
    commissionValue: 10,
    landingUrl: 'https://acmehomebuyers.example/cash-offer',
  })

  const marcusAff = await affiliates.create({
    programId: program.id,
    name: 'Sam Smith',
    email: 'marcus.webb@example.com',
    code: 'MARCUSWEBB',
    contactId: contactIdByName['Sam Smith'] ?? null,
  })
  const tanyaAff = await affiliates.create({
    programId: program.id,
    name: 'Taylor Reed',
    email: 'tanya.okafor@example.com',
    code: 'TANYAO',
    contactId: contactIdByName['Taylor Reed'] ?? null,
  })
  const derekAff = await affiliates.create({
    programId: program.id,
    name: 'Jordan Doe',
    email: 'derek.sull@example.com',
    code: 'DEREKS',
    contactId: contactIdByName['Jordan Doe'] ?? null,
  })
  // A brand-new partner with no linked CRM contact and nothing recorded — proves
  // the manager shows an honest zero, not a fabricated head start.
  await affiliates.create({
    programId: program.id,
    name: 'Riverside Realty Partners',
    email: 'intro@riverside-realty.example',
    code: 'RIVERSIDE',
  })

  // Real referral-link visits, backdated. Most are anonymous prospects; one is a
  // known CRM contact who clicked (attributed via ?c= in the live route).
  const refClickPlan: { aff: string; contact: string | null; hoursAgo: number }[] = [
    { aff: marcusAff.id, contact: 'Taylor Reed', hoursAgo: 5 },
    { aff: marcusAff.id, contact: null, hoursAgo: 14 },
    { aff: marcusAff.id, contact: null, hoursAgo: 28 },
    { aff: marcusAff.id, contact: null, hoursAgo: 41 },
    { aff: marcusAff.id, contact: null, hoursAgo: 66 },
    { aff: marcusAff.id, contact: null, hoursAgo: 88 },
    { aff: tanyaAff.id, contact: null, hoursAgo: 9 },
    { aff: tanyaAff.id, contact: null, hoursAgo: 33 },
    { aff: tanyaAff.id, contact: null, hoursAgo: 70 },
    { aff: derekAff.id, contact: null, hoursAgo: 12 },
    { aff: derekAff.id, contact: null, hoursAgo: 38 },
    { aff: derekAff.id, contact: null, hoursAgo: 59 },
    { aff: derekAff.id, contact: null, hoursAgo: 91 },
  ]
  for (const v of refClickPlan) {
    const contactId = v.contact ? (contactIdByName[v.contact] ?? null) : null
    await db.query(
      `INSERT INTO affiliate_clicks (id, location_id, affiliate_id, contact_id, clicked_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [nanoid(), locId, v.aff, contactId, hoursAgoIso(v.hoursAgo)],
    )
  }

  // Recorded sales. Commission is locked at the 10% program rate via the same
  // commissionCents the route uses. The three rows cover the full GHL lifecycle:
  // Marcus has one paid + one pending (awaiting review, NOT owed); Tanya has one
  // approved-but-unpaid — the only row "Record payout" would settle.
  const refPlan: {
    aff: string
    contact: string | null
    description: string
    amountCents: number
    status: string
    occurredHoursAgo: number
    paidHoursAgo: number | null
  }[] = [
    {
      aff: marcusAff.id,
      contact: 'Jordan Doe',
      description: 'Cash sale — 2BR bungalow on Maple',
      amountCents: 450_000,
      status: 'paid',
      occurredHoursAgo: 30,
      paidHoursAgo: 6,
    },
    {
      aff: marcusAff.id,
      contact: null,
      description: 'Cash sale — duplex on Elm',
      amountCents: 320_000,
      status: 'pending',
      occurredHoursAgo: 10,
      paidHoursAgo: null,
    },
    {
      aff: tanyaAff.id,
      contact: null,
      description: 'Cash sale — vacant lot on 7th',
      amountCents: 280_000,
      status: 'approved',
      occurredHoursAgo: 20,
      paidHoursAgo: null,
    },
  ]
  for (const r of refPlan) {
    const contactId = r.contact ? (contactIdByName[r.contact] ?? null) : null
    const commission = commissionCents(program, r.amountCents)
    await db.query(
      `INSERT INTO affiliate_referrals
         (id, location_id, affiliate_id, contact_id, description, amount_cents, commission_cents, status, occurred_at, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        nanoid(),
        locId,
        r.aff,
        contactId,
        r.description,
        r.amountCents,
        commission,
        r.status,
        hoursAgoIso(r.occurredHoursAgo),
        r.paidHoursAgo === null ? null : hoursAgoIso(r.paidHoursAgo),
      ],
    )
  }

  // Calls seed (Module 52): a small honest call log so the Calls page opens onto
  // real history. Every KPI is DERIVED from these rows (call-math.ts), never
  // stored. Rows are inserted directly because the repo's create() only models a
  // freshly-placed call ('queued', no duration) — status, duration, transcript
  // and created_at come from provider webhooks in the live loop. Mixed shape on
  // purpose: a Twilio bridge call, a Vapi AI call with the mirrored transcript
  // and summary, an inbound call we never placed, and a no-answer with no
  // duration — so the stats band shows what unanswered calls really do to it.
  const callPlan: {
    contact: string | null
    direction: string
    from: string
    to: string
    status: string
    durationSeconds: number | null
    recordingUrl: string | null
    transcript: string | null
    summary: string | null
    provider: string
    externalId: string
    hoursAgo: number
  }[] = [
    {
      contact: 'Sam Smith',
      direction: 'outbound',
      from: '+14805550100',
      to: '+16025550123',
      status: 'completed',
      durationSeconds: 95,
      recordingUrl: null,
      transcript: null,
      summary: null,
      provider: 'twilio',
      externalId: 'CA_demo_marcus',
      hoursAgo: 3,
    },
    {
      contact: 'Taylor Reed',
      direction: 'outbound',
      from: '+14805550100',
      to: '+16025550177',
      status: 'completed',
      durationSeconds: 143,
      recordingUrl: 'https://storage.vapi.example/recordings/call_vapi_demo_tanya.wav',
      transcript:
        'AI: Hi Tanya, this is the assistant for Alex — Cash Offers, following up on your request about the house on 7th Street. Is now still a good time?\n' +
        'Tanya: Sure, I have a few minutes.\n' +
        'AI: Great. Alex reviewed the photos you sent and would like to walk the property before confirming an offer. Would Thursday afternoon or Friday morning work better?\n' +
        'Tanya: Friday morning works.\n' +
        'AI: Perfect — I have you down for Friday at 10am. Alex confirms every offer personally after the walkthrough, so there is nothing to sign before then.\n' +
        'Tanya: Sounds good, thank you.',
      summary:
        'Tanya confirmed a Friday 10am walkthrough for the 7th Street property. No offer amount was quoted; Alex confirms personally after the visit.',
      provider: 'vapi',
      externalId: 'call_vapi_demo_tanya',
      hoursAgo: 26,
    },
    {
      contact: 'Jordan Doe',
      direction: 'inbound',
      from: '+16025550161',
      to: '+14805550100',
      status: 'completed',
      durationSeconds: 312,
      recordingUrl: null,
      transcript: null,
      summary: null,
      provider: 'twilio',
      externalId: 'CA_demo_derek_in',
      hoursAgo: 49,
    },
    {
      contact: 'Jordan Doe',
      direction: 'outbound',
      from: '+14805550100',
      to: '+16025550161',
      status: 'no-answer',
      durationSeconds: null,
      recordingUrl: null,
      transcript: null,
      summary: null,
      provider: 'twilio',
      externalId: 'CA_demo_derek_na',
      hoursAgo: 8,
    },
  ]
  for (const call of callPlan) {
    await db.query(
      `INSERT INTO calls
         (id, location_id, contact_id, direction, from_number, to_number, status,
          duration_seconds, recording_url, transcript, summary, provider, external_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        nanoid(),
        locId,
        call.contact ? (contactIdByName[call.contact] ?? null) : null,
        call.direction,
        call.from,
        call.to,
        call.status,
        call.durationSeconds,
        call.recordingUrl,
        call.transcript,
        call.summary,
        call.provider,
        call.externalId,
        hoursAgoIso(call.hoursAgo),
      ],
    )
  }
}

// Run directly (`npm run seed`) against DATABASE_URL; import-safe for dev-server.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL required to seed')
  const { Pool } = await import('pg')
  const { PgDatabase } = await import('../server/db/database')
  const pool = new Pool({ connectionString: url })
  await seedDatabase(new PgDatabase(pool))
  console.log('openlevel: seeded demo tenant (admin@acmecorp.com / openlevel)')
  await pool.end()
}


