import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import {
  InvoiceStatus,
  PrismaClient,
} from '../src/generated/prisma/client.js'
import { env } from '../src/config/env.js'

const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function daysFromToday(offset: number) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + offset)
  return date
}

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: 'owner@northstar-studio.example.test' },
    update: { name: 'Northstar Studio (Demo)' },
    create: {
      id: 'seed_northstar_studio_owner',
      email: 'owner@northstar-studio.example.test',
      name: 'Northstar Studio (Demo)',
    },
  })

  const invoices = [
    {
      id: 'seed_northstar_invoice_hosting',
      title: 'DEMO - Cloud hosting, October',
      counterparty: 'Fictional Cloud Hosting Co.',
      amount: 12800,
      dueDate: daysFromToday(-12),
      status: InvoiceStatus.OVERDUE,
    },
    {
      id: 'seed_northstar_invoice_design',
      title: 'DEMO - Product design software',
      counterparty: 'Fictional Design Tools Ltd.',
      amount: 7499,
      dueDate: daysFromToday(7),
      status: InvoiceStatus.PENDING,
    },
    {
      id: 'seed_northstar_invoice_insurance',
      title: 'DEMO - Equipment insurance',
      counterparty: 'Fictional Studio Insurance',
      amount: 24350,
      dueDate: daysFromToday(-30),
      status: InvoiceStatus.PAID,
    },
    {
      id: 'seed_northstar_invoice_workspace',
      title: 'DEMO - Workspace membership',
      counterparty: 'Fictional Harbour Workspace',
      amount: 18000,
      dueDate: daysFromToday(15),
      status: InvoiceStatus.CANCELLED,
    },
  ]

  for (const invoice of invoices) {
    await prisma.invoice.upsert({
      where: { id: invoice.id },
      update: {
        ...invoice,
        currency: 'USD',
        ownerId: owner.id,
      },
      create: {
        ...invoice,
        currency: 'USD',
        ownerId: owner.id,
      },
    })
  }

  const [savedOwner, savedInvoices] = await Promise.all([
    prisma.user.findUnique({ where: { id: owner.id } }),
    prisma.invoice.findMany({
      where: { ownerId: owner.id, id: { in: invoices.map(({ id }) => id) } },
      orderBy: { dueDate: 'asc' },
    }),
  ])

  if (!savedOwner || savedInvoices.length !== invoices.length) {
    throw new Error('Seed verification failed: demo records were not retrieved')
  }

  console.log(
    `Seeded and verified ${savedInvoices.length} fictional invoices for ${savedOwner.name}.`,
  )
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
