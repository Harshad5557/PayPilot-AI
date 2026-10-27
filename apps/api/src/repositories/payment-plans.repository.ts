import type { PaymentPlanStatus, Prisma } from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

export function withPaymentPlanTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(operation)
}

export function findPaymentPlanById(ownerId: string, id: string) {
  return prisma.paymentPlan.findFirst({ where: { id, ownerId } })
}

export function findPaymentPlanByIdInTransaction(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  id: string,
) {
  return transaction.paymentPlan.findFirst({ where: { id, ownerId } })
}

export function findInvoicesForPaymentPlan(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  ids: string[],
) {
  return transaction.invoice.findMany({
    where: { ownerId, id: { in: ids } },
  })
}

export function createPaymentPlan(
  data: Prisma.PaymentPlanCreateInput,
) {
  return prisma.paymentPlan.create({ data })
}

export function createPaymentPlanInTransaction(
  transaction: Prisma.TransactionClient,
  data: Prisma.PaymentPlanUncheckedCreateInput,
) {
  return transaction.paymentPlan.create({ data })
}

export function listPaymentPlansByOwner(ownerId: string) {
  return prisma.paymentPlan.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  })
}

export function updatePaymentPlan(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  id: string,
  statuses: PaymentPlanStatus[],
  data: Prisma.PaymentPlanUpdateManyMutationInput,
) {
  return transaction.paymentPlan.updateMany({
    where: { id, ownerId, status: { in: statuses } },
    data,
  })
}

export function createPaymentPlanAuditEvent(
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
      entityType: 'PaymentPlan',
      entityId: input.entityId,
      metadataJson: JSON.stringify(metadata),
    },
  })
}
