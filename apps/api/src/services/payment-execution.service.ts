import { createHash } from 'node:crypto'
import {
  InvoiceStatus,
  PaymentPlanStatus,
} from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import {
  createPaymentPlanAuditEvent,
  findInvoicesForPaymentPlan,
  findPaymentPlanByIdInTransaction,
  updatePaymentPlan,
  withPaymentPlanTransaction,
} from '../repositories/payment-plans.repository.js'
import { paymentPlanSnapshotSchema } from '../validation/payment-plan.validation.js'

export interface PaymentExecutionAuthorization {
  paymentPlanId: string
  proposalVersion: string
  ownerId: string
  totalAmount: number
  currency: string
  invoiceIds: string[]
  invoices: { id: string; amountMinor: number; currency: string }[]
}

function invalidPlan() {
  return new HttpError('Payment plan data is invalid.', 409, 'INVALID_PAYMENT_PLAN')
}

export async function verifyApprovedPaymentPlanForExecution(
  ownerId: string,
  paymentPlanId: string,
  now = new Date(),
): Promise<PaymentExecutionAuthorization> {
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const plan = await findPaymentPlanByIdInTransaction(
      transaction,
      ownerId,
      paymentPlanId,
    )
    if (!plan) {
      return {
        authorization: null,
        error: new HttpError('Payment plan not found.', 404),
      }
    }

    if (plan.status !== PaymentPlanStatus.APPROVED) {
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: { reason: 'APPROVAL_REQUIRED', proposalVersion: plan.proposalVersion },
      })
      return {
        authorization: null,
        error: new HttpError(
          'A valid explicit approval is required before payment execution.',
          409,
          'APPROVAL_REQUIRED',
        ),
      }
    }

    if (now.getTime() >= plan.expiresAt.getTime()) {
      await updatePaymentPlan(
        transaction,
        ownerId,
        paymentPlanId,
        [PaymentPlanStatus.APPROVED],
        { status: PaymentPlanStatus.EXPIRED },
      )
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_EXPIRED',
        entityId: paymentPlanId,
        metadata: { proposalVersion: plan.proposalVersion },
      })
      return {
        authorization: null,
        error: new HttpError('The payment plan has expired.', 409, 'PAYMENT_PLAN_EXPIRED'),
      }
    }

    let rawSnapshot: unknown
    try {
      rawSnapshot = JSON.parse(plan.proposalJson)
    } catch {
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: { reason: 'INVALID_PROPOSAL_SNAPSHOT', proposalVersion: plan.proposalVersion },
      })
      return { authorization: null, error: invalidPlan() }
    }
    const snapshot = paymentPlanSnapshotSchema.safeParse(rawSnapshot)
    if (!snapshot.success) {
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: { reason: 'INVALID_PROPOSAL_SNAPSHOT', proposalVersion: plan.proposalVersion },
      })
      return { authorization: null, error: invalidPlan() }
    }
    if (
      snapshot.data.proposalVersion !== plan.proposalVersion ||
      createHash('sha256')
        .update(JSON.stringify({
          ownerId: plan.ownerId,
          expiresAt: plan.expiresAt.toISOString(),
          invoices: snapshot.data.invoices,
        }))
        .digest('hex') !== plan.proposalVersion ||
      plan.approvedAt === null ||
      plan.approvedProposalVersion !== plan.proposalVersion ||
      plan.approvedAmount !== plan.totalAmount ||
      plan.approvedCurrency !== plan.currency ||
      snapshot.data.invoices.some((invoice) => invoice.currency !== plan.currency) ||
      snapshot.data.invoices.reduce((total, invoice) => total + invoice.amountMinor, 0) !== plan.totalAmount
    ) {
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: { reason: 'APPROVAL_BINDING_INVALID', proposalVersion: plan.proposalVersion },
      })
      return {
        authorization: null,
        error: new HttpError('The payment plan approval is invalid.', 409, 'APPROVAL_REQUIRED'),
      }
    }

    const invoiceIds = snapshot.data.invoices.map((invoice) => invoice.id)
    const invoices = await findInvoicesForPaymentPlan(transaction, ownerId, invoiceIds)
    const currentById = new Map(invoices.map((invoice) => [invoice.id, invoice]))
    const unchanged = invoices.length === invoiceIds.length &&
      snapshot.data.invoices.every((saved) => {
        const current = currentById.get(saved.id)
        return current !== undefined &&
          (current.status === InvoiceStatus.PENDING ||
            current.status === InvoiceStatus.OVERDUE) &&
          current.amount === saved.amountMinor &&
          current.currency === saved.currency &&
          current.dueDate.toISOString() === saved.dueDate &&
          current.title === saved.title &&
          current.counterparty === saved.counterparty &&
          current.status === saved.status &&
          current.updatedAt.toISOString() === saved.updatedAt
      })

    if (!unchanged) {
      await updatePaymentPlan(
        transaction,
        ownerId,
        paymentPlanId,
        [PaymentPlanStatus.APPROVED],
        { status: PaymentPlanStatus.STALE },
      )
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: {
          reason: 'INVOICE_SNAPSHOT_CHANGED',
          proposalVersion: plan.proposalVersion,
        },
      })
      return {
        authorization: null,
        error: new HttpError(
          'Invoice data changed after approval. A new payment plan is required.',
          409,
          'PAYMENT_PLAN_STALE',
        ),
      }
    }

    if (!Intl.supportedValuesOf('currency').includes(plan.currency)) {
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: paymentPlanId,
        metadata: { reason: 'UNSUPPORTED_CURRENCY', proposalVersion: plan.proposalVersion },
      })
      return {
        authorization: null,
        error: new HttpError('Payment plan currency is not supported.', 409, 'INVALID_PLAN_CURRENCY'),
      }
    }

    return {
      authorization: {
        paymentPlanId,
        proposalVersion: plan.proposalVersion,
        ownerId,
        totalAmount: plan.totalAmount,
        currency: plan.currency,
        invoiceIds,
        invoices: snapshot.data.invoices.map(({ id, amountMinor, currency }) => ({
          id,
          amountMinor,
          currency,
        })),
      },
      error: null,
    }
  })

  if (result.error) throw result.error
  if (!result.authorization) {
    throw new HttpError('Payment execution authorization failed.', 500)
  }
  return result.authorization
}
