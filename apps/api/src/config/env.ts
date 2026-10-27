import 'dotenv/config'
import { z } from 'zod'

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DEMO_IDENTITY_ENABLED: z.enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  GEMINI_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-flash-latest'),
  PAYPAL_CLIENT_ID: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  PAYPAL_CLIENT_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
}).superRefine((value, context) => {
  if (Boolean(value.PAYPAL_CLIENT_ID) !== Boolean(value.PAYPAL_CLIENT_SECRET)) {
    context.addIssue({
      code: 'custom',
      message: 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be configured together.',
    })
  }
})

export const env = environmentSchema.parse(process.env)
