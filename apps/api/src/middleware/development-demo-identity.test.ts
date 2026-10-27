import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { after, test } from 'node:test'
import { errorHandler } from './error-handler.js'
import {
  createDevelopmentDemoIdentity,
  isLoopbackAddress,
} from './development-demo-identity.js'

const app = express()
app.get('/production', createDevelopmentDemoIdentity('production', true), (_request, response) => {
  response.status(200).json({ data: 'protected' })
})
app.get('/disabled', createDevelopmentDemoIdentity('development', false), (_request, response) => {
  response.status(200).json({ data: 'protected' })
})
app.get('/unset', createDevelopmentDemoIdentity('', true), (_request, response) => {
  response.status(200).json({ data: 'protected' })
})
app.get('/unknown', createDevelopmentDemoIdentity('produciton', true), (_request, response) => {
  response.status(200).json({ data: 'protected' })
})
app.use(errorHandler)

const server = app.listen(0)
await once(server, 'listening')

after(async () => {
  server.close()
  await once(server, 'close')
})

test('demo identity refuses access unless explicitly enabled in development', async () => {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  for (const path of ['/production', '/disabled', '/unset', '/unknown']) {
    const response: Response = await fetch(`http://127.0.0.1:${address.port}${path}`)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      error: { message: 'Authentication is required for this resource.' },
    })
  }
})

test('demo identity loopback check does not trust forwarded client headers', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.0.2.10'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})
