import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { InvoiceStatus } from './generated/prisma/client.js'
import { app } from './app.js'
import { prisma } from './database/prisma.js'
import { createInvoice } from './repositories/invoices.repository.js'

const ownerEmail = 'owner@northstar-studio.example.test'
const server = app.listen(0)
await once(server, 'listening')

const createdInvoiceIds: string[] = []
let ownerId = ''

before(async () => {
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      id: 'seed_northstar_studio_owner',
      email: ownerEmail,
      name: 'Northstar Studio (Demo)',
    },
  })
  ownerId = owner.id
})

after(async () => {
  await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } })
  server.close()
  await once(server, 'close')
  await prisma.$disconnect()
})

async function request(path: string, init?: RequestInit) {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return fetch(`http://127.0.0.1:${address.port}${path}`, init)
}

async function createViaApi(overrides: Record<string, unknown> = {}) {
  const response = await request('/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'DEMO - API test invoice',
      counterparty: 'Fictional API Test Supplier',
      amountMinor: 45678,
      currency: 'USD',
      dueDate: '2026-12-15',
      ...overrides,
    }),
  })
  const payload = await response.json()
  if (response.ok) createdInvoiceIds.push(payload.data.id as string)
  return { response, payload }
}

test('invoice endpoints list, create, retrieve, and update owner records', async () => {
  const { response: created, payload } = await createViaApi()
  assert.equal(created.status, 201)
  assert.equal(payload.data.status, InvoiceStatus.PENDING)
  assert.equal(payload.data.amountMinor, 45678)
  assert.equal(payload.data.currency, 'USD')
  assert.equal(payload.data.dueDate, '2026-12-15T00:00:00.000Z')
  assert.equal('ownerId' in payload.data, false)
  assert.match(payload.data.title, /^DEMO - /)

  const id = payload.data.id as string
  const fetched = await request(`/api/invoices/${id}`)
  assert.equal(fetched.status, 200)
  assert.equal((await fetched.json()).data.id, id)

  const listed = await request('/api/invoices?search=API%20test&sortBy=amount&sortOrder=desc&page=1&pageSize=2')
  assert.equal(listed.status, 200)
  const listPayload = await listed.json()
  assert.ok(listPayload.data.some((invoice: { id: string }) => invoice.id === id))
  assert.equal(listPayload.pagination.page, 1)
  assert.equal(listPayload.pagination.pageSize, 2)

  const updated = await request(`/api/invoices/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'DEMO - Updated test invoice', amountMinor: 50000 }),
  })
  assert.equal(updated.status, 200)
  const updatedData = (await updated.json()).data
  assert.equal(updatedData.title, 'DEMO - Updated test invoice')
  assert.equal(updatedData.amountMinor, 50000)
  assert.equal(updatedData.status, InvoiceStatus.PENDING)

  const { response: yenCreated } = await createViaApi({
    title: 'DEMO - Yen test invoice',
    currency: 'JPY',
    amountMinor: 1200,
  })
  assert.equal(yenCreated.status, 201)

  const afterYen = await request('/api/invoices')
  const summary = (await afterYen.json()).summary
  assert.equal(summary.outstandingByCurrency.JPY, 1200)
})

test('invoice request validation rejects invalid amounts, currencies, dates, and fields', async () => {
  for (const input of [
    { amountMinor: 0 },
    { amountMinor: 1.5 },
    { currency: 'ZZZ' },
    { dueDate: '2026-02-30' },
    { status: InvoiceStatus.PAID },
  ]) {
    const { response, payload } = await createViaApi(input)
    assert.equal(response.status, 400)
    assert.equal(payload.error.message, 'Request validation failed.')
    assert.ok(Array.isArray(payload.error.details))
  }

  const emptyPatch = await request('/api/invoices/does-not-matter', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(emptyPatch.status, 400)

  const malformedJson = await request('/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title":',
  })
  assert.equal(malformedJson.status, 400)
  assert.deepEqual(await malformedJson.json(), {
    error: { message: 'Request body contains invalid JSON.' },
  })

  const invalidStatus = await request('/api/invoices?status=UNKNOWN')
  assert.equal(invalidStatus.status, 400)
})

test('invoice routes do not reveal another owner record and paid records are immutable', async () => {
  const otherOwner = await prisma.user.create({
    data: {
      email: `other-owner-${randomUUID()}@example.test`,
      name: 'Fictional Other Owner',
    },
  })
  const privateInvoice = await createInvoice({
    ownerId: otherOwner.id,
    id: `private-${randomUUID()}`,
    title: 'DEMO - Private invoice',
    counterparty: 'Fictional Private Supplier',
    amount: 12000,
    currency: 'USD',
    dueDate: new Date('2026-12-20T00:00:00.000Z'),
    status: InvoiceStatus.PENDING,
  })
  const paidInvoice = await createInvoice({
    ownerId,
    id: `paid-${randomUUID()}`,
    title: 'DEMO - Immutable paid invoice',
    counterparty: 'Fictional Paid Supplier',
    amount: 8000,
    currency: 'USD',
    dueDate: new Date('2026-12-20T00:00:00.000Z'),
    status: InvoiceStatus.PAID,
  })
  createdInvoiceIds.push(paidInvoice.id)

  try {
    const hidden = await request(`/api/invoices/${privateInvoice.id}`, {
      headers: { 'x-paypilot-demo-user': otherOwner.id },
    })
    assert.equal(hidden.status, 404)
    assert.deepEqual(await hidden.json(), {
      error: { message: 'Invoice not found.' },
    })

    const updatePaid = await request(`/api/invoices/${paidInvoice.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Not allowed' }),
    })
    assert.equal(updatePaid.status, 409)
    assert.match((await updatePaid.json()).error.message, /paid status cannot be edited/)

    const deleteResponse = await request(`/api/invoices/${paidInvoice.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleteResponse.status, 404)
  } finally {
    await prisma.user.delete({ where: { id: otherOwner.id } })
  }
})

test('missing invoices return the standard not found response', async () => {
  const response = await request('/api/invoices/not-a-real-invoice')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { message: 'Invoice not found.' },
  })
})
