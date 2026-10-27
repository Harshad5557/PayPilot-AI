import { z } from 'zod'

export const assistantMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
}).strict()

export const assistantResponseSchema = z.object({
  intent: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  recommendations: z.array(z.object({
    text: z.string().trim().min(1).max(400),
    invoiceIds: z.array(z.string().min(1).max(128)).max(10),
  }).strict()).max(5),
  requiresClarification: z.boolean(),
  clarificationQuestion: z.string().trim().max(240),
}).strict().refine(
  (response) =>
    response.requiresClarification === (response.clarificationQuestion.length > 0),
  'A clarification question is required only when clarification is needed.',
)

export type AssistantResponse = z.infer<typeof assistantResponseSchema>
