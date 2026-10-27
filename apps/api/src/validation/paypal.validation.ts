import { z } from 'zod'

export const paypalOrderRequestSchema = z.object({
  proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const paypalCaptureRequestSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
}).strict()

export const paymentAttemptIdSchema = z.string().trim().min(1).max(128)

export const paypalOrderResponseSchema = z.object({
  id: z.string().min(1).max(128),
  intent: z.literal('CAPTURE'),
  status: z.literal('CREATED'),
  purchase_units: z.array(z.object({
    reference_id: z.string().min(1).max(128),
    custom_id: z.string().min(1).max(128),
    amount: z.object({
      currency_code: z.string().length(3),
      value: z.string().regex(/^\d+(?:\.\d+)?$/),
    }).strict(),
  }).passthrough()).length(1),
}).passthrough()

export const paypalCaptureResponseSchema = z.object({
  id: z.string().min(1).max(128),
  intent: z.literal('CAPTURE'),
  status: z.enum(['COMPLETED', 'PENDING', 'DECLINED']),
  purchase_units: z.array(z.object({
    reference_id: z.string().min(1).max(128),
    custom_id: z.string().min(1).max(128),
    amount: z.object({
      currency_code: z.string().length(3),
      value: z.string().regex(/^\d+(?:\.\d+)?$/),
    }).passthrough(),
    payments: z.object({
      captures: z.array(z.object({
        id: z.string().min(1).max(128),
        status: z.enum(['COMPLETED', 'PENDING', 'DECLINED']),
        amount: z.object({
          currency_code: z.string().length(3),
          value: z.string().regex(/^\d+(?:\.\d+)?$/),
        }).passthrough(),
      }).passthrough()).length(1),
    }).passthrough(),
  }).passthrough()).length(1),
}).passthrough()
