import { Router } from 'express'
import {
  cancelPayPalAttemptController,
  capturePayPalAttemptController,
  getPayPalConfigController,
  getPaymentAttemptController,
  reconcilePayPalAttemptController,
} from '../controllers/payments.controller.js'
import { requireAuthentication } from '../middleware/authentication.js'

export const paymentsRouter = Router()

paymentsRouter.use(requireAuthentication)
paymentsRouter.get('/config', getPayPalConfigController)
paymentsRouter.get('/attempts/:id', getPaymentAttemptController)
paymentsRouter.post('/attempts/:id/capture', capturePayPalAttemptController)
paymentsRouter.post('/attempts/:id/cancel', cancelPayPalAttemptController)
paymentsRouter.post('/attempts/:id/reconcile', reconcilePayPalAttemptController)
