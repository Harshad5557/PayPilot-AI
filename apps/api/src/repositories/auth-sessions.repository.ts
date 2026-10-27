import { prisma } from '../database/prisma.js'

export function createAuthSession(data: {
  tokenHash: string
  userId: string
  expiresAt: Date
}) {
  return prisma.authSession.create({ data })
}

export function findAuthSession(tokenHash: string, now = new Date()) {
  return prisma.authSession.findFirst({
    where: { tokenHash, expiresAt: { gt: now } },
    include: { user: true },
  })
}

export function deleteAuthSession(id: string) {
  return prisma.authSession.deleteMany({ where: { id } })
}

export function deleteExpiredAuthSessions(now = new Date()) {
  return prisma.authSession.deleteMany({ where: { expiresAt: { lte: now } } })
}
