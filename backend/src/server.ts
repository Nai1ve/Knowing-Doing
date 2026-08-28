import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const { app, scheduler } = buildApp({ config })

try {
  await app.listen({ host: config.apiHost, port: config.apiPort })
} catch (error) {
  await scheduler.shutdown()
  app.log.error(error)
  process.exit(1)
}

const shutdown = async () => {
  await scheduler.shutdown()
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
