import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

export function createPaymentAttempt(
  data: Prisma.PaymentAttemptCreateInput,
) {
  return prisma.paymentAttempt.create({ data })
}

export function findPaymentAttemptById(ownerId: string, id: string) {
  return prisma.paymentAttempt.findFirst({
    where: { id, ownerId },
    include: { invoiceAllocations: true },
  })
}

export function findPaymentAttemptByIdempotencyKey(idempotencyKey: string) {
  return prisma.paymentAttempt.findUnique({ where: { idempotencyKey } })
}

export function listPaymentAttemptsByOwner(ownerId: string) {
  return prisma.paymentAttempt.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  })
}

export function findPaymentAttemptInTransaction(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  id: string,
) {
  return transaction.paymentAttempt.findFirst({
    where: { id, ownerId },
    include: { invoiceAllocations: true },
  })
}

export function findPaymentAttemptByIdempotencyKeyInTransaction(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
) {
  return transaction.paymentAttempt.findUnique({
    where: { idempotencyKey },
    include: { invoiceAllocations: true },
  })
}

export function findActiveAttemptsForInvoices(
  transaction: Prisma.TransactionClient,
  invoiceIds: string[],
) {
  return transaction.paymentAttemptInvoice.findMany({
    where: {
      invoiceId: { in: invoiceIds },
      paymentAttempt: {
        status: { in: ['PENDING', 'CAPTURING', 'AMBIGUOUS'] },
      },
    },
    include: { paymentAttempt: true },
  })
}

export function createPaymentAttemptInTransaction(
  transaction: Prisma.TransactionClient,
  data: Prisma.PaymentAttemptUncheckedCreateInput,
) {
  return transaction.paymentAttempt.create({
    data,
    include: { invoiceAllocations: true },
  })
}

export function updatePaymentAttempt(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  id: string,
  statuses: Prisma.EnumPaymentAttemptStatusFilter['in'],
  data: Prisma.PaymentAttemptUpdateManyMutationInput,
) {
  return transaction.paymentAttempt.updateMany({
    where: { id, ownerId, status: { in: statuses } },
    data,
  })
}

export function updateAttemptInvoicesAsPaid(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  invoiceIds: string[],
) {
  return transaction.invoice.updateMany({
    where: {
      ownerId,
      id: { in: invoiceIds },
      status: { in: ['PENDING', 'OVERDUE'] },
    },
    data: { status: 'PAID' },
  })
}

export function createPaymentAttemptAuditEvent(
  transaction: Prisma.TransactionClient,
  input: {
    ownerId: string
    eventType: string
    entityId: string
    metadata: Record<string, string | number | boolean | undefined>
  },
) {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata).filter(([, value]) => value !== undefined),
  )
  return transaction.auditEvent.create({
    data: {
      ownerId: input.ownerId,
      eventType: input.eventType,
      entityType: 'PaymentAttempt',
      entityId: input.entityId,
      metadataJson: JSON.stringify(metadata),
    },
  })
}
