import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../database/prisma.js'

export function createUser(data: Prisma.UserCreateInput) {
  return prisma.user.create({ data })
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } })
}

export function updateUser(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({ where: { id }, data })
}
