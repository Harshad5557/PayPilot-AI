import supertest from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from '../../apps/api/src/app.js'

describe('PayPilot HTTP API', () => {
  it('returns a healthy service response', async () => {
    const response = await supertest(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(Number.isFinite(Date.parse(response.body.timestamp))).toBe(true)
  })

  it('returns the centralized JSON error for malformed request bodies', async () => {
    const response = await supertest(app)
      .post('/api/invoices')
      .set('Content-Type', 'application/json')
      .send('{"title":')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: { message: 'Request body contains invalid JSON.' },
    })
  })

  it('returns a consistent not-found response for unknown API routes', async () => {
    const response = await supertest(app).get('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.error.message).toMatch(/Route not found/)
  })
})
