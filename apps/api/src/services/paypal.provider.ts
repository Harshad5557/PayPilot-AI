import { env } from '../config/env.js'
import { minorUnitsToAmount } from './money.js'

const PAYPAL_API = 'https://api-m.sandbox.paypal.com'
const REQUEST_TIMEOUT_MS = 10_000

export type PayPalFailureCertainty = 'definite' | 'ambiguous'

export class PayPalProviderError extends Error {
  constructor(
    message: string,
    public readonly certainty: PayPalFailureCertainty,
    public readonly providerCode?: string,
  ) {
    super(message)
    this.name = 'PayPalProviderError'
  }
}

export interface PayPalOrderInput {
  attemptId: string
  requestId: string
  totalAmount: number
  currency: string
}

export interface PayPalCaptureInput {
  orderId: string
  requestId: string
}

let cachedAccessToken: { value: string; expiresAt: number } | undefined

function safeProviderCode(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('name' in payload)) return undefined
  if ('details' in payload && Array.isArray(payload.details)) {
    for (const detail of payload.details) {
      if (!detail || typeof detail !== 'object' || !('issue' in detail)) continue
      const issue = (detail as { issue?: unknown }).issue
      if (typeof issue === 'string' && /^[A-Z0-9_]{1,80}$/.test(issue)) return issue
    }
  }
  const name = (payload as { name?: unknown }).name
  if (typeof name !== 'string') return undefined
  return /^[A-Z0-9_]{1,80}$/.test(name) ? name : undefined
}

async function requestJson<T>(
  path: string,
  options: {
    method: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
    authorization?: string
    requestId?: string
  },
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${PAYPAL_API}${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.authorization ? { Authorization: options.authorization } : {}),
        ...(options.headers ?? {}),
        ...(options.requestId ? { 'PayPal-Request-Id': options.requestId } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) as unknown : undefined
    } catch {
      throw new PayPalProviderError(
        'PayPal returned an invalid response.',
        'ambiguous',
      )
    }
    if (!response.ok) {
      throw new PayPalProviderError(
        'PayPal could not complete the request.',
        response.status >= 500 || response.status === 429 ? 'ambiguous' : 'definite',
        safeProviderCode(payload),
      )
    }
    return payload as T
  } catch (error) {
    if (error instanceof PayPalProviderError) throw error
    throw new PayPalProviderError(
      controller.signal.aborted
        ? 'PayPal request timed out.'
        : 'PayPal could not be reached.',
      'ambiguous',
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function getAccessToken() {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new PayPalProviderError('PayPal Sandbox is not configured.', 'definite')
  }
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.value
  }

  const credentials = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64')
  const response = await requestJson<{
    access_token?: unknown
    expires_in?: unknown
  }>('/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (
    typeof response.access_token !== 'string' ||
    typeof response.expires_in !== 'number' ||
    response.expires_in <= 0
  ) {
    cachedAccessToken = undefined
    throw new PayPalProviderError(
      'PayPal returned an invalid access token response.',
      'definite',
    )
  }
  cachedAccessToken = {
    value: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  }
  return response.access_token
}

export function clearPayPalTokenCacheForTests() {
  cachedAccessToken = undefined
}

export async function createPayPalOrder(input: PayPalOrderInput) {
  const accessToken = await getAccessToken()
  return requestJson<unknown>('/v2/checkout/orders', {
    method: 'POST',
    authorization: `Bearer ${accessToken}`,
    requestId: input.requestId,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: input.attemptId,
        custom_id: input.attemptId,
        amount: {
          currency_code: input.currency,
          value: minorUnitsToAmount(input.totalAmount, input.currency),
        },
      }],
    }),
  })
}

export async function capturePayPalOrder(input: PayPalCaptureInput) {
  const accessToken = await getAccessToken()
  return requestJson<unknown>(
    `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
    {
      method: 'POST',
      authorization: `Bearer ${accessToken}`,
      requestId: input.requestId,
      body: '{}',
    },
  )
}

export async function getPayPalOrder(orderId: string) {
  const accessToken = await getAccessToken()
  return requestJson<unknown>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: 'GET',
      authorization: `Bearer ${accessToken}`,
    },
  )
}

export function getPayPalSandboxConfiguration() {
  return {
    environment: 'sandbox' as const,
    configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
    clientId: env.PAYPAL_CLIENT_ID ?? null,
  }
}
