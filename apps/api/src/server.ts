import { app } from './app.js'
import { env } from './config/env.js'

const server = app.listen(env.PORT, () => {
  console.log(`PayPilot API listening on port ${env.PORT}`)
})

server.on('error', (error) => {
  console.error('Failed to start PayPilot API', error)
  process.exitCode = 1
})
