import { notifyPush } from './notify-push'

test('POSTs to the gateway with the internal secret header + full body', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
  await notifyPush({ url: 'http://gw/push/send', secret: 's3cret', fetchImpl }, {
    source: 'openlevel',
    title: 'New message — Bob',
    body: 'hello',
    data: { conversationId: 'conv1', locationId: 'locJamal' },
  })
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://gw/push/send',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-internal-push-secret': 's3cret' }),
    }),
  )
  const init = fetchImpl.mock.calls[0]![1] as RequestInit
  expect(JSON.parse(String(init.body))).toEqual({
    source: 'openlevel',
    title: 'New message — Bob',
    body: 'hello',
    data: { conversationId: 'conv1', locationId: 'locJamal' },
  })
})

test('never throws when the gateway is down (fire-and-forget)', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
  await expect(
    notifyPush({ url: 'http://gw/push/send', secret: 's', fetchImpl }, {
      source: 'openlevel',
      title: 'x',
      body: 'y',
    }),
  ).resolves.toBeUndefined()
})

test('is a no-op when url or secret is unset', async () => {
  const fetchImpl = vi.fn()
  await notifyPush({ url: '', secret: '', fetchImpl }, { source: 'openlevel', title: 'x', body: 'y' })
  expect(fetchImpl).not.toHaveBeenCalled()
})
