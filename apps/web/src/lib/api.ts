const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'
).replace(/\/+$/, '')

export class ApiRequestError extends Error {
  readonly status: number
  readonly details?: { path: string; message: string }[]
  readonly meta?: Record<string, string>

  constructor(
    message: string,
    status: number,
    details?: { path: string; message: string }[],
    meta?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.details = details
    this.meta = meta
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `${API_BASE_URL}/${path.replace(/^\/+/, '')}`,
    { ...init, credentials: 'include' },
  )

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as
      | {
          error?: { message?: string; details?: { path: string; message: string }[] }
          meta?: Record<string, string>
        }
      | undefined
    throw new ApiRequestError(
      payload?.error?.message ??
        `API request failed (${response.status}): ${response.statusText}`,
      response.status,
      payload?.error?.details,
      payload?.meta,
    )
  }

  return response.json() as Promise<T>
}
