/**
 * Outbound Chatwoot adapter. fetch is injected (defaults to global) so the
 * adapter is unit-testable without network. Non-2xx throws so the caller can
 * mark the outbound message failed.
 */

export interface ChatwootSendParams {
  baseUrl: string
  accountId: string
  conversationId: string
  token: string
  content: string
}

export async function sendChatwootMessage(
  params: ChatwootSendParams,
  fetchImpl: typeof fetch = fetch,
): Promise<{ externalId: string }> {
  const url = `${params.baseUrl}/api/v1/accounts/${params.accountId}/conversations/${params.conversationId}/messages`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      api_access_token: params.token,
    },
    body: JSON.stringify({ content: params.content, message_type: 'outgoing' }),
  })
  if (!res.ok) throw new Error(`chatwoot send failed: ${res.status}`)
  const data = (await res.json()) as { id?: number | string }
  return { externalId: String(data.id ?? '') }
}
