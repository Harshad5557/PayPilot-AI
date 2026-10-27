import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, test } from 'node:test'
import { app } from './app.js'

const server = app.listen(0)
await once(server, 'listening')

after(async () => {
  server.close()
  await once(server, 'close')
})

test('GET /api/health responds with the service health payload', async () => {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.status, 'ok')
  assert.equal(typeof payload.timestamp, 'string')
  assert.ok(Number.isFinite(Date.parse(payload.timestamp)))
})

test('unknown API routes return a centralized not found error', async () => {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  const response = await fetch(`http://127.0.0.1:${address.port}/api/missing`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { message: 'Route not found: GET /api/missing' },
  })
})
