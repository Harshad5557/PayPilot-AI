import { InvoiceStatus } from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

const MAX_ASSISTANT_INVOICES = 20
const MAX_TEXT_MATCHES = 10

export async function findRelevantInvoicesForAssistant(
  ownerId: string,
  message: string,
) {
  const terms = [...new Set(message.match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 4)
  const matchingRecords = terms.length
    ? await prisma.invoice.findMany({
        where: {
          ownerId,
          OR: terms.flatMap((term) => [
            { title: { contains: term } },
            { counterparty: { contains: term } },
          ]),
        },
        select: {
          id: true,
          title: true,
          counterparty: true,
          amount: true,
          currency: true,
          dueDate: true,
          status: true,
        },
        orderBy: { dueDate: 'asc' },
        take: MAX_TEXT_MATCHES,
      })
    : []

  const activeRecords = await prisma.invoice.findMany({
    where: {
      ownerId,
      status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
    },
    select: {
      id: true,
      title: true,
      counterparty: true,
      amount: true,
      currency: true,
      dueDate: true,
      status: true,
    },
    orderBy: { dueDate: 'asc' },
    take: MAX_ASSISTANT_INVOICES,
  })

  const seen = new Set<string>()
  return [...matchingRecords, ...activeRecords]
    .filter((invoice) => {
      if (seen.has(invoice.id)) return false
      seen.add(invoice.id)
      return true
    })
    .slice(0, MAX_ASSISTANT_INVOICES)
}
