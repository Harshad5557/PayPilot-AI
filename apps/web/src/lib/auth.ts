import { apiRequest } from './api'

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  createdAt: string
}

interface AuthResponse {
  data: AuthenticatedUser
  expiresAt?: string
}

export interface AuthSessionResponse {
  data: AuthenticatedUser | null
  authMode: 'session' | 'demo' | null
}

export function getAuthSession() {
  return apiRequest<AuthSessionResponse>('auth/session')
}

export async function registerAccount(input: {
  email: string
  name: string
  password: string
}) {
  const response = await apiRequest<AuthResponse>('auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

export async function loginAccount(input: { email: string; password: string }) {
  const response = await apiRequest<AuthResponse>('auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

export async function updateAccountProfile(input: { email: string; name: string }) {
  const response = await apiRequest<{ data: AuthenticatedUser }>('auth/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

export function logoutAccount() {
  return apiRequest<{ data: null }>('auth/logout', { method: 'POST' })
}
