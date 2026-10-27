import { z } from 'zod'

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase())
const nameSchema = z.string().trim().min(1).max(120)

export const registerAccountSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: z.string().min(12).max(128),
}).strict()

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict()

export const updateProfileSchema = z.object({
  email: emailSchema,
  name: nameSchema,
}).strict()
