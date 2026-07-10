import { FakeDatabase } from '../db/fake-database'
import { LocationSettingsRepo } from './location-settings-repo'

test('constructor refuses a missing locationId (tenant safety)', () => {
  const db = new FakeDatabase()
  expect(() => new LocationSettingsRepo(db, '')).toThrow(/location/i)
})

test('getAgentSettings reads the blob scoped to the location and parses it', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      settings: {
        replyMode: 'autonomous',
        agent: { enabled: true, persona: 'You are Ada.', instructions: 'Be warm.', facts: ['Open Mon-Fri.'] },
      },
    },
  ])
  const view = await new LocationSettingsRepo(db, 'locA').getAgentSettings()

  expect(view).toEqual({
    replyMode: 'autonomous',
    agent: { enabled: true, persona: 'You are Ada.', instructions: 'Be warm.', facts: ['Open Mon-Fri.'] },
  })
  // read was scoped to this location only
  expect(db.calls[0]?.params[0]).toBe('locA')
  expect(db.calls[0]?.sql).toMatch(/FROM locations/i)
})

test('getAgentSettings defaults to approve-first when nothing is configured', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  const view = await new LocationSettingsRepo(db, 'locA').getAgentSettings()
  expect(view).toEqual({ replyMode: 'approve-first', agent: {} })
})

test('getAgentSettings tolerates a null settings blob and an unknown location', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: null }])
  expect(await new LocationSettingsRepo(db, 'locA').getAgentSettings()).toEqual({
    replyMode: 'approve-first',
    agent: {},
  })
  db.enqueue([]) // no row
  expect(await new LocationSettingsRepo(db, 'locA').getAgentSettings()).toEqual({
    replyMode: 'approve-first',
    agent: {},
  })
})

test('updateAgentSettings merges replyMode at the root and agent fields under {agent}, scoped', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      settings: {
        replyMode: 'autonomous',
        agent: { persona: 'You are Ada.', enabled: true },
      },
    },
  ]) // UPDATE ... RETURNING settings
  const view = await new LocationSettingsRepo(db, 'locA').updateAgentSettings({
    replyMode: 'autonomous',
    enabled: true,
    persona: 'You are Ada.',
  })

  expect(view.replyMode).toBe('autonomous')
  expect(view.agent).toEqual({ persona: 'You are Ada.', enabled: true })

  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE locations/i)
  expect(call?.sql).toMatch(/jsonb_set/i)
  // $1 = locationId, $2 = root patch (replyMode), $3 = agent patch (everything else)
  expect(call?.params[0]).toBe('locA')
  expect(JSON.parse(call?.params[1] as string)).toEqual({ replyMode: 'autonomous' })
  expect(JSON.parse(call?.params[2] as string)).toEqual({ enabled: true, persona: 'You are Ada.' })
})

test('updateAgentSettings without replyMode leaves the root patch empty', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { agent: { persona: 'Ada' } } }])
  await new LocationSettingsRepo(db, 'locA').updateAgentSettings({ persona: 'Ada' })
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({}) // no replyMode change
  expect(JSON.parse(db.calls[0]?.params[2] as string)).toEqual({ persona: 'Ada' })
})

test('updateAgentSettings replaces the whole facts array (full set, not append)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { agent: { facts: ['a', 'b'] } } }])
  await new LocationSettingsRepo(db, 'locA').updateAgentSettings({ facts: ['a', 'b'] })
  expect(JSON.parse(db.calls[0]?.params[2] as string)).toEqual({ facts: ['a', 'b'] })
})

test('getSocialSettings parses the channel ids and nulls what is unset', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    {
      settings: {
        social: { facebookPageId: '1234', linkedinAuthorUrn: 'urn:li:organization:55', googleAccountId: 'acc1' },
      },
    },
  ])
  const view = await new LocationSettingsRepo(db, 'locA').getSocialSettings()
  expect(view).toEqual({
    facebookPageId: '1234',
    instagramUserId: null,
    linkedinAuthorUrn: 'urn:li:organization:55',
    googleAccountId: 'acc1',
    googleLocationId: null,
  })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('getSocialSettings tolerates a fresh location (all nulls)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  expect(await new LocationSettingsRepo(db, 'locA').getSocialSettings()).toEqual({
    facebookPageId: null,
    instagramUserId: null,
    linkedinAuthorUrn: null,
    googleAccountId: null,
    googleLocationId: null,
  })
})

test('updateSocialSettings merges atomically under {social}, scoped, ids only', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { facebookPageId: '1234', instagramUserId: '178414' } } }]) // RETURNING
  const view = await new LocationSettingsRepo(db, 'locA').updateSocialSettings({
    facebookPageId: '1234',
    instagramUserId: '178414',
  })
  expect(view).toEqual({
    facebookPageId: '1234',
    instagramUserId: '178414',
    linkedinAuthorUrn: null,
    googleAccountId: null,
    googleLocationId: null,
  })

  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE locations/i)
  expect(call?.sql).toMatch(/jsonb_set/i)
  expect(call?.sql).toMatch(/\{social\}/)
  expect(call?.params[0]).toBe('locA')
  expect(JSON.parse(call?.params[1] as string)).toEqual({ facebookPageId: '1234', instagramUserId: '178414' })
})

test('updateSocialSettings can clear an id with null and skips untouched fields', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { facebookPageId: null } } }])
  await new LocationSettingsRepo(db, 'locA').updateSocialSettings({ facebookPageId: null })
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ facebookPageId: null })
})

test('updateSocialSettings persists the Google Business ids (Module 51)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { social: { googleAccountId: 'acc1', googleLocationId: 'gloc9' } } }])
  const view = await new LocationSettingsRepo(db, 'locA').updateSocialSettings({
    googleAccountId: 'acc1',
    googleLocationId: 'gloc9',
  })
  expect(view.googleAccountId).toBe('acc1')
  expect(view.googleLocationId).toBe('gloc9')
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({
    googleAccountId: 'acc1',
    googleLocationId: 'gloc9',
  })
})

test('getVoiceSettings parses the provider + numbers/ids and nulls what is unset (Module 52)', async () => {
  const db = new FakeDatabase()
  db.enqueue([
    { settings: { voice: { provider: 'twilio', fromNumber: '+14805550111', operatorNumber: '+14809802287' } } },
  ])
  const view = await new LocationSettingsRepo(db, 'locA').getVoiceSettings()
  expect(view).toEqual({
    provider: 'twilio',
    fromNumber: '+14805550111',
    operatorNumber: '+14809802287',
    vapiAssistantId: null,
    vapiPhoneNumberId: null,
  })
  expect(db.calls[0]?.params[0]).toBe('locA')
})

test('getVoiceSettings tolerates a fresh location (provider none, all nulls)', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: {} }])
  expect(await new LocationSettingsRepo(db, 'locA').getVoiceSettings()).toEqual({
    provider: 'none',
    fromNumber: null,
    operatorNumber: null,
    vapiAssistantId: null,
    vapiPhoneNumberId: null,
  })
})

test('updateVoiceSettings merges atomically under {voice}, scoped, numbers/ids only', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { voice: { provider: 'vapi', vapiAssistantId: 'asst_42', vapiPhoneNumberId: 'pn_7' } } }])
  const view = await new LocationSettingsRepo(db, 'locA').updateVoiceSettings({
    provider: 'vapi',
    vapiAssistantId: 'asst_42',
    vapiPhoneNumberId: 'pn_7',
  })
  expect(view.provider).toBe('vapi')
  expect(view.vapiAssistantId).toBe('asst_42')

  const call = db.calls[0]
  expect(call?.sql).toMatch(/UPDATE locations/i)
  expect(call?.sql).toMatch(/jsonb_set/i)
  expect(call?.sql).toMatch(/\{voice\}/)
  expect(call?.params[0]).toBe('locA')
  expect(JSON.parse(call?.params[1] as string)).toEqual({
    provider: 'vapi',
    vapiAssistantId: 'asst_42',
    vapiPhoneNumberId: 'pn_7',
  })
})

test('updateVoiceSettings can clear a number with null and skips untouched fields', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ settings: { voice: { fromNumber: null } } }])
  await new LocationSettingsRepo(db, 'locA').updateVoiceSettings({ fromNumber: null })
  expect(JSON.parse(db.calls[0]?.params[1] as string)).toEqual({ fromNumber: null })
})
