import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { authRouter } from './auth.routes.js'
import { invoicesRouter } from './invoices.routes.js'
import { assistantRouter } from './assistant.routes.js'
import { paymentPlansRouter } from './payment-plans.routes.js'
import { paymentsRouter } from './payments.routes.js'

export const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/invoices', invoicesRouter)
apiRouter.use('/assistant', assistantRouter)
apiRouter.use('/payment-plans', paymentPlansRouter)
apiRouter.use('/payments', paymentsRouter)
