import type { Request, RequestHandler } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { findUserByEmail } from '../repositories/users.repository.js'
import { getSession, hashSessionToken } from '../services/auth.service.js'

export interface RequestUser {
  id: string
  email: string
  name: string
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser
      authSessionId?: string
      authMode?: 'session' | 'demo'
    }
  }
}

const SESSION_COOKIE_NAME = 'paypilot_session'

export function isLoopbackAddress(address: string | undefined) {
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
}

function sessionToken(request: Request) {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`))
  const token = cookie?.slice(SESSION_COOKIE_NAME.length + 1)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined
}

export async function loadAuthenticatedUser(request: Request) {
  const token = sessionToken(request)
  if (token) {
    const session = await getSession(hashSessionToken(token))
    if (session) {
      request.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      }
      request.authSessionId = session.id
      request.authMode = 'session'
      return
    }
  }
  if (
    (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') &&
    env.DEMO_IDENTITY_ENABLED &&
    isLoopbackAddress(request.socket.remoteAddress)
  ) {
    const user = await findUserByEmail('owner@northstar-studio.example.test')
    if (user) {
      request.user = { id: user.id, email: user.email, name: user.name }
      request.authMode = 'demo'
    }
  }
}

export const optionalAuthentication: RequestHandler = async (request, _response, next) => {
  try {
    const token = sessionToken(request)
    if (token) {
      const session = await getSession(hashSessionToken(token))
      if (session) {
        request.user = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }
        request.authSessionId = session.id
        request.authMode = 'session'
      }
    }
    next()
  } catch (error) {
    next(error)
  }
}

export const requireAuthentication: RequestHandler = async (request, _response, next) => {
  try {
    await loadAuthenticatedUser(request)
    if (!request.user) {
      next(new HttpError('Authentication is required for this resource.', 401))
      return
    }
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.method !== 'OPTIONS' &&
      request.headers.origin &&
      request.headers.origin !== new URL(env.CORS_ORIGIN).origin
    ) {
      next(new HttpError('Request origin is not allowed.', 403, 'INVALID_ORIGIN'))
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}
