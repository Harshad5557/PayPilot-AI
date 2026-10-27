export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly meta?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
