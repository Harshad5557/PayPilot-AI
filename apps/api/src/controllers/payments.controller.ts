import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import {
  cancelPayPalAttempt,
  capturePayPalAttempt,
  getPayPalConfiguration,
  getPaymentAttempt,
  reconcilePayPalAttempt,
} from '../services/paypal-payments.service.js'
import {
  paymentAttemptIdSchema,
  paypalCaptureRequestSchema,
} from '../validation/paypal.validation.js'

function ownerId(request: Express.Request) {
  if (!request.user) {
    throw new HttpError('Authentication is required.', 401)
  }
  return request.user.id
}

export const getPayPalConfigController: RequestHandler = async (_request, response) => {
  response.status(200).json({ data: await getPayPalConfiguration() })
}

export const getPaymentAttemptController: RequestHandler = async (request, response) => {
  const id = paymentAttemptIdSchema.parse(request.params['id'])
  response.status(200).json({ data: await getPaymentAttempt(ownerId(request), id) })
}

export const capturePayPalAttemptController: RequestHandler = async (request, response) => {
  const id = paymentAttemptIdSchema.parse(request.params['id'])
  const input = paypalCaptureRequestSchema.parse(request.body)
  const result = await capturePayPalAttempt(ownerId(request), id, input.orderId)
  const { processing, ...data } = result
  response.status(processing ? 202 : 200).json({
    data,
    notice: processing
      ? 'Capture is still processing. Refresh the payment attempt status.'
      : undefined,
  })
}

export const cancelPayPalAttemptController: RequestHandler = async (request, response) => {
  const id = paymentAttemptIdSchema.parse(request.params['id'])
  response.status(200).json({ data: await cancelPayPalAttempt(ownerId(request), id) })
}

export const reconcilePayPalAttemptController: RequestHandler = async (request, response) => {
  const id = paymentAttemptIdSchema.parse(request.params['id'])
  const result = await reconcilePayPalAttempt(ownerId(request), id)
  const { processing, ...data } = result
  response.status(processing ? 202 : 200).json({
    data,
    notice: processing
      ? 'Provider status is still unresolved. Refresh the payment attempt before taking further action.'
      : undefined,
  })
}
