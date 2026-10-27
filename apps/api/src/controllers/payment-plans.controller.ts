import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import {
  approvePaymentPlan,
  createPaymentPlan,
  getPaymentPlan,
  rejectPaymentPlan,
  validatePaymentPlan,
} from '../services/payment-plans.service.js'
import { createApprovedPayPalOrder } from '../services/paypal-payments.service.js'
import {
  approvePaymentPlanSchema,
  createPaymentPlanSchema,
  paymentPlanIdSchema,
  rejectPaymentPlanSchema,
  validatePaymentPlanSchema,
} from '../validation/payment-plan.validation.js'
import { paypalOrderRequestSchema } from '../validation/paypal.validation.js'

function ownerId(request: Express.Request) {
  if (!request.user) {
    throw new HttpError('Authentication is required.', 401)
  }
  return request.user.id
}

export const createPaymentPlanController: RequestHandler = async (request, response) => {
  const input = createPaymentPlanSchema.parse(request.body)
  const plan = await createPaymentPlan(ownerId(request), input.invoiceIds)
  response.status(201).json({ data: plan })
}

export const getPaymentPlanController: RequestHandler = async (request, response) => {
  const id = paymentPlanIdSchema.parse(request.params['id'])
  const plan = await getPaymentPlan(ownerId(request), id)
  response.status(200).json({ data: plan })
}

export const validatePaymentPlanController: RequestHandler = async (request, response) => {
  const id = paymentPlanIdSchema.parse(request.params['id'])
  const input = validatePaymentPlanSchema.parse(request.body)
  const result = await validatePaymentPlan(ownerId(request), id, input.proposalVersion)
  response.status(200).json({ data: result })
}

export const approvePaymentPlanController: RequestHandler = async (request, response) => {
  const id = paymentPlanIdSchema.parse(request.params['id'])
  const input = approvePaymentPlanSchema.parse(request.body)
  const plan = await approvePaymentPlan(ownerId(request), id, input)
  response.status(200).json({
    data: plan,
    notice: 'Approval recorded only. No payment was initiated or captured.',
  })
}

export const rejectPaymentPlanController: RequestHandler = async (request, response) => {
  const id = paymentPlanIdSchema.parse(request.params['id'])
  const input = rejectPaymentPlanSchema.parse(request.body)
  const plan = await rejectPaymentPlan(
    ownerId(request),
    id,
    input.proposalVersion,
    input.reason,
  )
  response.status(200).json({ data: plan })
}

export const createPayPalOrderController: RequestHandler = async (request, response) => {
  const id = paymentPlanIdSchema.parse(request.params['id'])
  const input = paypalOrderRequestSchema.parse(request.body)
  const attempt = await createApprovedPayPalOrder(
    ownerId(request),
    id,
    input.proposalVersion,
  )
  response.status(200).json({ data: attempt })
}
