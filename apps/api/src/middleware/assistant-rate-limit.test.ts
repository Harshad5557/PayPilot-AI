import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, test } from 'node:test'
import { assistantRateLimit } from './assistant-rate-limit.js'
import { errorHandler } from './error-handler.js'

const app = express()
const testUserId = `assistant-limit-${randomUUID()}`

app.post(
  '/message',
  (request, _response, next) => {
    request.user = { id: testUserId, email: 'demo@example.test', name: 'Demo' }
    next()
  },
  assistantRateLimit,
  (_request, response) => response.sendStatus(204),
)
app.use(errorHandler)

const server = app.listen(0)
await once(server, 'listening')

after(async () => {
  server.close()
  await once(server, 'close')
})

test('assistant rate limit returns a retry hint after ten requests', async () => {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result: Response = await fetch(`http://127.0.0.1:${address.port}/message`, {
      method: 'POST',
    })
    assert.equal(result.status, 204)
  }

  const limited: Response = await fetch(`http://127.0.0.1:${address.port}/message`, {
    method: 'POST',
  })
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  assert.deepEqual(await limited.json(), {
    error: {
      message: 'Assistant request limit reached. Please try again shortly.',
      code: 'ASSISTANT_RATE_LIMITED',
    },
  })
})
