import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto'
import type { User } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import {
  createAuthSession,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  findAuthSession,
} from '../repositories/auth-sessions.repository.js'
import { createUser, findUserByEmail, updateUser } from '../repositories/users.repository.js'

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
let dummyPasswordHash: Promise<string> | undefined

export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'createdAt'>

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }
}

function derivePasswordKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derivePasswordKey(password, salt)
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`
}

async function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false
  const parts = storedHash.split('$')
  const saltHex = parts[4]
  const keyHex = parts[5]
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== '16384' ||
    parts[2] !== '8' ||
    parts[3] !== '1' ||
    !saltHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !keyHex ||
    !/^[a-f0-9]{128}$/i.test(keyHex)
  ) {
    return false
  }
  const expected = Buffer.from(keyHex, 'hex')
  const actual = await derivePasswordKey(password, Buffer.from(saltHex, 'hex'))
  return timingSafeEqual(actual, expected)
}

function isUniqueConstraintError(error: unknown) {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002'
}

export async function registerAccount(input: {
  email: string
  name: string
  password: string
}) {
  const existing = await findUserByEmail(input.email)
  if (existing) {
    throw new HttpError('An account with this email already exists.', 409, 'EMAIL_ALREADY_REGISTERED')
  }

  const passwordHash = await hashPassword(input.password)
  try {
    const user = await createUser({
      email: input.email,
      name: input.name,
      passwordHash,
    })
    return toPublicUser(user)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError('An account with this email already exists.', 409, 'EMAIL_ALREADY_REGISTERED')
    }
    throw error
  }
}

export async function authenticateAccount(email: string, password: string) {
  const user = await findUserByEmail(email)
  if (!user || !user.passwordHash) {
    dummyPasswordHash ??= hashPassword('paypilot-invalid-account-password')
    await verifyPassword(password, await dummyPasswordHash)
    throw new HttpError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS')
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS')
  }
  return toPublicUser(user)
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  await deleteExpiredAuthSessions()
  await createAuthSession({
    userId,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt,
  })
  return { token, expiresAt }
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function getSession(tokenHash: string) {
  return findAuthSession(tokenHash)
}

export function revokeSession(id: string) {
  return deleteAuthSession(id)
}

export async function updateAccount(
  userId: string,
  input: { email: string; name: string },
) {
  try {
    const user = await updateUser(userId, input)
    return toPublicUser(user)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError('An account with this email already exists.', 409, 'EMAIL_ALREADY_REGISTERED')
    }
    throw error
  }
}
