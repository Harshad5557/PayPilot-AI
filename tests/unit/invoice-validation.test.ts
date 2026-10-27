import { describe, expect, it } from 'vitest'
import {
  createInvoiceSchema,
  updateInvoiceSchema,
} from '../../apps/api/src/validation/invoice.validation.js'

const validInvoice = {
  title: 'DEMO - Hosting',
  counterparty: 'Fictional Cloud Supplier',
  amountMinor: 12_345,
  currency: 'USD',
  dueDate: '2026-11-15',
}

describe('invoice request validation', () => {
  it('accepts fictional invoice fixtures with integer minor units', () => {
    expect(createInvoiceSchema.parse(validInvoice)).toMatchObject(validInvoice)
  })

  it.each([
    { amountMinor: 0 },
    { amountMinor: 12.5 },
    { currency: 'usd' },
    { dueDate: '2026-02-30' },
  ])('rejects invalid invoice data %#', (override) => {
    expect(createInvoiceSchema.safeParse({ ...validInvoice, ...override }).success).toBe(false)
  })

  it('rejects an empty patch and attempts to change status', () => {
    expect(updateInvoiceSchema.safeParse({}).success).toBe(false)
    expect(updateInvoiceSchema.safeParse({ status: 'PAID' }).success).toBe(false)
  })
})
