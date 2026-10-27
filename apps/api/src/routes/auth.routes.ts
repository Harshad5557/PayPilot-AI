import { Router } from 'express'
import {
  loginController,
  logoutController,
  registerController,
  sessionController,
  updateProfileController,
} from '../controllers/auth.controller.js'
import { authRateLimit } from '../middleware/auth-rate-limit.js'
import { optionalAuthentication, requireAuthentication } from '../middleware/authentication.js'

export const authRouter = Router()

authRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
authRouter.post('/register', authRateLimit, registerController)
authRouter.post('/login', authRateLimit, loginController)
authRouter.get('/session', optionalAuthentication, sessionController)
authRouter.post('/logout', optionalAuthentication, logoutController)
authRouter.patch('/profile', requireAuthentication, updateProfileController)
