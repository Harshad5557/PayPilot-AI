import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createInvoiceSchema,
  invoiceListQuerySchema,
  updateInvoiceSchema,
} from './invoice.validation.js'

const validInvoice = {
  title: '  DEMO - Office supplies  ',
  counterparty: ' Fictional Paper Company ',
  amountMinor: 2599,
  currency: 'USD',
  dueDate: '2026-11-15',
}

test('invoice creation schema normalizes text and accepts valid minor units', () => {
  assert.deepEqual(createInvoiceSchema.parse(validInvoice), {
    ...validInvoice,
    title: 'DEMO - Office supplies',
    counterparty: 'Fictional Paper Company',
  })
})

test('invoice creation accepts INR with integer paise minor units', () => {
  assert.deepEqual(
    createInvoiceSchema.parse({ ...validInvoice, currency: 'INR', amountMinor: 12345 }),
    { ...validInvoice, title: 'DEMO - Office supplies', counterparty: 'Fictional Paper Company', currency: 'INR', amountMinor: 12345 },
  )
})

test('invoice schemas reject malformed amounts, currency codes, dates, and status changes', () => {
  for (const invalid of [
    { amountMinor: 0 },
    { amountMinor: 12.5 },
    { amountMinor: 2_147_483_648 },
    { currency: 'ZZZ' },
    { currency: 'usd' },
    { dueDate: '2026-02-30' },
    { status: 'PAID' },
  ]) {
    assert.equal(createInvoiceSchema.safeParse({ ...validInvoice, ...invalid }).success, false)
  }
})

test('invoice patch requires a non-empty set of editable fields', () => {
  assert.equal(updateInvoiceSchema.safeParse({}).success, false)
  assert.equal(updateInvoiceSchema.safeParse({ status: 'PAID' }).success, false)
  assert.deepEqual(updateInvoiceSchema.parse({ dueDate: validInvoice.dueDate }), {
    dueDate: validInvoice.dueDate,
  })
})

test('invoice list query schema validates and normalizes paging and sorting', () => {
  assert.deepEqual(
    invoiceListQuerySchema.parse({
      status: 'PENDING',
      page: '2',
      pageSize: '10',
      sortBy: 'amount',
      sortOrder: 'desc',
    }),
    {
      status: 'PENDING',
      page: 2,
      pageSize: 10,
      sortBy: 'amount',
      sortOrder: 'desc',
    },
  )
  assert.equal(invoiceListQuerySchema.safeParse({ pageSize: '101' }).success, false)
  assert.equal(invoiceListQuerySchema.safeParse({ sortBy: 'providerOrderId' }).success, false)
})
