import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

export function createAuditEvent(data: Prisma.AuditEventCreateInput) {
  return prisma.auditEvent.create({ data })
}

export function listAuditEventsByOwner(ownerId: string) {
  return prisma.auditEvent.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  })
}
