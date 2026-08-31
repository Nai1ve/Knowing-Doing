import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { ProductRepository } from './product-repository.js'
import { PracticeService } from './practice-service.js'
import { TutorEngine } from './tutor.js'
import { WritingService } from './writing-service.js'

const config = loadConfig()
const productRepository = new ProductRepository(config.productDbPath)
const { app, scheduler } = buildApp({ config, practiceServiceFactory: (labScheduler) => new PracticeService(productRepository, labScheduler, new TutorEngine(config)), writingServiceFactory: () => new WritingService(productRepository) })

try {
  await app.listen({ host: config.apiHost, port: config.apiPort })
} catch (error) {
  await scheduler.shutdown()
  app.log.error(error)
  process.exit(1)
}

const shutdown = async () => {
  await scheduler.shutdown()
  productRepository.close()
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
