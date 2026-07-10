import { parseChatwootEvent } from './chatwoot-inbound'

const payload = {
  event: 'message_created',
  message_type: 'incoming',
  content: 'hi',
  id: 991,
  conversation: { id: 55 },
  inbox: { id: 7 },
  sender: { name: 'Bob', phone_number: '+15035550199', email: null },
}

test('maps incoming message to domain event', () => {
  const e = parseChatwootEvent(payload)
  expect(e).toEqual({
    kind: 'message',
    direction: 'inbound',
    inboxId: '7',
    externalMessageId: '991',
    externalConversationId: '55',
    body: 'hi',
    contact: { name: 'Bob', phone: '+15035550199', email: undefined },
  })
})

test('ignores non-message events', () => {
  expect(parseChatwootEvent({ event: 'conversation_status_changed' })).toBeNull()
})

test('ignores outgoing messages to avoid echo loops', () => {
  expect(parseChatwootEvent({ ...payload, message_type: 'outgoing' })).toBeNull()
})

test('falls back to conversation.inbox_id when inbox is absent', () => {
  const e = parseChatwootEvent({ ...payload, inbox: undefined, conversation: { id: 55, inbox_id: 9 } })
  expect(e?.inboxId).toBe('9')
})
