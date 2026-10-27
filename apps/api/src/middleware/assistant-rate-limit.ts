import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 10
const userWindows = new Map<string, { startedAt: number; count: number }>()

export const assistantRateLimit: RequestHandler = (request, response, next) => {
  const userId = request.user?.id
  if (!userId) {
    next(new HttpError('Authentication is required.', 401))
    return
  }

  const now = Date.now()
  let window = userWindows.get(userId)
  if (!window || now - window.startedAt >= WINDOW_MS) {
    window = { startedAt: now, count: 0 }
    userWindows.set(userId, window)
  }

  if (window.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - window.startedAt)) / 1000))
    response.setHeader('Retry-After', String(retryAfter))
    next(new HttpError(
      'Assistant request limit reached. Please try again shortly.',
      429,
      'ASSISTANT_RATE_LIMITED',
    ))
    return
  }

  window.count += 1
  next()
}
