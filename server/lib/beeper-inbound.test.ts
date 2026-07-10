import { parseBeeperInbound } from './beeper-inbound'

const payload = {
  chatId: 'beeper!chat:abc',
  phone: '+15035550142',
  messageId: 'beeper-msg-1001',
  text: 'Yes Tuesday works for me',
  timestamp: '2026-06-19T21:30:00Z',
  senderName: 'Vanessa Wilkes',
}

test('maps an inbound beeper message to a domain event', () => {
  const e = parseBeeperInbound(payload)
  expect(e).toEqual({
    kind: 'message',
    direction: 'inbound',
    chatId: 'beeper!chat:abc',
    externalMessageId: 'beeper-msg-1001',
    body: 'Yes Tuesday works for me',
    timestamp: '2026-06-19T21:30:00Z',
    contact: { phone: '+15035550142', name: 'Vanessa Wilkes' },
  })
})

test('returns null when phone is missing (cannot match a lead, so out of scope)', () => {
  expect(parseBeeperInbound({ ...payload, phone: undefined })).toBeNull()
})

test('returns null when the message id is missing (no dedup key)', () => {
  expect(parseBeeperInbound({ ...payload, messageId: undefined })).toBeNull()
})

test('returns null for empty or whitespace-only text', () => {
  expect(parseBeeperInbound({ ...payload, text: '' })).toBeNull()
  expect(parseBeeperInbound({ ...payload, text: '   ' })).toBeNull()
})

test('trims the body and leaves sender name optional', () => {
  const e = parseBeeperInbound({ ...payload, text: '  hello  ', senderName: undefined })
  expect(e?.body).toBe('hello')
  expect(e?.contact).toEqual({ phone: '+15035550142', name: undefined })
})

test('omits timestamp when the source has none', () => {
  const e = parseBeeperInbound({ ...payload, timestamp: undefined })
  expect(e?.timestamp).toBeUndefined()
})
