import {
  InvoiceStatus,
  type Prisma,
} from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import {
  countInvoicesByOwner,
  createInvoice as insertInvoice,
  findInvoiceById,
  listInvoicesByOwner,
  summarizeInvoicesByOwner,
  updateInvoice as persistInvoiceUpdate,
} from '../repositories/invoices.repository.js'

export interface InvoiceListOptions {
  status?: InvoiceStatus
  search?: string
  sortBy: 'dueDate' | 'amount' | 'createdAt' | 'title' | 'status'
  sortOrder: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface InvoiceInput {
  title: string
  counterparty: string
  amountMinor: number
  currency: string
  dueDate: string
}

function invoiceData(
  ownerId: string,
  input: InvoiceInput,
): Prisma.InvoiceUncheckedCreateInput {
  return {
    ownerId,
    title: demoTitle(input.title),
    counterparty: input.counterparty,
    amount: input.amountMinor,
    currency: input.currency,
    dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
    status: InvoiceStatus.PENDING,
  }
}

function demoTitle(title: string) {
  return /^DEMO\s*[-·]/i.test(title) ? title : `DEMO - ${title}`
}

export async function listInvoices(ownerId: string, options: InvoiceListOptions) {
  const filters = {
    status: options.status,
    search: options.search,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    skip: (options.page - 1) * options.pageSize,
    take: options.pageSize,
  } as const
  const [items, total] = await Promise.all([
    listInvoicesByOwner(ownerId, filters),
    countInvoicesByOwner(ownerId, filters),
  ])
  const groups = await summarizeInvoicesByOwner(ownerId)
  const amountsFor = (statuses: InvoiceStatus[]) => {
    const amounts: Record<string, number> = {}
    for (const group of groups) {
      if (statuses.includes(group.status)) {
        amounts[group.currency] =
          (amounts[group.currency] ?? 0) + (group._sum.amount ?? 0)
      }
    }
    return amounts
  }
  const countFor = (status: InvoiceStatus) =>
    groups
      .filter((group) => group.status === status)
      .reduce((count, group) => count + group._count._all, 0)

  return {
    items,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize),
    },
    summary: {
      outstandingByCurrency: amountsFor([
        InvoiceStatus.PENDING,
        InvoiceStatus.OVERDUE,
      ]),
      overdueByCurrency: amountsFor([InvoiceStatus.OVERDUE]),
      overdueCount: countFor(InvoiceStatus.OVERDUE),
      upcomingByCurrency: amountsFor([InvoiceStatus.PENDING]),
      upcomingCount: countFor(InvoiceStatus.PENDING),
      completedByCurrency: amountsFor([InvoiceStatus.PAID]),
      completedCount: countFor(InvoiceStatus.PAID),
    },
  }
}

export async function getInvoice(ownerId: string, id: string) {
  const invoice = await findInvoiceById(ownerId, id)
  if (!invoice) throw new HttpError('Invoice not found.', 404)
  return invoice
}

export async function createInvoice(ownerId: string, input: InvoiceInput) {
  return insertInvoice(invoiceData(ownerId, input))
}

export async function updateInvoice(
  ownerId: string,
  id: string,
  input: Partial<InvoiceInput>,
) {
  const invoice = await getInvoice(ownerId, id)
  if (
    invoice.status === InvoiceStatus.PAID ||
    invoice.status === InvoiceStatus.CANCELLED
  ) {
    throw new HttpError(
      `Invoices with ${invoice.status.toLowerCase()} status cannot be edited.`,
      409,
    )
  }

  const data: Prisma.InvoiceUpdateInput = {}
  if (input.title !== undefined) data.title = demoTitle(input.title)
  if (input.counterparty !== undefined) data.counterparty = input.counterparty
  if (input.amountMinor !== undefined) data.amount = input.amountMinor
  if (input.currency !== undefined) data.currency = input.currency
  if (input.dueDate !== undefined) {
    data.dueDate = new Date(`${input.dueDate}T00:00:00.000Z`)
  }
  const updateResult = await persistInvoiceUpdate(ownerId, id, data)
  if (updateResult.count === 0) {
    const currentInvoice = await getInvoice(ownerId, id)
    throw new HttpError(
      `Invoices with ${currentInvoice.status.toLowerCase()} status cannot be edited.`,
      409,
    )
  }

  return getInvoice(ownerId, id)
}
