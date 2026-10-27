import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { findUserByEmail } from '../repositories/users.repository.js'
import { requireAuthentication } from './authentication.js'

export function isLoopbackAddress(address: string | undefined) {
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
}

export function createDevelopmentDemoIdentity(
  nodeEnv: string = env.NODE_ENV,
  demoIdentityEnabled = env.DEMO_IDENTITY_ENABLED,
): RequestHandler {
  return async (request, _response, next) => {
    if (
      (nodeEnv !== 'development' && nodeEnv !== 'test') ||
      !demoIdentityEnabled ||
      !isLoopbackAddress(request.socket.remoteAddress)
    ) {
      next(new HttpError('Authentication is required for this resource.', 401))
      return
    }

    const user = await findUserByEmail('owner@northstar-studio.example.test')
    if (!user) {
      next(new HttpError('Demo identity is unavailable. Seed the database first.', 503))
      return
    }

    request.user = { id: user.id, email: user.email, name: user.name }
    next()
  }
}

export const developmentDemoIdentity = requireAuthentication
