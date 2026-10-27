import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import { sendAssistantMessage } from '../services/assistant.service.js'
import { assistantMessageSchema } from '../validation/assistant.validation.js'

export const assistantMessageController: RequestHandler = async (
  request,
  response,
) => {
  if (!request.user) {
    throw new HttpError('Authentication is required.', 401)
  }
  const { message } = assistantMessageSchema.parse(request.body)
  const data = await sendAssistantMessage(request.user.id, message)
  response.status(200).json({ data })
}
