import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../errors/http-error.js'

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }

  const malformedJson =
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400
  const oversizedBody =
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 413
  const statusCode = error instanceof HttpError
    ? error.statusCode
    : error instanceof ZodError || malformedJson
      ? 400
      : oversizedBody
        ? 413
      : 500

  if (statusCode >= 500) {
    console.error(error)
  }

  response.status(statusCode).json({
    error: {
      message: error instanceof HttpError
        ? error.message
        : error instanceof ZodError
          ? 'Request validation failed.'
          : malformedJson
            ? 'Request body contains invalid JSON.'
            : oversizedBody
              ? 'Request body exceeds the allowed size.'
            : 'Internal server error',
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
      ...(error instanceof HttpError && error.meta ? { meta: error.meta } : {}),
      ...(error instanceof ZodError
        ? { details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })) }
        : {}),
    },
  })
}
