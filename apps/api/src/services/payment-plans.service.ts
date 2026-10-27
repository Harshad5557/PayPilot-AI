import { createHash, randomUUID } from 'node:crypto'
import {
  InvoiceStatus,
  PaymentPlanStatus,
  type Prisma,
  type Invoice,
  type PaymentPlan,
} from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import {
  createPaymentPlanAuditEvent,
  createPaymentPlanInTransaction,
  findInvoicesForPaymentPlan,
  findPaymentPlanByIdInTransaction,
  updatePaymentPlan,
  withPaymentPlanTransaction,
} from '../repositories/payment-plans.repository.js'
import {
  paymentPlanSnapshotSchema,
  type PaymentPlanSnapshot,
} from '../validation/payment-plan.validation.js'

const PROPOSAL_TTL_MS = 15 * 60 * 1000
const MAX_CURRENCY_MINOR_UNITS = 2_147_483_647
const ACTIVE_STATUSES: PaymentPlanStatus[] = [
  PaymentPlanStatus.PROPOSED,
  PaymentPlanStatus.APPROVED,
]

type SnapshotInvoice = PaymentPlanSnapshot['invoices'][number]

function snapshotInvoice(invoice: Invoice): SnapshotInvoice {
  return {
    id: invoice.id,
    title: invoice.title,
    counterparty: invoice.counterparty,
    amountMinor: invoice.amount,
    currency: invoice.currency,
    dueDate: invoice.dueDate.toISOString(),
    status: invoice.status as 'PENDING' | 'OVERDUE',
    updatedAt: invoice.updatedAt.toISOString(),
  }
}

function planVersion(ownerId: string, expiresAt: Date, invoices: SnapshotInvoice[]) {
  return createHash('sha256')
    .update(JSON.stringify({
      ownerId,
      expiresAt: expiresAt.toISOString(),
      invoices,
    }))
    .digest('hex')
}

function parseSnapshot(plan: PaymentPlan): PaymentPlanSnapshot {
  let value: unknown
  try {
    value = JSON.parse(plan.proposalJson)
  } catch {
    throw new HttpError('Payment plan data is invalid.', 500, 'INVALID_PAYMENT_PLAN')
  }

  const snapshot = paymentPlanSnapshotSchema.safeParse(value)
  if (
    !snapshot.success ||
    snapshot.data.proposalVersion !== plan.proposalVersion ||
    planVersion(plan.ownerId, plan.expiresAt, snapshot.data.invoices) !== plan.proposalVersion ||
    snapshot.data.invoices.some((invoice) => invoice.currency !== plan.currency) ||
    snapshot.data.invoices.reduce((total, invoice) => total + invoice.amountMinor, 0) !== plan.totalAmount
  ) {
    throw new HttpError('Payment plan data is invalid.', 500, 'INVALID_PAYMENT_PLAN')
  }
  return snapshot.data
}

function responsePlan(plan: PaymentPlan) {
  const snapshot = parseSnapshot(plan)
  return {
    id: plan.id,
    status: plan.status,
    proposalVersion: plan.proposalVersion,
    totalAmount: plan.totalAmount,
    currency: plan.currency,
    expiresAt: plan.expiresAt.toISOString(),
    approvedAt: plan.approvedAt?.toISOString() ?? null,
    invoices: snapshot.invoices,
    createdAt: plan.createdAt.toISOString(),
  }
}

function invoiceSnapshotsMatch(snapshot: PaymentPlanSnapshot, invoices: Invoice[]) {
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  return snapshot.invoices.every((saved) => {
    const current = invoicesById.get(saved.id)
    return current !== undefined &&
      current.status !== InvoiceStatus.PAID &&
      current.status !== InvoiceStatus.CANCELLED &&
      snapshotInvoice(current).amountMinor === saved.amountMinor &&
      snapshotInvoice(current).currency === saved.currency &&
      snapshotInvoice(current).dueDate === saved.dueDate &&
      snapshotInvoice(current).title === saved.title &&
      snapshotInvoice(current).counterparty === saved.counterparty &&
      snapshotInvoice(current).status === saved.status &&
      snapshotInvoice(current).updatedAt === saved.updatedAt
  })
}

async function auditFailure(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  entityId: string,
  reason: string,
  proposalVersion?: string,
) {
  await createPaymentPlanAuditEvent(transaction, {
    ownerId,
    eventType: 'PAYMENT_PLAN_FAILED',
    entityId,
    metadata: { reason, proposalVersion },
  })
}

async function checkPlan(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  id: string,
  now: Date,
  expectedVersion?: string,
  allowedStatuses: PaymentPlanStatus[] = [PaymentPlanStatus.PROPOSED],
): Promise<{ plan: PaymentPlan | null; error: HttpError | null }> {
  const plan = await findPaymentPlanByIdInTransaction(transaction, ownerId, id)
  if (!plan) return { plan: null, error: new HttpError('Payment plan not found.', 404) }

  let snapshot: PaymentPlanSnapshot
  try {
    snapshot = parseSnapshot(plan)
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    await auditFailure(transaction, ownerId, id, 'INVALID_PROPOSAL_SNAPSHOT', plan.proposalVersion)
    return { plan, error }
  }
  if (expectedVersion !== undefined && expectedVersion !== plan.proposalVersion) {
    await auditFailure(transaction, ownerId, id, 'PROPOSAL_VERSION_MISMATCH', expectedVersion)
    return {
      plan,
      error: new HttpError('The payment plan version does not match.', 409, 'PROPOSAL_VERSION_MISMATCH'),
    }
  }

  if (now.getTime() >= plan.expiresAt.getTime() && ACTIVE_STATUSES.includes(plan.status)) {
    await updatePaymentPlan(transaction, ownerId, id, [plan.status], {
      status: PaymentPlanStatus.EXPIRED,
    })
    await createPaymentPlanAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_PLAN_EXPIRED',
      entityId: id,
      metadata: { proposalVersion: plan.proposalVersion },
    })
    return {
      plan: { ...plan, status: PaymentPlanStatus.EXPIRED },
      error: new HttpError('The payment plan has expired.', 409, 'PAYMENT_PLAN_EXPIRED'),
    }
  }

  if (!allowedStatuses.includes(plan.status)) {
    await auditFailure(transaction, ownerId, id, `INVALID_STATE_${plan.status}`, plan.proposalVersion)
    return {
      plan,
      error: new HttpError(
        `Payment plan cannot be used while it is ${plan.status.toLowerCase()}.`,
        409,
        'INVALID_PAYMENT_PLAN_STATE',
      ),
    }
  }

  const currentInvoices = await findInvoicesForPaymentPlan(
    transaction,
    ownerId,
    snapshot.invoices.map((invoice) => invoice.id),
  )
  if (
    currentInvoices.length !== snapshot.invoices.length ||
    !invoiceSnapshotsMatch(snapshot, currentInvoices)
  ) {
    await updatePaymentPlan(transaction, ownerId, id, [plan.status], {
      status: PaymentPlanStatus.STALE,
    })
    await auditFailure(transaction, ownerId, id, 'INVOICE_SNAPSHOT_CHANGED', plan.proposalVersion)
    return {
      plan: { ...plan, status: PaymentPlanStatus.STALE },
      error: new HttpError(
        'Invoice data changed after this proposal was created. Create a new payment plan.',
        409,
        'PAYMENT_PLAN_STALE',
      ),
    }
  }

  return { plan, error: null }
}

export async function createPaymentPlan(
  ownerId: string,
  invoiceIds: string[],
  now = new Date(),
) {
  const requestId = `request:${randomUUID()}`
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const invoices = await findInvoicesForPaymentPlan(transaction, ownerId, invoiceIds)
    if (invoices.length !== invoiceIds.length) {
      await auditFailure(transaction, ownerId, requestId, 'INVOICE_NOT_OWNED_OR_NOT_FOUND')
      return { error: new HttpError('One or more invoices were not found.', 404) } as const
    }

    const ineligible = invoices.find((invoice) =>
      invoice.status !== InvoiceStatus.PENDING &&
      invoice.status !== InvoiceStatus.OVERDUE
    )
    if (ineligible) {
      await auditFailure(transaction, ownerId, requestId, 'INVOICE_NOT_ELIGIBLE')
      return {
        error: new HttpError('All invoices must be pending or overdue.', 409, 'INVOICE_NOT_ELIGIBLE'),
      } as const
    }

    if (invoices.some((invoice) =>
      !Number.isSafeInteger(invoice.amount) ||
      invoice.amount <= 0 ||
      invoice.amount > MAX_CURRENCY_MINOR_UNITS
    )) {
      await auditFailure(transaction, ownerId, requestId, 'INVALID_INVOICE_AMOUNT')
      return {
        error: new HttpError('One or more invoice amounts are invalid.', 409, 'INVALID_PLAN_AMOUNT'),
      } as const
    }

    const currencies = new Set(invoices.map((invoice) => invoice.currency))
    if (currencies.size !== 1 || !Intl.supportedValuesOf('currency').includes(invoices[0]!.currency)) {
      await auditFailure(transaction, ownerId, requestId, 'INVALID_OR_MIXED_CURRENCY')
      return {
        error: new HttpError('A payment plan must use one supported currency.', 409, 'INVALID_PLAN_CURRENCY'),
      } as const
    }

    const totalAmount = invoices.reduce((total, invoice) => total + invoice.amount, 0)
    if (!Number.isSafeInteger(totalAmount) || totalAmount > MAX_CURRENCY_MINOR_UNITS) {
      await auditFailure(transaction, ownerId, requestId, 'TOTAL_OUT_OF_RANGE')
      return {
        error: new HttpError('The proposed total exceeds the supported amount.', 409, 'INVALID_PLAN_AMOUNT'),
      } as const
    }

    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS)
    const invoiceData = invoiceIds.map((id) => {
      const invoice = invoices.find((item) => item.id === id)
      if (!invoice) throw new Error('Validated invoice lookup was inconsistent.')
      return snapshotInvoice(invoice)
    })
    const version = planVersion(ownerId, expiresAt, invoiceData)
    const snapshot: PaymentPlanSnapshot = {
      schemaVersion: 1,
      proposalVersion: version,
      invoices: invoiceData,
    }
    const plan = await createPaymentPlanInTransaction(transaction, {
      ownerId,
      status: PaymentPlanStatus.PROPOSED,
      proposalJson: JSON.stringify(snapshot),
      proposalVersion: version,
      totalAmount,
      currency: invoices[0]!.currency,
      expiresAt,
    })
    await createPaymentPlanAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_PLAN_CREATED',
      entityId: plan.id,
      metadata: {
        proposalVersion: version,
        totalAmount,
        currency: plan.currency,
        invoiceCount: invoiceIds.length,
      },
    })
    return { plan } as const
  })

  if ('error' in result) throw result.error
  return responsePlan(result.plan)
}

export async function getPaymentPlan(ownerId: string, id: string, now = new Date()) {
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const plan = await findPaymentPlanByIdInTransaction(transaction, ownerId, id)
    if (!plan) return null
    if (
      now.getTime() >= plan.expiresAt.getTime() &&
      ACTIVE_STATUSES.includes(plan.status)
    ) {
      await updatePaymentPlan(transaction, ownerId, id, [plan.status], {
        status: PaymentPlanStatus.EXPIRED,
      })
      await createPaymentPlanAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_PLAN_EXPIRED',
        entityId: id,
        metadata: { proposalVersion: plan.proposalVersion },
      })
      return { ...plan, status: PaymentPlanStatus.EXPIRED }
    }
    return plan
  })
  if (!result) throw new HttpError('Payment plan not found.', 404)
  return responsePlan(result)
}

export async function validatePaymentPlan(
  ownerId: string,
  id: string,
  proposalVersion: string,
  now = new Date(),
) {
  const result = await withPaymentPlanTransaction((transaction) =>
    checkPlan(transaction, ownerId, id, now, proposalVersion),
  )
  if (result.error) throw result.error
  return { valid: true, plan: responsePlan(result.plan!) }
}

export async function approvePaymentPlan(
  ownerId: string,
  id: string,
  confirmation: {
    proposalVersion: string
    totalAmount: number
    currency: string
    confirm: true
  },
  now = new Date(),
) {
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const checked = await checkPlan(
      transaction,
      ownerId,
      id,
      now,
      confirmation.proposalVersion,
    )
    if (checked.error || !checked.plan) return checked

    if (
      checked.plan.totalAmount !== confirmation.totalAmount ||
      checked.plan.currency !== confirmation.currency
    ) {
      await auditFailure(transaction, ownerId, id, 'APPROVAL_DETAILS_MISMATCH', confirmation.proposalVersion)
      return {
        plan: checked.plan,
        error: new HttpError(
          'Approval must confirm the exact proposed amount and currency.',
          409,
          'APPROVAL_DETAILS_MISMATCH',
        ),
      }
    }

    const update = await updatePaymentPlan(
      transaction,
      ownerId,
      id,
      [PaymentPlanStatus.PROPOSED],
      {
        status: PaymentPlanStatus.APPROVED,
        approvedAt: now,
        approvedProposalVersion: confirmation.proposalVersion,
        approvedAmount: confirmation.totalAmount,
        approvedCurrency: confirmation.currency,
      },
    )
    if (update.count !== 1) {
      await auditFailure(transaction, ownerId, id, 'CONCURRENT_STATE_CHANGE', confirmation.proposalVersion)
      return {
        plan: checked.plan,
        error: new HttpError('The payment plan changed; retrieve it and try again.', 409, 'PAYMENT_PLAN_CHANGED'),
      }
    }

    await createPaymentPlanAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_PLAN_APPROVED',
      entityId: id,
      metadata: {
        proposalVersion: confirmation.proposalVersion,
        totalAmount: confirmation.totalAmount,
        currency: confirmation.currency,
        expiresAt: checked.plan.expiresAt.toISOString(),
      },
    })
    return {
      plan: {
        ...checked.plan,
        status: PaymentPlanStatus.APPROVED,
        approvedAt: now,
      },
      error: null,
    }
  })
  if (result.error) throw result.error
  return responsePlan(result.plan!)
}

export async function rejectPaymentPlan(
  ownerId: string,
  id: string,
  proposalVersion: string,
  reason?: string,
  now = new Date(),
) {
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const checked = await checkPlan(transaction, ownerId, id, now, proposalVersion)
    if (checked.error || !checked.plan) return checked
    const update = await updatePaymentPlan(
      transaction,
      ownerId,
      id,
      [PaymentPlanStatus.PROPOSED],
      { status: PaymentPlanStatus.REJECTED },
    )
    if (update.count !== 1) {
      await auditFailure(transaction, ownerId, id, 'CONCURRENT_STATE_CHANGE', proposalVersion)
      return {
        plan: checked.plan,
        error: new HttpError('The payment plan changed; retrieve it and try again.', 409, 'PAYMENT_PLAN_CHANGED'),
      }
    }
    await createPaymentPlanAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_PLAN_REJECTED',
      entityId: id,
      metadata: { proposalVersion, reason },
    })
    return {
      plan: { ...checked.plan, status: PaymentPlanStatus.REJECTED },
      error: null,
    }
  })
  if (result.error) throw result.error
  return responsePlan(result.plan!)
}
