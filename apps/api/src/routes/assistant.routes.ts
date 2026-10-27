import { Router } from 'express'
import { assistantMessageController } from '../controllers/assistant.controller.js'
import { assistantRateLimit } from '../middleware/assistant-rate-limit.js'
import { requireAuthentication } from '../middleware/authentication.js'

export const assistantRouter = Router()

assistantRouter.post(
  '/message',
  requireAuthentication,
  assistantRateLimit,
  assistantMessageController,
)
