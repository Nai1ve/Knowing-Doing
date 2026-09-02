import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { ProductRepository } from './product-repository.js'
import { PracticeService } from './practice-service.js'
import { RetrievalService, ZhihuCliProvider } from './retrieval.js'
import { TutorEngine } from './tutor.js'
import { WritingService } from './writing-service.js'
import { CurationService, ModelCurationSummarizer } from './curation-service.js'
import { DeepSeekWritingAgent } from './writing-agent.js'

const config = loadConfig()
const productRepository = new ProductRepository(config.productDbPath)
productRepository.markRunningTutorInvocationsInterrupted()
const retrieval = new RetrievalService(productRepository, new ZhihuCliProvider(config), config.retrievalCacheTtlMs)
const curation = new CurationService(productRepository, new ModelCurationSummarizer(config))
curation.resume()
const writingService = new WritingService(productRepository, curation, new DeepSeekWritingAgent(config))
writingService.resumeGenerations()
const { app, scheduler } = buildApp({
  config,
  practiceServiceFactory: (labScheduler) => new PracticeService(productRepository, labScheduler, new TutorEngine(config), retrieval, curation, (runId) => { writingService.enqueueAutoDraft(runId) }),
  writingServiceFactory: () => writingService,
  runtimeStatus: async () => ({ model: { configured: Boolean(config.modelBaseUrl && config.modelApiKey), name: config.modelName }, zhihu: { configured: Boolean(config.zhihuCliPath), executable: await new ZhihuCliProvider(config).isAvailable(), lastRetrieval: null } }),
})

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
