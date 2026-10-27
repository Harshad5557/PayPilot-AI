import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import {
  InvoiceStatus,
  PaymentPlanStatus,
} from './generated/prisma/client.js'
import { app } from './app.js'
import { prisma } from './database/prisma.js'
import { HttpError } from './errors/http-error.js'
import { createInvoice } from './repositories/invoices.repository.js'
import {
  approvePaymentPlan,
  createPaymentPlan,
  validatePaymentPlan,
} from './services/payment-plans.service.js'
import { verifyApprovedPaymentPlanForExecution } from './services/payment-execution.service.js'

const ownerEmail = 'owner@northstar-studio.example.test'
const server = app.listen(0)
await once(server, 'listening')

let ownerId = ''
const invoiceIds: string[] = []
const planIds: string[] = []
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
      entityType: 'PaymentPlan',
      createdAt: { gte: testStartedAt },
    },
  })
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

async function createTestInvoice(
  overrides: Partial<{
    ownerId: string
    amount: number
    currency: string
    status: InvoiceStatus
  }> = {},
) {
  const id = `plan-test-${randomUUID()}`
  const invoice = await createInvoice({
    id,
    ownerId: overrides.ownerId ?? ownerId,
    title: 'DEMO - Payment plan test',
    counterparty: 'Fictional Plan Test Supplier',
    amount: overrides.amount ?? 12345,
    currency: overrides.currency ?? 'USD',
    dueDate: new Date('2026-12-15T00:00:00.000Z'),
    status: overrides.status ?? InvoiceStatus.PENDING,
  })
  invoiceIds.push(invoice.id)
  return invoice
}

async function createPlanViaApi(invoiceId: string) {
  const response = await request('/api/payment-plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invoiceIds: [invoiceId] }),
  })
  const payload = await response.json()
  if (response.ok) planIds.push(payload.data.id as string)
  return { response, payload }
}

test('payment plan APIs create, validate, and explicitly approve the exact version and amount', async () => {
  const invoice = await createTestInvoice()
  const { response: created, payload } = await createPlanViaApi(invoice.id)
  assert.equal(created.status, 201)
  assert.equal(payload.data.status, PaymentPlanStatus.PROPOSED)
  assert.equal(payload.data.totalAmount, invoice.amount)
  assert.equal(payload.data.currency, invoice.currency)
  assert.equal(payload.data.invoices[0].id, invoice.id)
  assert.equal(Date.parse(payload.data.expiresAt) > Date.now(), true)

  const fetched = await request(`/api/payment-plans/${payload.data.id}`)
  assert.equal(fetched.status, 200)
  assert.equal((await fetched.json()).data.proposalVersion, payload.data.proposalVersion)

  const valid = await request(`/api/payment-plans/${payload.data.id}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalVersion: payload.data.proposalVersion }),
  })
  assert.equal(valid.status, 200)
  assert.equal((await valid.json()).data.valid, true)

  const tampered = await request(`/api/payment-plans/${payload.data.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      proposalVersion: payload.data.proposalVersion,
      totalAmount: invoice.amount + 1,
      currency: invoice.currency,
      confirm: true,
    }),
  })
  assert.equal(tampered.status, 409)
  assert.equal((await tampered.json()).error.code, 'APPROVAL_DETAILS_MISMATCH')
  assert.equal(
    (await prisma.paymentPlan.findUnique({ where: { id: payload.data.id } }))?.status,
    PaymentPlanStatus.PROPOSED,
  )

  const approvalBody = {
    proposalVersion: payload.data.proposalVersion,
    totalAmount: invoice.amount,
    currency: invoice.currency,
    confirm: true,
  }
  const approved = await request(`/api/payment-plans/${payload.data.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(approvalBody),
  })
  assert.equal(approved.status, 200)
  const approvedPayload = await approved.json()
  assert.equal(approvedPayload.data.status, PaymentPlanStatus.APPROVED)
  assert.equal(approvedPayload.data.totalAmount, invoice.amount)
  assert.match(approvedPayload.notice, /No payment was initiated or captured/)

  const duplicateApproval = await request(`/api/payment-plans/${payload.data.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(approvalBody),
  })
  assert.equal(duplicateApproval.status, 409)

  const executionCheck = await verifyApprovedPaymentPlanForExecution(ownerId, payload.data.id)
  assert.equal(executionCheck.proposalVersion, payload.data.proposalVersion)
  assert.equal(executionCheck.totalAmount, invoice.amount)

  const events = await prisma.auditEvent.findMany({
    where: { ownerId, entityType: 'PaymentPlan', entityId: payload.data.id },
    orderBy: { createdAt: 'asc' },
  })
  assert.deepEqual(events.map((event) => event.eventType), [
    'PAYMENT_PLAN_CREATED',
    'PAYMENT_PLAN_FAILED',
    'PAYMENT_PLAN_APPROVED',
    'PAYMENT_PLAN_FAILED',
  ])
})

test('stale invoice snapshots cannot be validated or approved', async () => {
  const invoice = await createTestInvoice()
  const plan = await createPaymentPlan(ownerId, [invoice.id])
  planIds.push(plan.id)
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { amount: invoice.amount + 100 },
  })

  await assert.rejects(
    () => validatePaymentPlan(ownerId, plan.id, plan.proposalVersion),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYMENT_PLAN_STALE',
  )
  assert.equal(
    (await prisma.paymentPlan.findUnique({ where: { id: plan.id } }))?.status,
    PaymentPlanStatus.STALE,
  )
  assert.ok(await prisma.auditEvent.findFirst({
    where: {
      ownerId,
      entityType: 'PaymentPlan',
      entityId: plan.id,
      eventType: 'PAYMENT_PLAN_FAILED',
    },
  }))
})

test('expired proposals are transitioned and audited', async () => {
  const invoice = await createTestInvoice()
  const createdAt = new Date('2026-10-23T00:00:00.000Z')
  const plan = await createPaymentPlan(ownerId, [invoice.id], createdAt)
  planIds.push(plan.id)

  await assert.rejects(
    () => validatePaymentPlan(
      ownerId,
      plan.id,
      plan.proposalVersion,
      new Date(createdAt.getTime() + 16 * 60 * 1000),
    ),
    (error: unknown) => error instanceof HttpError && error.code === 'PAYMENT_PLAN_EXPIRED',
  )
  assert.equal(
    (await prisma.paymentPlan.findUnique({ where: { id: plan.id } }))?.status,
    PaymentPlanStatus.EXPIRED,
  )
  assert.ok(await prisma.auditEvent.findFirst({
    where: {
      ownerId,
      entityType: 'PaymentPlan',
      entityId: plan.id,
      eventType: 'PAYMENT_PLAN_EXPIRED',
    },
  }))
})

test('rejection is version-bound, terminal, and audited', async () => {
  const invoice = await createTestInvoice()
  const { response: created, payload } = await createPlanViaApi(invoice.id)
  assert.equal(created.status, 201)

  const rejected = await request(`/api/payment-plans/${payload.data.id}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      proposalVersion: payload.data.proposalVersion,
      reason: 'Not approved for this cycle.',
    }),
  })
  assert.equal(rejected.status, 200)
  assert.equal((await rejected.json()).data.status, PaymentPlanStatus.REJECTED)

  const repeated = await request(`/api/payment-plans/${payload.data.id}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalVersion: payload.data.proposalVersion }),
  })
  assert.equal(repeated.status, 409)
  assert.ok(await prisma.auditEvent.findFirst({
    where: {
      ownerId,
      entityType: 'PaymentPlan',
      entityId: payload.data.id,
      eventType: 'PAYMENT_PLAN_REJECTED',
    },
  }))
})

test('execution preflight refuses a proposed plan without explicit approval', async () => {
  const invoice = await createTestInvoice()
  const plan = await createPaymentPlan(ownerId, [invoice.id])
  planIds.push(plan.id)

  await assert.rejects(
    () => verifyApprovedPaymentPlanForExecution(ownerId, plan.id),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'APPROVAL_REQUIRED',
  )
})

test('execution preflight independently detects invoices changed after approval', async () => {
  const invoice = await createTestInvoice()
  const plan = await createPaymentPlan(ownerId, [invoice.id])
  planIds.push(plan.id)
  await approvePaymentPlan(ownerId, plan.id, {
    proposalVersion: plan.proposalVersion,
    totalAmount: plan.totalAmount,
    currency: plan.currency,
    confirm: true,
  })
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: InvoiceStatus.PAID },
  })

  await assert.rejects(
    () => verifyApprovedPaymentPlanForExecution(ownerId, plan.id),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'PAYMENT_PLAN_STALE',
  )
  assert.equal(
    (await prisma.paymentPlan.findUnique({ where: { id: plan.id } }))?.status,
    PaymentPlanStatus.STALE,
  )
})

test('plan creation rejects invoice IDs belonging to another owner', async () => {
  const otherOwner = await prisma.user.create({
    data: {
      email: `payment-plan-other-${randomUUID()}@example.test`,
      name: 'Fictional Other Owner',
    },
  })
  try {
    const privateInvoice = await createTestInvoice({ ownerId: otherOwner.id })
    const { response, payload } = await createPlanViaApi(privateInvoice.id)
    assert.equal(response.status, 404)
    assert.equal(payload.error.message, 'One or more invoices were not found.')
    assert.equal(
      await prisma.paymentPlan.count({
        where: { ownerId, proposalJson: { contains: privateInvoice.id } },
      }),
      0,
    )
  } finally {
    await prisma.user.delete({ where: { id: otherOwner.id } })
  }
})

test('plan creation rejects paid invoices and mixed-currency totals', async () => {
  const paidInvoice = await createTestInvoice({ status: InvoiceStatus.PAID })
  const paidResult = await createPlanViaApi(paidInvoice.id)
  assert.equal(paidResult.response.status, 409)
  assert.equal(paidResult.payload.error.code, 'INVOICE_NOT_ELIGIBLE')

  const usd = await createTestInvoice({ currency: 'USD' })
  const eur = await createTestInvoice({ currency: 'EUR' })
  const mixed = await request('/api/payment-plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invoiceIds: [usd.id, eur.id] }),
  })
  assert.equal(mixed.status, 409)
  assert.equal((await mixed.json()).error.code, 'INVALID_PLAN_CURRENCY')
})
