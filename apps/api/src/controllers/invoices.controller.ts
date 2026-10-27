import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
} from '../services/invoices.service.js'
import {
  createInvoiceSchema,
  invoiceIdSchema,
  invoiceListQuerySchema,
  updateInvoiceSchema,
} from '../validation/invoice.validation.js'

function ownerId(request: Express.Request) {
  if (!request.user) {
    throw new HttpError('Authentication is required.', 401)
  }
  return request.user.id
}

function toInvoiceResponse(invoice: Awaited<ReturnType<typeof getInvoice>>) {
  return {
    id: invoice.id,
    title: invoice.title,
    counterparty: invoice.counterparty,
    amountMinor: invoice.amount,
    currency: invoice.currency,
    dueDate: invoice.dueDate.toISOString(),
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  }
}

export const listInvoicesController: RequestHandler = async (request, response) => {
  const query = invoiceListQuerySchema.parse(request.query)
  const result = await listInvoices(ownerId(request), query)
  response.status(200).json({
    data: result.items.map(toInvoiceResponse),
    pagination: result.pagination,
    summary: result.summary,
  })
}

export const getInvoiceController: RequestHandler = async (request, response) => {
  const id = invoiceIdSchema.parse(request.params['id'])
  const invoice = await getInvoice(ownerId(request), id)
  response.status(200).json({ data: toInvoiceResponse(invoice) })
}

export const createInvoiceController: RequestHandler = async (request, response) => {
  const input = createInvoiceSchema.parse(request.body)
  const invoice = await createInvoice(ownerId(request), input)
  response.status(201).json({ data: toInvoiceResponse(invoice) })
}

export const updateInvoiceController: RequestHandler = async (request, response) => {
  const id = invoiceIdSchema.parse(request.params['id'])
  const input = updateInvoiceSchema.parse(request.body)
  const invoice = await updateInvoice(ownerId(request), id, input)
  response.status(200).json({ data: toInvoiceResponse(invoice) })
}
