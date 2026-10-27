import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import {
  InvoiceStatus,
  PaymentAttemptStatus,
  PaymentPlanStatus,
} from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'
import { createAuditEvent, listAuditEventsByOwner } from './audit-events.repository.js'
import {
  createInvoice,
  findInvoiceById,
  listInvoicesByOwner,
} from './invoices.repository.js'
import {
  createPaymentAttempt,
  findPaymentAttemptById,
  findPaymentAttemptByIdempotencyKey,
} from './payment-attempts.repository.js'
import {
  createPaymentPlan,
  findPaymentPlanById,
} from './payment-plans.repository.js'
import { createUser, findUserByEmail, findUserById } from './users.repository.js'

after(async () => {
  await prisma.$disconnect()
})

test('repositories create and retrieve related database records', async () => {
  const email = `repository-test-${randomUUID()}@example.test`
  const owner = await createUser({ email, name: 'Repository Test (Demo)' })

  try {
    const invoice = await createInvoice({
      ownerId: owner.id,
      title: 'DEMO - Repository test invoice',
      counterparty: 'Fictional Test Supplier',
      amount: 12345,
      currency: 'USD',
      dueDate: new Date('2026-11-15T00:00:00.000Z'),
      status: InvoiceStatus.PENDING,
    })
    const plan = await createPaymentPlan({
      owner: { connect: { id: owner.id } },
      status: PaymentPlanStatus.PROPOSED,
      proposalJson: JSON.stringify({ demo: true, invoiceId: invoice.id }),
      proposalVersion: randomUUID().replaceAll('-', '').repeat(2),
      totalAmount: invoice.amount,
      currency: invoice.currency,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    })
    const attempt = await createPaymentAttempt({
      owner: { connect: { id: owner.id } },
      invoice: { connect: { id: invoice.id } },
      paymentPlan: { connect: { id: plan.id } },
      amount: invoice.amount,
      currency: invoice.currency,
      status: PaymentAttemptStatus.PENDING,
      idempotencyKey: `repository-test-${randomUUID()}`,
    })
    const auditEvent = await createAuditEvent({
      owner: { connect: { id: owner.id } },
      eventType: 'DEMO_REPOSITORY_TEST',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadataJson: JSON.stringify({ demo: true }),
    })

    assert.equal((await findUserById(owner.id))?.email, email)
    assert.equal((await findUserByEmail(email))?.id, owner.id)
    assert.equal((await findInvoiceById(owner.id, invoice.id))?.amount, 12345)
    assert.equal(
      (await listInvoicesByOwner(owner.id, {
        status: InvoiceStatus.PENDING,
        sortBy: 'dueDate',
        sortOrder: 'asc',
        skip: 0,
        take: 20,
      })).length,
      1,
    )
    assert.equal((await findPaymentPlanById(owner.id, plan.id))?.id, plan.id)
    assert.equal(
      (await findPaymentAttemptById(owner.id, attempt.id))?.invoiceId,
      invoice.id,
    )
    assert.equal(
      (await findPaymentAttemptByIdempotencyKey(attempt.idempotencyKey))?.id,
      attempt.id,
    )
    assert.equal((await listAuditEventsByOwner(owner.id))[0]?.id, auditEvent.id)
  } finally {
    await prisma.auditEvent.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  }
})
