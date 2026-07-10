import { describe, expect, it, vi } from 'vitest'
import { FakeDatabase } from '../../db/fake-database'
import type { Campaign } from '../../repos/campaigns-repo'
import type { Contact } from '../../repos/contacts-repo'
import { sendCampaign } from './campaign-send'
import type { EmailSender, SmsSender } from './provider'

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 'cmp1',
    location_id: 'locA',
    name: 'June blast',
    channel: 'email',
    subject: 'Your cash offer',
    body: 'Hi {{first_name}}, offer inside.',
    audience_tag: null,
    status: 'draft',
    recipient_count: 0,
    sent_count: 0,
    created_at: '',
    updated_at: '',
    sent_at: null,
    ...over,
  }
}

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    location_id: 'locA',
    name: 'Derek Sull',
    first_name: 'Derek',
    last_name: 'Sull',
    phones: ['+16025550123'],
    emails: ['derek@example.com'],
    tags: [],
    custom_fields: {},
    source: null,
    external_ids: {},
    match_key: null,
    created_at: '',
    updated_at: '',
    archived_at: null,
    state: null,
    ...over,
  }
}

function emailSender() {
  return {
    name: 'brevo',
    sendEmail: vi.fn<EmailSender['sendEmail']>(async () => ({ externalId: 'm1', provider: 'brevo' })),
  }
}

function smsSender() {
  return {
    name: 'twilio',
    sendSms: vi.fn<SmsSender['sendSms']>(async () => ({ externalId: 's1', provider: 'twilio' })),
  }
}

function deps(senders: { email?: EmailSender; sms?: SmsSender } = {}, throttleMs = 0) {
  return {
    db: new FakeDatabase(),
    resolveEmail: vi.fn(async () =>
      senders.email
        ? { ok: true as const, sender: senders.email }
        : { ok: false as const, reason: 'no email provider connected' },
    ),
    resolveSms: vi.fn(async () =>
      senders.sms
        ? { ok: true as const, sender: senders.sms }
        : { ok: false as const, reason: 'no sms provider connected' },
    ),
    throttleMs,
    sleep: vi.fn(async () => {}),
  }
}

describe('sendCampaign: provider gate', () => {
  it('refuses the whole blast with the resolver reason when nothing is connected', async () => {
    const d = deps()
    const result = await sendCampaign(d, { locationId: 'locA', campaign: campaign(), contacts: [contact()] })
    expect(result).toEqual({ ok: false, reason: 'no email provider connected' })
  })

  it('refuses an sms campaign with the sms reason', async () => {
    const d = deps()
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign({ channel: 'sms' }),
      contacts: [contact()],
    })
    expect(result).toEqual({ ok: false, reason: 'no sms provider connected' })
  })
})

describe('sendCampaign: email fan-out', () => {
  it('personalizes body + subject per contact and counts each delivered send', async () => {
    const email = emailSender()
    const d = deps({ email })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign({ subject: 'Offer for {{first_name}}' }),
      contacts: [contact(), contact({ id: 'c2', first_name: 'Mia', name: 'Mia Ortiz', emails: ['mia@example.com'] })],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(email.sendEmail).toHaveBeenCalledTimes(2)
    expect(email.sendEmail.mock.calls[0]?.[0]).toEqual({
      to: 'derek@example.com',
      toName: 'Derek Sull',
      subject: 'Offer for Derek',
      text: 'Hi Derek, offer inside.',
    })
    expect(result.outcomes).toEqual([
      { contactId: 'c1', status: 'sent', detail: null },
      { contactId: 'c2', status: 'sent', detail: null },
    ])
    expect(result.sentCount).toBe(2)
  })

  it('falls back to the campaign name when there is no subject and renders custom values', async () => {
    const email = emailSender()
    const d = deps({ email })
    await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign({ subject: null, body: 'From {{custom_values.business_name}}' }),
      contacts: [contact()],
      customValues: { business_name: 'Jamal Cash Offers' },
    })
    expect(email.sendEmail.mock.calls[0]?.[0]).toMatchObject({
      subject: 'June blast',
      text: 'From Jamal Cash Offers',
    })
  })

  it('skips a contact with no email address and keeps going', async () => {
    const email = emailSender()
    const d = deps({ email })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign(),
      contacts: [contact({ id: 'c1', emails: [] }), contact({ id: 'c2' })],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      { contactId: 'c1', status: 'skipped', detail: 'no email address' },
      { contactId: 'c2', status: 'sent', detail: null },
    ])
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('sendCampaign: sms fan-out', () => {
  it('routes an sms campaign through the sms sender with the first phone', async () => {
    const sms = smsSender()
    const d = deps({ sms })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign({ channel: 'sms', body: 'Hi {{first_name}}' }),
      contacts: [contact()],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(sms.sendSms).toHaveBeenCalledWith({ to: '+16025550123', body: 'Hi Derek' })
    expect(result.sentCount).toBe(1)
  })

  it('skips a contact with no phone number', async () => {
    const sms = smsSender()
    const d = deps({ sms })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign({ channel: 'sms' }),
      contacts: [contact({ phones: [] })],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([{ contactId: 'c1', status: 'skipped', detail: 'no phone number' }])
    expect(sms.sendSms).not.toHaveBeenCalled()
  })
})

describe('sendCampaign: suppression', () => {
  it('never sends to a contact tagged unsubscribed or dnd (case-insensitive)', async () => {
    const email = emailSender()
    const d = deps({ email })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign(),
      contacts: [
        contact({ id: 'c1', tags: ['seller', 'Unsubscribed'] }),
        contact({ id: 'c2', tags: ['DND'] }),
        contact({ id: 'c3' }),
      ],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      { contactId: 'c1', status: 'skipped', detail: 'unsubscribed' },
      { contactId: 'c2', status: 'skipped', detail: 'dnd' },
      { contactId: 'c3', status: 'sent', detail: null },
    ])
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('sendCampaign: failure isolation + throttle', () => {
  it('marks one provider failure failed and still sends the rest', async () => {
    const email = emailSender()
    email.sendEmail.mockRejectedValueOnce(new Error('brevo send failed: 500'))
    const d = deps({ email })
    const result = await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign(),
      contacts: [contact({ id: 'c1' }), contact({ id: 'c2', emails: ['mia@example.com'] })],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.outcomes).toEqual([
      { contactId: 'c1', status: 'failed', detail: 'brevo send failed: 500' },
      { contactId: 'c2', status: 'sent', detail: null },
    ])
    expect(result.sentCount).toBe(1)
  })

  it('pauses between provider calls but not before the first or around skips', async () => {
    const email = emailSender()
    const d = deps({ email }, 250)
    await sendCampaign(d, {
      locationId: 'locA',
      campaign: campaign(),
      contacts: [
        contact({ id: 'c1' }),
        contact({ id: 'c2', emails: [] }), // skip — no API call, no pause
        contact({ id: 'c3', emails: ['x@example.com'] }),
        contact({ id: 'c4', emails: ['y@example.com'] }),
      ],
    })
    expect(d.sleep).toHaveBeenCalledTimes(2)
    expect(d.sleep).toHaveBeenCalledWith(250)
  })
})
