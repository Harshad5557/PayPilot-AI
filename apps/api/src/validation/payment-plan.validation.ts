import { z } from 'zod'

const integerAmountSchema = z.number().int().positive().max(2_147_483_647)
const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'))
const currencySchema = z.string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .refine((currency) => supportedCurrencies.has(currency), 'Currency must be a supported ISO 4217 code.')

export const createPaymentPlanSchema = z.object({
  invoiceIds: z.array(z.string().trim().min(1).max(128)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Invoice IDs must be unique.'),
}).strict()

export const paymentPlanIdSchema = z.string().trim().min(1).max(128)

export const validatePaymentPlanSchema = z.object({
  proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const approvePaymentPlanSchema = z.object({
  proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
  totalAmount: integerAmountSchema,
  currency: currencySchema,
  confirm: z.literal(true),
}).strict()

export const rejectPaymentPlanSchema = z.object({
  proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().max(300).optional(),
}).strict()

export const paymentPlanInvoiceSnapshotSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(160),
  counterparty: z.string().min(1).max(160),
  amountMinor: integerAmountSchema,
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  dueDate: z.string().datetime(),
  status: z.enum(['PENDING', 'OVERDUE']),
  updatedAt: z.string().datetime(),
}).strict()

export const paymentPlanSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
  invoices: z.array(paymentPlanInvoiceSnapshotSchema).min(1).max(50),
}).strict()

export type PaymentPlanSnapshot = z.infer<typeof paymentPlanSnapshotSchema>
