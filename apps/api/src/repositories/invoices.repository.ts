import {
  InvoiceStatus,
  type Prisma,
} from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

export interface InvoiceListFilters {
  status?: InvoiceStatus
  search?: string
  sortBy: 'dueDate' | 'amount' | 'createdAt' | 'title' | 'status'
  sortOrder: 'asc' | 'desc'
  skip: number
  take: number
}

export function createInvoice(data: Prisma.InvoiceUncheckedCreateInput) {
  return prisma.invoice.create({ data })
}

export function findInvoiceById(ownerId: string, id: string) {
  return prisma.invoice.findFirst({ where: { id, ownerId } })
}

export function updateInvoice(
  ownerId: string,
  id: string,
  data: Prisma.InvoiceUpdateInput,
) {
  return prisma.invoice.updateMany({
    where: {
      id,
      ownerId,
      status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] },
    },
    data,
  })
}

export function listInvoicesByOwner(
  ownerId: string,
  filters: InvoiceListFilters,
) {
  const where: Prisma.InvoiceWhereInput = {
    ownerId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search } },
            { counterparty: { contains: filters.search } },
            { id: { contains: filters.search } },
          ],
        }
      : {}),
  }

  return prisma.invoice.findMany({
    where,
    orderBy: { [filters.sortBy]: filters.sortOrder },
    skip: filters.skip,
    take: filters.take,
  })
}

export function countInvoicesByOwner(
  ownerId: string,
  filters: Pick<InvoiceListFilters, 'status' | 'search'>,
) {
  const where: Prisma.InvoiceWhereInput = {
    ownerId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search } },
            { counterparty: { contains: filters.search } },
            { id: { contains: filters.search } },
          ],
        }
      : {}),
  }

  return prisma.invoice.count({ where })
}

export function summarizeInvoicesByOwner(ownerId: string) {
  return prisma.invoice.groupBy({
    by: ['status', 'currency'],
    where: { ownerId },
    _sum: { amount: true },
    _count: { _all: true },
  })
}
