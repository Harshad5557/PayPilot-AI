import assert from 'node:assert/strict'
import { after, test } from 'node:test'

const previousClientId = process.env.PAYPAL_CLIENT_ID
const previousClientSecret = process.env.PAYPAL_CLIENT_SECRET
process.env.PAYPAL_CLIENT_ID = 'paypal-provider-test-client'
process.env.PAYPAL_CLIENT_SECRET = 'paypal-provider-test-secret'

const { clearPayPalTokenCacheForTests, createPayPalOrder } = await import('./paypal.provider.js')
const originalFetch = globalThis.fetch

after(() => {
  clearPayPalTokenCacheForTests()
  globalThis.fetch = originalFetch
  if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID
  else process.env.PAYPAL_CLIENT_ID = previousClientId
  if (previousClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET
  else process.env.PAYPAL_CLIENT_SECRET = previousClientSecret
})

test('create order requests representation and preserves authorization and request ID headers', async () => {
  const requests: { url: string; headers: Headers }[] = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    requests.push({ url, headers })
    if (url.endsWith('/v1/oauth2/token')) {
      return new Response(
        JSON.stringify({ access_token: 'paypal-provider-test-token', expires_in: 300 }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        id: 'ORDER-TEST',
        intent: 'CAPTURE',
        status: 'CREATED',
        purchase_units: [
          {
            reference_id: 'attempt-test',
            custom_id: 'attempt-test',
            amount: { currency_code: 'USD', value: '12.34' },
          },
        ],
      }),
      { status: 201 },
    )
  }

  const response = await createPayPalOrder({
    attemptId: 'attempt-test',
    requestId: 'request-test',
    totalAmount: 1234,
    currency: 'USD',
  })

  assert.ok(response && typeof response === 'object' && 'id' in response)
  assert.equal(response.id, 'ORDER-TEST')
  const createRequest = requests.find(({ url }) => url.endsWith('/v2/checkout/orders'))
  assert.ok(createRequest)
  assert.equal(createRequest.headers.get('prefer'), 'return=representation')
  assert.equal(createRequest.headers.get('authorization'), 'Bearer paypal-provider-test-token')
  assert.equal(createRequest.headers.get('paypal-request-id'), 'request-test')
})
