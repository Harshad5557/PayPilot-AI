import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'

const WINDOW_MS = 15 * 60_000
const MAX_REQUESTS_PER_WINDOW = 30
const addressWindows = new Map<string, { startedAt: number; count: number }>()

export const authRateLimit: RequestHandler = (request, response, next) => {
  const key = request.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  let window = addressWindows.get(key)
  if (!window || now - window.startedAt >= WINDOW_MS) {
    if (addressWindows.size > 1000) {
      for (const [address, entry] of addressWindows) {
        if (now - entry.startedAt >= WINDOW_MS) addressWindows.delete(address)
      }
    }
    window = { startedAt: now, count: 0 }
    addressWindows.set(key, window)
  }
  if (window.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - window.startedAt)) / 1000))
    response.setHeader('Retry-After', String(retryAfter))
    next(new HttpError('Sign-in request limit reached. Please try again later.', 429, 'AUTH_RATE_LIMITED'))
    return
  }
  window.count += 1
  next()
}
