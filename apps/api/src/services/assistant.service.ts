import { HttpError } from '../errors/http-error.js'
import { findRelevantInvoicesForAssistant } from '../repositories/assistant.repository.js'
import {
  generateAssistantContent,
  type AssistantContentGenerator,
  type AssistantInvoice,
} from './gemini-assistant.provider.js'
import {
  assistantResponseSchema,
  type AssistantResponse,
} from '../validation/assistant.validation.js'

const REQUEST_TIMEOUT_MS = 12_000
const MAX_MODEL_RESPONSE_CHARS = 8_000

export interface AssistantMessageResponse extends AssistantResponse {
  source: 'gemini' | 'fallback'
  notice?: string
}

interface AssistantServiceDependencies {
  findInvoices: (
    ownerId: string,
    message: string,
  ) => Promise<AssistantInvoice[]>
  generate: AssistantContentGenerator
}

const defaultDependencies: AssistantServiceDependencies = {
  findInvoices: findRelevantInvoicesForAssistant,
  generate: generateAssistantContent,
}

function fallbackResponse(
  invoiceCount: number,
  reason: 'AI_NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'NO_RELEVANT_INVOICES',
): AssistantMessageResponse {
  const noInvoices = reason === 'NO_RELEVANT_INVOICES'
  return {
    intent: noInvoices ? 'invoice_lookup' : 'assistant_unavailable',
    summary: noInvoices
      ? 'I could not find matching invoice records in this demo workspace.'
      : `AI analysis is unavailable. There ${invoiceCount === 1 ? 'is' : 'are'} ${invoiceCount} relevant invoice record${invoiceCount === 1 ? '' : 's'} available to review in the invoice list.`,
    recommendations: [],
    requiresClarification: true,
    clarificationQuestion: noInvoices
      ? 'Which invoice, supplier, or due date would you like me to look up?'
      : 'Would you like to review overdue invoices or upcoming due dates?',
    source: 'fallback',
    notice: reason,
  }
}

function providerStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  const providerError = error as {
    status?: unknown
    statusCode?: unknown
    code?: unknown
    message?: unknown
  }
  const status = Number(providerError.status ?? providerError.statusCode)
  if (Number.isInteger(status)) return status

  const code = String(providerError.code ?? '').toUpperCase()
  const message = String(providerError.message ?? '').toLowerCase()
  if (
    code.includes('RESOURCE_EXHAUSTED') ||
    code.includes('RATE_LIMIT') ||
    message.includes('too many requests')
  ) {
    return 429
  }
  if (
    code.includes('UNAVAILABLE') ||
    code.includes('DEADLINE_EXCEEDED') ||
    code.includes('INTERNAL') ||
    message.includes('fetch failed')
  ) {
    return 503
  }
  return undefined
}

function parseModelResponse(
  output: string | undefined,
  invoices: AssistantInvoice[],
): AssistantResponse {
  if (!output || output.length > MAX_MODEL_RESPONSE_CHARS) {
    throw new HttpError(
      'The assistant returned an empty or oversized response.',
      502,
      'INVALID_MODEL_OUTPUT',
    )
  }

  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new HttpError(
      'The assistant returned invalid JSON.',
      502,
      'INVALID_MODEL_OUTPUT',
    )
  }

  const parsed = assistantResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new HttpError(
      'The assistant response did not match the required format.',
      502,
      'INVALID_MODEL_OUTPUT',
    )
  }

  const responseText = [
    parsed.data.summary,
    ...parsed.data.recommendations.map(({ text }) => text),
  ].join('\n')
  const claimsPaymentOutcome =
    /\bpayment\b.{0,80}\b(?:went through|succeeded|successful|completed|complete|processed|cleared|paid)\b/i.test(responseText) ||
    /\b(?:i|we)\s+(?:have\s+)?(?:paid|approved|updated|modified|changed|deleted)\b/i.test(responseText) ||
    /\b(?:invoice|record|database|payment plan)\b.{0,50}\b(?:was|has been|is)\s+(?:updated|modified|changed|deleted|approved)\b/i.test(responseText)
  if (claimsPaymentOutcome) {
    throw new HttpError(
      'The assistant response contained an unsupported action or payment claim.',
      502,
      'UNSAFE_MODEL_OUTPUT',
    )
  }

  const knownInvoiceIds = new Set(invoices.map(({ id }) => id))
  const unknownInvoiceId = parsed.data.recommendations
    .flatMap(({ invoiceIds }) => invoiceIds)
    .find((id) => !knownInvoiceIds.has(id))
  if (unknownInvoiceId) {
    throw new HttpError(
      'The assistant referenced an invoice that is not available in your workspace.',
      502,
      'INVALID_INVOICE_REFERENCE',
    )
  }
  return parsed.data
}

export async function sendAssistantMessage(
  ownerId: string,
  message: string,
  dependencies = defaultDependencies,
): Promise<AssistantMessageResponse> {
  const invoices = await dependencies.findInvoices(ownerId, message)
  if (invoices.length === 0) {
    return fallbackResponse(0, 'NO_RELEVANT_INVOICES')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const output = await dependencies.generate({
      message,
      invoices,
      signal: controller.signal,
    })
    return {
      ...parseModelResponse(output, invoices),
      source: 'gemini',
    }
  } catch (error) {
    if (error instanceof HttpError) throw error

    const status = providerStatus(error)
    if (status === 429) {
      throw new HttpError(
        'The AI assistant is rate limited. Please try again shortly.',
        429,
        'AI_RATE_LIMITED',
      )
    }
    if (controller.signal.aborted) {
      return fallbackResponse(invoices.length, 'PROVIDER_TIMEOUT')
    }
    if (status !== undefined && status >= 500) {
      return fallbackResponse(invoices.length, 'PROVIDER_UNAVAILABLE')
    }
    if (error instanceof Error && error.message === 'Gemini is not configured.') {
      return fallbackResponse(invoices.length, 'AI_NOT_CONFIGURED')
    }
    throw new HttpError(
      'The AI provider request failed. Please try again later.',
      503,
      'AI_PROVIDER_FAILED',
    )
  } finally {
    clearTimeout(timeout)
  }
}
