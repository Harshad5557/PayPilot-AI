import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import {
  InvoiceStatus,
  PaymentAttemptStatus,
  PaymentPlanStatus,
} from './generated/prisma/client.js'
import { app } from './app.js'
import { prisma } from './database/prisma.js'
import { HttpError } from './errors/http-error.js'
import { PayPalProviderError } from './services/paypal.provider.js'
import {
  approvePaymentPlan,
  createPaymentPlan,
} from './services/payment-plans.service.js'
import {
  capturePayPalAttempt,
  createApprovedPayPalOrder,
  getPaymentAttempt,
  recoverAmbiguousPayPalOrder,
  reconcilePayPalAttempt,
  type PayPalPaymentProvider,
} from './services/paypal-payments.service.js'
import { createInvoice } from './repositories/invoices.repository.js'
import {
  paypalOrderResponseSchema,
  paypalRetrievedOrderSchema,
} from './validation/paypal.validation.js'

const ownerEmail = 'owner@northstar-studio.example.test'
const server = app.listen(0)
await once(server, 'listening')

let ownerId = ''
const invoiceIds: string[] = []
const planIds: string[] = []
const attemptIds: string[] = []
let testStartedAt: Date

before(async () => {
  testStartedAt = new Date()
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      id: 'seed_northstar_studio_owner',
      email: ownerEmail,
      name: 'Northstar Studio (Demo)',
    },
  })
  ownerId = owner.id
})

after(async () => {
  await prisma.auditEvent.deleteMany({
    where: {
      ownerId,
      entityType: { in: ['PaymentAttempt', 'PaymentPlan'] },
      createdAt: { gte: testStartedAt },
    },
  })
  await prisma.paymentAttemptInvoice.deleteMany({
    where: { paymentAttemptId: { in: attemptIds } },
  })
  await prisma.paymentAttempt.deleteMany({ where: { id: { in: attemptIds } } })
  await prisma.paymentPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } })
  server.close()
  await once(server, 'close')
  await prisma.$disconnect()
})

async function request(path: string, init?: RequestInit) {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return fetch(`http://127.0.0.1:${address.port}${path}`, init)
}

async function createInvoiceForPayment(owner = ownerId) {
  const invoice = await createInvoice({
    id: `paypal-test-${randomUUID()}`,
    ownerId: owner,
    title: 'DEMO - PayPal sandbox test invoice',
    counterparty: 'Fictional Sandbox Supplier',
    amount: 12345,
    currency: 'USD',
    dueDate: new Date('2026-12-01T00:00:00.000Z'),
    status: InvoiceStatus.PENDING,
  })
  invoiceIds.push(invoice.id)
  return invoice
}

async function createApprovedPlan() {
  const invoice = await createInvoiceForPayment()
  const plan = await createPaymentPlan(ownerId, [invoice.id])
  planIds.push(plan.id)
  await approvePaymentPlan(ownerId, plan.id, {
    proposalVersion: plan.proposalVersion,
    totalAmount: plan.totalAmount,
    currency: plan.currency,
    confirm: true,
  })
  return { invoice, plan }
}

function orderResponse(input: { attemptId: string; currency: string; totalAmount: number }) {
  return {
    id: `ORDER-${randomUUID()}`,
    intent: 'CAPTURE',
    status: 'CREATED',
    purchase_units: [{
      reference_id: input.attemptId,
      custom_id: input.attemptId,
      amount: {
        currency_code: input.currency,
        value: (input.totalAmount / 100).toFixed(2),
        breakdown: {
          item_total: {
            currency_code: input.currency,
            value: (input.totalAmount / 100).toFixed(2),
          },
        },
      },
    }],
  }
}

function completedCapture(
  orderId: string,
  attemptId: string,
  amountMinor = 12345,
  currency = 'USD',
) {
  const value = (amountMinor / 100).toFixed(2)
  return {
    id: orderId,
    intent: 'CAPTURE',
    status: 'COMPLETED',
    purchase_units: [{
      reference_id: attemptId,
      custom_id: attemptId,
      amount: { currency_code: currency, value },
      payments: {
        captures: [{
          id: `CAPTURE-${randomUUID()}`,
          status: 'COMPLETED',
          amount: { currency_code: currency, value },
        }],
      },
    }],
  }
}

function pendingCapture(orderId: string, attemptId: string) {
  return {
    id: orderId,
    intent: 'CAPTURE',
    status: 'PENDING',
    purchase_units: [{
      reference_id: attemptId,
      custom_id: attemptId,
      amount: { currency_code: 'USD', value: '123.45' },
      payments: {
        captures: [{
          id: `CAPTURE-PENDING-${randomUUID()}`,
          status: 'PENDING',
          amount: { currency_code: 'USD', value: '123.45' },
        }],
      },
    }],
  }
}

function retrievedOrder(
  input: { orderId: string; attemptId: string; currency: string; totalAmount: number },
  status: string = 'CREATED',
) {
  return {
    ...orderResponse(input),
    id: input.orderId,
    status,
  }
}

async function createAmbiguousAttempt() {
  const { plan } = await createApprovedPlan()
  const orderId = `ORDER-CANDIDATE-${randomUUID()}`
  let createCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async () => {
      createCalls += 1
      return { id: orderId, status: 'CREATED', links: [] }
    },
    captureOrder: async () => ({}),
  }
  let attemptId: string | undefined
  await assert.rejects(
    () =>
      createApprovedPayPalOrder(
        ownerId,
        plan.id,
        plan.proposalVersion,
        provider,
        true,
      ),
    (error: unknown) => {
      if (!(error instanceof HttpError) || error.code !== 'PAYPAL_UNEXPECTED_RESPONSE') {
        return false
      }
      attemptId = error.meta?.paymentAttemptId
      return Boolean(attemptId)
    },
  )
  assert.ok(attemptId)
  attemptIds.push(attemptId)
  return { attemptId, orderId, plan, provider, getCreateCalls: () => createCalls }
}

test('PayPal Sandbox configuration endpoint exposes only the public client ID', async () => {
  const response = await request('/api/payments/config')
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.data.environment, 'sandbox')
  assert.equal(typeof payload.data.configured, 'boolean')
  assert.equal('clientSecret' in payload.data, false)
})

test('PayPal order schemas distinguish create responses from retrieved orders', () => {
  const response = orderResponse({
    attemptId: 'attempt-test',
    currency: 'USD',
    totalAmount: 12345,
  })
  assert.equal(paypalOrderResponseSchema.safeParse(response).success, true)
  assert.equal(
    paypalOrderResponseSchema.safeParse({
      id: response.id,
      intent: 'CAPTURE',
      status: 'CREATED',
    }).success,
    false,
  )
  assert.equal(
    paypalRetrievedOrderSchema.safeParse(
      retrievedOrder(
        {
          orderId: response.id,
          attemptId: 'attempt-test',
          currency: 'USD',
          totalAmount: 12345,
        },
        'APPROVED',
      ),
    ).success,
    true,
  )
})

test('order creation requires approval and ignores browser-supplied amounts', async () => {
  const invoice = await createInvoiceForPayment()
  const plan = await createPaymentPlan(ownerId, [invoice.id])
  planIds.push(plan.id)
  let calls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => {
      calls += 1
      return orderResponse(input)
    },
    captureOrder: async () => ({}),
  }
  await assert.rejects(
    () => createApprovedPayPalOrder(
      ownerId,
      plan.id,
      plan.proposalVersion,
      provider,
      true,
    ),
    (error: unknown) => error instanceof HttpError && error.code === 'APPROVAL_REQUIRED',
  )
  assert.equal(calls, 0)

  const tampered = await request(`/api/payment-plans/${plan.id}/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      proposalVersion: plan.proposalVersion,
      totalAmount: 1,
      currency: 'USD',
    }),
  })
  assert.equal(tampered.status, 400)
})

test('order creation is idempotent and stores provider order plus invoice allocations', async () => {
  const { plan, invoice } = await createApprovedPlan()
  let calls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => {
      calls += 1
      return orderResponse(input)
    },
    captureOrder: async () => ({}),
  }
  const first = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(first.id)
  const replay = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  assert.equal(calls, 1)
  assert.equal(replay.id, first.id)
  assert.equal(replay.paypalOrderId, first.paypalOrderId)
  assert.equal(first.amountMinor, invoice.amount)
  assert.deepEqual(first.invoiceIds, [invoice.id])
  assert.equal(first.status, PaymentAttemptStatus.PENDING)
})

test('order creation accepts PayPal responses that omit optional purchase-unit references', async () => {
  const { plan } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => {
      const response = orderResponse(input)
      const purchaseUnit = response.purchase_units[0]!
      return {
        ...response,
        purchase_units: [{ amount: purchaseUnit.amount }],
      }
    },
    captureOrder: async () => ({}),
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  assert.ok(attempt.paypalOrderId)
  assert.equal(attempt.status, PaymentAttemptStatus.PENDING)
})

test('unexpected order response leaves the attempt ambiguous and blocks another create', async () => {
  const ambiguous = await createAmbiguousAttempt()
  assert.equal(ambiguous.getCreateCalls(), 1)
  assert.equal(
    (await getPaymentAttempt(ownerId, ambiguous.attemptId)).status,
    PaymentAttemptStatus.AMBIGUOUS,
  )
  await assert.rejects(
    () =>
      createApprovedPayPalOrder(
        ownerId,
        ambiguous.plan.id,
        ambiguous.plan.proposalVersion,
        ambiguous.provider,
        true,
      ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_ORDER_RECOVERY_REQUIRED',
  )
  assert.equal(ambiguous.getCreateCalls(), 1)
})

test('capture rejects an invalid order ID and does not contact PayPal', async () => {
  const { plan } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      throw new Error('Must not capture a mismatched order.')
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, 'ORDER-from-another-attempt', provider),
    (error: unknown) => error instanceof HttpError && error.code === 'PAYPAL_ORDER_MISMATCH',
  )
})

test('capture verifies provider response, updates invoices, and safely replays success', async () => {
  const { plan, invoice } = await createApprovedPlan()
  let captureCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async (input) => {
      captureCalls += 1
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: input.orderId },
      })
      assert.ok(attempt)
      return completedCapture(input.orderId, attempt.id)
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  const captured = await capturePayPalAttempt(
    ownerId,
    attempt.id,
    attempt.paypalOrderId!,
    provider,
  )
  assert.equal(captured.status, PaymentAttemptStatus.SUCCEEDED)
  assert.ok(captured.captureId)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PAID,
  )
  const replay = await capturePayPalAttempt(
    ownerId,
    attempt.id,
    attempt.paypalOrderId!,
    provider,
  )
  assert.equal(replay.status, PaymentAttemptStatus.SUCCEEDED)
  assert.equal(captureCalls, 1)
})

test('declined and failed captures are recorded without marking invoices paid', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      throw new PayPalProviderError('Declined.', 'definite', 'INSTRUMENT_DECLINED')
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) => error instanceof HttpError && error.code === 'PAYMENT_DECLINED',
  )
  assert.equal(
    (await getPaymentAttempt(ownerId, attempt.id)).status,
    PaymentAttemptStatus.DECLINED,
  )
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('definitive provider failure is recorded as failed, not successful', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      throw new PayPalProviderError('Request rejected.', 'definite', 'ORDER_NOT_APPROVED')
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_CAPTURE_FAILED',
  )
  assert.equal(
    (await getPaymentAttempt(ownerId, attempt.id)).status,
    PaymentAttemptStatus.FAILED,
  )
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('ambiguous capture can retry with the same PayPal request ID', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const requestIds: string[] = []
  let calls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async (input) => {
      requestIds.push(input.requestId)
      calls += 1
      if (calls === 1) {
        throw new PayPalProviderError('Timed out.', 'ambiguous')
      }
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: input.orderId },
      })
      assert.ok(attempt)
      return completedCapture(input.orderId, attempt.id)
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_CAPTURE_AMBIGUOUS',
  )
  assert.equal(
    (await getPaymentAttempt(ownerId, attempt.id)).status,
    PaymentAttemptStatus.AMBIGUOUS,
  )
  const cancelled = await request(`/api/payments/attempts/${attempt.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cancelled.status, 409)
  const retried = await capturePayPalAttempt(
    ownerId,
    attempt.id,
    attempt.paypalOrderId!,
    provider,
  )
  assert.equal(retried.status, PaymentAttemptStatus.SUCCEEDED)
  assert.deepEqual(requestIds[0], requestIds[1])
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PAID,
  )
})

test('ambiguous capture reconciles after payment-plan expiry', async () => {
  const { plan, invoice } = await createApprovedPlan()
  let captureCalls = 0
  let reconciliationCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      captureCalls += 1
      throw new PayPalProviderError('Capture response was lost.', 'ambiguous')
    },
    getOrder: async (orderId) => {
      reconciliationCalls += 1
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return completedCapture(orderId, attempt.id)
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_CAPTURE_AMBIGUOUS',
  )
  await prisma.paymentPlan.update({
    where: { id: plan.id },
    data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
  })

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(captureCalls, 1)
  assert.equal(reconciliationCalls, 1)
  assert.equal(reconciled.status, PaymentAttemptStatus.SUCCEEDED)
  assert.equal(reconciled.processing, false)
  assert.ok(reconciled.captureId)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PAID,
  )
  const audit = await prisma.auditEvent.findFirst({
    where: { entityType: 'PaymentAttempt', entityId: attempt.id, eventType: 'PAYMENT_RECONCILIATION_SUCCEEDED' },
  })
  assert.ok(audit)
})

test('reconciliation validates a retrieved order response without capture fields', async () => {
  const { plan, invoice } = await createApprovedPlan()
  let captureCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      captureCalls += 1
      return {}
    },
    getOrder: async (orderId) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return retrievedOrder(
        {
          orderId,
          attemptId: attempt.id,
          currency: attempt.currency,
          totalAmount: attempt.amount,
        },
        'CREATED',
      )
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(reconciled.status, PaymentAttemptStatus.PENDING)
  assert.equal(reconciled.providerStatus, 'CREATED')
  assert.equal(reconciled.processing, true)
  assert.equal(captureCalls, 0)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('approved retrieved order continues through verified capture', async () => {
  const { plan, invoice } = await createApprovedPlan()
  let captureCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async (input) => {
      captureCalls += 1
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: input.orderId },
      })
      assert.ok(attempt)
      return completedCapture(input.orderId, attempt.id)
    },
    getOrder: async (orderId) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return retrievedOrder(
        {
          orderId,
          attemptId: attempt.id,
          currency: attempt.currency,
          totalAmount: attempt.amount,
        },
        'APPROVED',
      )
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(captureCalls, 1)
  assert.equal(reconciled.status, PaymentAttemptStatus.SUCCEEDED)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PAID,
  )
})

test('voided retrieved order is recorded as terminal without paying invoices', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      throw new Error('A voided PayPal order must not be captured.')
    },
    getOrder: async (orderId) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return retrievedOrder(
        {
          orderId,
          attemptId: attempt.id,
          currency: attempt.currency,
          totalAmount: attempt.amount,
        },
        'VOIDED',
      )
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(reconciled.status, PaymentAttemptStatus.FAILED)
  assert.equal(reconciled.providerStatus, 'VOIDED')
  assert.equal(reconciled.processing, false)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('pending provider capture can be reconciled after plan expiry', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async (input) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: input.orderId },
      })
      assert.ok(attempt)
      return pendingCapture(input.orderId, attempt.id)
    },
    getOrder: async (orderId) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return completedCapture(orderId, attempt.id)
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  const pending = await capturePayPalAttempt(
    ownerId,
    attempt.id,
    attempt.paypalOrderId!,
    provider,
  )
  assert.equal(pending.status, PaymentAttemptStatus.PENDING)
  await prisma.paymentPlan.update({
    where: { id: plan.id },
    data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
  })

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(reconciled.status, PaymentAttemptStatus.SUCCEEDED)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PAID,
  )
})

test('pending provider captures cannot be downgraded to cancelled attempts', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async (input) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: input.orderId },
      })
      assert.ok(attempt)
      return pendingCapture(input.orderId, attempt.id)
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  const result = await capturePayPalAttempt(
    ownerId,
    attempt.id,
    attempt.paypalOrderId!,
    provider,
  )
  assert.equal(result.status, PaymentAttemptStatus.PENDING)
  assert.equal(result.providerStatus, 'PENDING')
  const cancel = await request(`/api/payments/attempts/${attempt.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cancel.status, 409)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('checkout cancellation is persisted and prevents capture', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => {
      throw new Error('Cancelled attempt must not reach PayPal capture.')
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  const cancelled = await request(`/api/payments/attempts/${attempt.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cancelled.status, 200)
  assert.equal((await cancelled.json()).data.status, PaymentAttemptStatus.CANCELLED)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) => error instanceof HttpError && error.code === 'INVALID_PAYMENT_ATTEMPT_STATE',
  )
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('unexpected PayPal capture payload is ambiguous and never reported as success', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => ({ id: 'wrong-order', status: 'COMPLETED' }),
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  await assert.rejects(
    () => capturePayPalAttempt(ownerId, attempt.id, attempt.paypalOrderId!, provider),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_UNEXPECTED_RESPONSE',
  )
  assert.equal(
    (await getPaymentAttempt(ownerId, attempt.id)).status,
    PaymentAttemptStatus.AMBIGUOUS,
  )
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('recovery rejects mismatched attempt identifiers, amount, and currency', async () => {
  const invalidOrder = async (
    mutation: (order: ReturnType<typeof retrievedOrder>) => unknown,
  ) => {
    const ambiguous = await createAmbiguousAttempt()
    const provider: PayPalPaymentProvider = {
      createOrder: async () => ({}),
      captureOrder: async () => ({}),
      getOrder: async (orderId) => {
        const order = retrievedOrder(
          {
            orderId,
            attemptId: ambiguous.attemptId,
            currency: 'USD',
            totalAmount: 12345,
          },
        )
        return mutation(order)
      },
    }
    return assert.rejects(
      () =>
        recoverAmbiguousPayPalOrder(
          { attemptId: ambiguous.attemptId, orderId: ambiguous.orderId, userId: ownerId },
          provider,
        ),
      (error: unknown) => error instanceof HttpError,
    )
  }

  await invalidOrder((order) => ({
    ...order,
    purchase_units: [
      { ...order.purchase_units[0]!, custom_id: 'another-attempt' },
    ],
  }))
  await invalidOrder((order) => ({
    ...order,
    purchase_units: [
      {
        ...order.purchase_units[0]!,
        amount: { currency_code: 'USD', value: '999.99' },
      },
    ],
  }))
  await invalidOrder((order) => ({
    ...order,
    purchase_units: [
      {
        ...order.purchase_units[0]!,
        amount: { currency_code: 'EUR', value: '123.45' },
      },
    ],
  }))
})

test('recovery verifies ownership and only attaches a provider-verified order', async () => {
  const ambiguous = await createAmbiguousAttempt()
  let providerCalls = 0
  const provider: PayPalPaymentProvider = {
    createOrder: async () => ({}),
    captureOrder: async () => ({}),
    getOrder: async (orderId) => {
      providerCalls += 1
      return retrievedOrder(
        {
          orderId,
          attemptId: ambiguous.attemptId,
          currency: 'USD',
          totalAmount: 12345,
        },
      )
    },
  }

  await assert.rejects(
    () =>
      recoverAmbiguousPayPalOrder(
        {
          attemptId: ambiguous.attemptId,
          orderId: ambiguous.orderId,
          userId: `not-${ownerId}`,
        },
        provider,
      ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  )
  assert.equal(providerCalls, 0)

  const recovered = await recoverAmbiguousPayPalOrder(
    { attemptId: ambiguous.attemptId, orderId: ambiguous.orderId, userId: ownerId },
    provider,
  )
  assert.equal(recovered.paypalOrderId, ambiguous.orderId)
  assert.equal(recovered.providerStatus, 'CREATED')
  assert.equal(recovered.status, PaymentAttemptStatus.AMBIGUOUS)
  await assert.rejects(
    () =>
      createApprovedPayPalOrder(
        ownerId,
        ambiguous.plan.id,
        ambiguous.plan.proposalVersion,
        provider,
        true,
      ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYPAL_ORDER_RECONCILIATION_REQUIRED',
  )
  const audit = await prisma.auditEvent.findFirst({
    where: {
      entityType: 'PaymentAttempt',
      entityId: ambiguous.attemptId,
      eventType: 'PAYPAL_ORDER_RECOVERED',
    },
  })
  assert.ok(audit)
})

test('concurrent recovery cannot attach two different orders', async () => {
  const ambiguous = await createAmbiguousAttempt()
  const orderIds = [`ORDER-A-${randomUUID()}`, `ORDER-B-${randomUUID()}`]
  const provider: PayPalPaymentProvider = {
    createOrder: async () => ({}),
    captureOrder: async () => ({}),
    getOrder: async (orderId) =>
      retrievedOrder(
        {
          orderId,
          attemptId: ambiguous.attemptId,
          currency: 'USD',
          totalAmount: 12345,
        },
      ),
  }

  const results = await Promise.allSettled(
    orderIds.map((orderId) =>
      recoverAmbiguousPayPalOrder(
        { attemptId: ambiguous.attemptId, orderId, userId: ownerId },
        provider,
      ),
    ),
  )
  const attached = await getPaymentAttempt(ownerId, ambiguous.attemptId)

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.ok(orderIds.includes(attached.paypalOrderId!))
  assert.equal(
    await prisma.paymentAttempt.count({
      where: { id: ambiguous.attemptId, providerOrderId: { in: orderIds } },
    }),
    1,
  )
})

test('completed order without a verified capture does not mark its invoice paid', async () => {
  const { plan, invoice } = await createApprovedPlan()
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => ({}),
    getOrder: async (orderId) => {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: orderId },
      })
      assert.ok(attempt)
      return retrievedOrder(
        {
          orderId,
          attemptId: attempt.id,
          currency: attempt.currency,
          totalAmount: attempt.amount,
        },
        'COMPLETED',
      )
    },
  }
  const attempt = await createApprovedPayPalOrder(
    ownerId,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)

  const reconciled = await reconcilePayPalAttempt(ownerId, attempt.id, provider)

  assert.equal(reconciled.status, PaymentAttemptStatus.AMBIGUOUS)
  assert.equal(reconciled.processing, true)
  assert.equal(
    (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status,
    InvoiceStatus.PENDING,
  )
})

test('payment attempts are owner-scoped', async () => {
  const otherOwner = await prisma.user.create({
    data: {
      email: `paypal-other-${randomUUID()}@example.test`,
      name: 'Fictional Other Sandbox User',
    },
  })
  const invoice = await createInvoiceForPayment(otherOwner.id)
  const plan = await createPaymentPlan(otherOwner.id, [invoice.id])
  planIds.push(plan.id)
  await approvePaymentPlan(otherOwner.id, plan.id, {
    proposalVersion: plan.proposalVersion,
    totalAmount: plan.totalAmount,
    currency: plan.currency,
    confirm: true,
  })
  const provider: PayPalPaymentProvider = {
    createOrder: async (input) => orderResponse(input),
    captureOrder: async () => ({}),
  }
  const attempt = await createApprovedPayPalOrder(
    otherOwner.id,
    plan.id,
    plan.proposalVersion,
    provider,
    true,
  )
  attemptIds.push(attempt.id)
  const response = await request(`/api/payments/attempts/${attempt.id}`)
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.message, 'Payment attempt not found.')
  await prisma.auditEvent.deleteMany({
    where: { ownerId: otherOwner.id, entityType: { in: ['PaymentAttempt', 'PaymentPlan'] } },
  })
  await prisma.paymentAttemptInvoice.deleteMany({
    where: { paymentAttemptId: attempt.id },
  })
  await prisma.paymentAttempt.deleteMany({ where: { id: attempt.id } })
  await prisma.paymentPlan.deleteMany({ where: { id: plan.id } })
  await prisma.invoice.deleteMany({ where: { id: invoice.id } })
  await prisma.user.delete({ where: { id: otherOwner.id } })
})

test('plan states do not permit creating an order after rejection', async () => {
  const { plan } = await createApprovedPlan()
  await prisma.paymentPlan.update({
    where: { id: plan.id },
    data: { status: PaymentPlanStatus.REJECTED },
  })
  const provider: PayPalPaymentProvider = {
    createOrder: async () => {
      throw new Error('Must not call PayPal for a rejected plan.')
    },
    captureOrder: async () => ({}),
  }
  await assert.rejects(
    () => createApprovedPayPalOrder(
      ownerId,
      plan.id,
      plan.proposalVersion,
      provider,
      true,
    ),
    (error: unknown) => error instanceof HttpError && error.code === 'APPROVAL_REQUIRED',
  )
})
