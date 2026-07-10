import {
  OPENLEVEL_CARD,
  encodeActionRef,
  decodeActionRef,
  federationTurnSchema,
  federationConfirmSchema,
} from './federation-types'

test('OPENLEVEL_CARD names the app and enumerates read + the five write capabilities, all confirm-gated', () => {
  expect(OPENLEVEL_CARD.app).toBe('openlevel')
  const ids = OPENLEVEL_CARD.capabilities.map((c) => c.id)
  expect(ids).toContain('openlevel.crm.read')
  // the read capability is non-approval; every action is confirm-card
  const read = OPENLEVEL_CARD.capabilities.find((c) => c.id === 'openlevel.crm.read')!
  expect(read.approve).toBe('none')
  const actions = OPENLEVEL_CARD.capabilities.filter((c) => c.kind === 'action')
  expect(actions).toHaveLength(5)
  expect(actions.every((c) => c.approve === 'confirm-card')).toBe(true)
  // user-facing copy carries no em-dash
  expect(OPENLEVEL_CARD.capabilities.every((c) => !c.summary.includes('—'))).toBe(true)
})

test('encodeActionRef/decodeActionRef round-trips verb + params', () => {
  const action = { verb: 'book_appointment', params: { contactId: 'c1', start: '2026-06-20T17:00:00Z' } }
  const ref = encodeActionRef(action)
  expect(typeof ref).toBe('string')
  expect(decodeActionRef(ref)).toEqual(action)
})

test('decodeActionRef rejects a foreign / malformed ref as null', () => {
  expect(decodeActionRef('portal:draft:abc')).toBeNull() // not one of ours
  expect(decodeActionRef('ol:not-base64!!')).toBeNull()
  expect(decodeActionRef('ol:' + Buffer.from('{"params":{}}', 'utf8').toString('base64url'))).toBeNull() // no verb
  expect(decodeActionRef(42 as unknown)).toBeNull()
})

test('federationTurnSchema requires a non-empty message; threadRef optional', () => {
  expect(federationTurnSchema.safeParse({ message: 'hi' }).success).toBe(true)
  expect(federationTurnSchema.safeParse({ message: 'hi', threadRef: 't1' }).success).toBe(true)
  expect(federationTurnSchema.safeParse({ message: '' }).success).toBe(false)
  expect(federationTurnSchema.safeParse({}).success).toBe(false)
})

test('federationConfirmSchema accepts BOTH a proposalRef and a verb+params', () => {
  expect(federationConfirmSchema.safeParse({ proposalRef: 'ol:abc' }).success).toBe(true)
  expect(federationConfirmSchema.safeParse({ verb: 'tag_contact', params: { contactId: 'c1', tag: 'vip' } }).success).toBe(true)
  expect(federationConfirmSchema.safeParse({ verb: 'tag_contact' }).success).toBe(true) // params defaults to {}
  expect(federationConfirmSchema.safeParse({}).success).toBe(false)
})
