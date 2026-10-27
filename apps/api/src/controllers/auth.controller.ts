import type { RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import {
  authenticateAccount,
  createSession,
  registerAccount,
  revokeSession,
  updateAccount,
} from '../services/auth.service.js'
import { loginSchema, registerAccountSchema, updateProfileSchema } from '../validation/auth.validation.js'

const SESSION_COOKIE_NAME = 'paypilot_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000

function setSessionCookie(response: Response, token: string) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; Max-Age=${SESSION_DURATION_MS / 1000}; Path=/api; HttpOnly; SameSite=Strict${secure}`,
  )
}

function clearSessionCookie(response: Response) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/api; HttpOnly; SameSite=Strict${secure}`,
  )
}

function requireUser(request: Express.Request) {
  if (!request.user) throw new HttpError('Authentication is required.', 401)
  return request.user
}

export const registerController: RequestHandler = async (request, response) => {
  const input = registerAccountSchema.parse(request.body)
  const user = await registerAccount(input)
  const session = await createSession(user.id)
  setSessionCookie(response, session.token)
  response.status(201).json({ data: user, expiresAt: session.expiresAt.toISOString() })
}

export const loginController: RequestHandler = async (request, response) => {
  const input = loginSchema.parse(request.body)
  const user = await authenticateAccount(input.email, input.password)
  const session = await createSession(user.id)
  setSessionCookie(response, session.token)
  response.status(200).json({ data: user, expiresAt: session.expiresAt.toISOString() })
}

export const sessionController: RequestHandler = (request, response) => {
  response.status(200).json({
    data: request.user ?? null,
    authMode: request.authMode ?? null,
  })
}

export const logoutController: RequestHandler = async (request, response) => {
  if (request.authSessionId) await revokeSession(request.authSessionId)
  clearSessionCookie(response)
  response.status(200).json({ data: null })
}

export const updateProfileController: RequestHandler = async (request, response) => {
  const input = updateProfileSchema.parse(request.body)
  const user = await updateAccount(requireUser(request).id, input)
  response.status(200).json({ data: user })
}
