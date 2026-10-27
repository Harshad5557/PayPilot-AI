import { Router } from 'express'
import {
  approvePaymentPlanController,
  createPayPalOrderController,
  createPaymentPlanController,
  getPaymentPlanController,
  rejectPaymentPlanController,
  validatePaymentPlanController,
} from '../controllers/payment-plans.controller.js'
import { requireAuthentication } from '../middleware/authentication.js'

export const paymentPlansRouter = Router()

paymentPlansRouter.use(requireAuthentication)
paymentPlansRouter.post('/', createPaymentPlanController)
paymentPlansRouter.post('/:id/order', createPayPalOrderController)
paymentPlansRouter.get('/:id', getPaymentPlanController)
paymentPlansRouter.post('/:id/validate', validatePaymentPlanController)
paymentPlansRouter.post('/:id/approve', approvePaymentPlanController)
paymentPlansRouter.post('/:id/reject', rejectPaymentPlanController)
