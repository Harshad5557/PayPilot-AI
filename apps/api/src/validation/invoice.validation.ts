import { z } from 'zod'
import { InvoiceStatus } from '../generated/prisma/client.js'

const currencyCodes = new Set(Intl.supportedValuesOf('currency'))

const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .refine(
    (currency) => currencyCodes.has(currency),
    'Currency must be a supported ISO 4217 code.',
  )

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid calendar date in YYYY-MM-DD format.')
  .refine((date) => {
    const parsed = new Date(`${date}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
  }, 'Use a valid calendar date in YYYY-MM-DD format.')

const invoiceFields = {
  title: z.string().trim().min(1).max(160),
  counterparty: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().positive().max(2_147_483_647),
  currency: currencySchema,
  dueDate: dateSchema,
}

export const createInvoiceSchema = z.object(invoiceFields).strict()

export const updateInvoiceSchema = z
  .object(invoiceFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one invoice field to update.')

export const invoiceIdSchema = z.string().trim().min(1).max(128)

export const invoiceListQuerySchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(['dueDate', 'amount', 'createdAt', 'title', 'status']).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict()
