import { sendChatwootMessage } from './chatwoot-client'

test('posts to the conversations messages endpoint with the api token', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ id: 12345 }), { status: 200 })
  }) as unknown as typeof fetch

  const out = await sendChatwootMessage(
    { baseUrl: 'https://chat.example.com', accountId: '1', conversationId: '55', token: 'tok', content: 'hello' },
    fakeFetch,
  )

  expect(out.externalId).toBe('12345')
  expect(calls[0]?.url).toBe('https://chat.example.com/api/v1/accounts/1/conversations/55/messages')
  const headers = calls[0]?.init.headers as Record<string, string>
  expect(headers.api_access_token).toBe('tok')
  expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ content: 'hello', message_type: 'outgoing' })
})

test('throws on non-2xx', async () => {
  const fakeFetch = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
  await expect(
    sendChatwootMessage({ baseUrl: 'b', accountId: '1', conversationId: '2', token: 't', content: 'x' }, fakeFetch),
  ).rejects.toThrow(/401/)
})
