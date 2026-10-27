import { Router } from 'express'
import { getHealth } from '../services/health.service.js'

export const healthRouter = Router()

healthRouter.get('/health', (_request, response) => {
  response.status(200).json(getHealth())
})
