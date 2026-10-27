import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, test } from 'node:test'
import supertest from 'supertest'
import { app } from './app.js'
import { prisma } from './database/prisma.js'

const server = app.listen(0)
await once(server, 'listening')
const client = supertest.agent(server)

after(async () => {
  await prisma.authSession.deleteMany({
    where: { user: { email: { startsWith: 'auth-test-' } } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'auth-test-' } } })
  server.close()
  await once(server, 'close')
  await prisma.$disconnect()
})

test('registration, sign-in, profile update, and sign-out use persisted secure sessions', async () => {
  const email = `auth-test-${randomUUID()}@example.test`
  const password = 'fictional-test-password-123'
  const registration = await client
    .post('/api/auth/register')
    .send({ name: 'Auth Test User', email: email.toUpperCase(), password })

  assert.equal(registration.status, 201)
  assert.equal(registration.body.data.email, email)
  assert.equal('passwordHash' in registration.body.data, false)
  const cookie = registration.headers['set-cookie']?.[0]
  assert.match(cookie ?? '', /HttpOnly/i)
  assert.match(cookie ?? '', /SameSite=Strict/i)

  const user = await prisma.user.findUnique({ where: { email } })
  assert.ok(user?.passwordHash)
  assert.notEqual(user.passwordHash, password)
  const storedSession = await prisma.authSession.findFirst({ where: { userId: user.id } })
  assert.ok(storedSession)
  assert.match(storedSession.tokenHash, /^[a-f0-9]{64}$/)

  const session = await client.get('/api/auth/session')
  assert.equal(session.body.data.id, user.id)

  const privateInvoices = await client.get('/api/invoices')
  assert.equal(privateInvoices.status, 200)
  assert.deepEqual(privateInvoices.body.data, [])
  assert.equal(privateInvoices.body.pagination.total, 0)

  const updatedEmail = email.replace('auth-test-', 'auth-test-updated-')
  const updated = await client
    .patch('/api/auth/profile')
    .set('Origin', 'http://localhost:5173')
    .send({ email: updatedEmail, name: 'Updated Auth Test User' })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.data.email, updatedEmail)
  assert.equal(updated.body.data.name, 'Updated Auth Test User')

  const duplicate = await client
    .post('/api/auth/register')
    .send({ name: 'Duplicate', email: updatedEmail, password })
  assert.equal(duplicate.status, 409)

  const logout = await client
    .post('/api/auth/logout')
    .set('Origin', 'http://localhost:5173')
  assert.equal(logout.status, 200)
  assert.equal((await client.get('/api/auth/session')).body.data, null)
  assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 0)

  const login = await client.post('/api/auth/login').send({ email: updatedEmail, password })
  assert.equal(login.status, 200)
  assert.equal((await client.get('/api/auth/session')).body.data.id, user.id)

  const invalidLogin = await client
    .post('/api/auth/login')
    .send({ email: updatedEmail, password: 'incorrect-password' })
  assert.equal(invalidLogin.status, 401)

  const invalidRegistration = await supertest(server)
    .post('/api/auth/register')
    .send({ name: 'Weak Password', email: `weak-${email}`, password: 'short' })
  assert.equal(invalidRegistration.status, 400)
})

test('profile changes reject requests from a different origin', async () => {
  const email = `auth-test-${randomUUID()}@example.test`
  const clientForUser = supertest.agent(server)
  await clientForUser
    .post('/api/auth/register')
    .send({ name: 'Origin Test User', email, password: 'fictional-test-password-456' })

  const response = await clientForUser
    .patch('/api/auth/profile')
    .set('Origin', 'https://untrusted.example')
    .send({ email, name: 'Changed' })
  assert.equal(response.status, 403)
  assert.equal((await prisma.user.findUnique({ where: { email } }))?.name, 'Origin Test User')
})
