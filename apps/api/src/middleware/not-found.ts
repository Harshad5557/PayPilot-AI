import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new HttpError(`Route not found: ${request.method} ${request.path}`, 404))
}
