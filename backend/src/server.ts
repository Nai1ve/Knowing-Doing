import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { ProductRepository } from './product-repository.js'
import { PracticeService } from './practice-service.js'
import { RetrievalService, ZhihuCliProvider } from './retrieval.js'
import { ZhihuOpenApiClient } from './zhihu-openapi.js'
import { AgentPlanningService, DeepSeekPlanningAgent } from './agent-planning.js'
import { TutorEngine } from './tutor.js'
import { WritingService } from './writing-service.js'
import { CurationService, ModelCurationSummarizer } from './curation-service.js'
import { DeepSeekWritingAgent } from './writing-agent.js'
import { PlanningService } from './planning.js'

const config = loadConfig()
const productRepository = new ProductRepository(config.productDbPath)
productRepository.markRunningTutorInvocationsInterrupted()
const retrieval = new RetrievalService(productRepository, new ZhihuCliProvider(config), config.retrievalCacheTtlMs)
const curation = new CurationService(productRepository, new ModelCurationSummarizer(config))
curation.resume()
const writingService = new WritingService(productRepository, curation, new DeepSeekWritingAgent(config))
writingService.resumeGenerations()
const planningService = new PlanningService(productRepository, { resumeStoragePath: config.resumeStoragePath, resumeMaxBytes: config.resumeMaxBytes })
const zhihuOpenApi = new ZhihuOpenApiClient({ accessSecret: config.zhihuAccessSecret, baseUrl: config.zhihuApiBaseUrl, timeoutMs: config.retrievalTimeoutMs })
const agentPlanningService = new AgentPlanningService(productRepository, new DeepSeekPlanningAgent(config), { modelName: config.modelName }, zhihuOpenApi)
const { app, scheduler } = buildApp({
  config,
  practiceServiceFactory: (labScheduler) => new PracticeService(productRepository, labScheduler, new TutorEngine(config), retrieval, curation, (runId) => { planningService.markLabVerified(runId); writingService.enqueueAutoDraft(runId) }),
  writingServiceFactory: () => writingService,
  planningServiceFactory: () => planningService,
  agentPlanningServiceFactory: () => agentPlanningService,
  runtimeStatus: async () => ({ model: { configured: Boolean(config.modelBaseUrl && config.modelApiKey), name: config.modelName }, zhihu: { configured: Boolean(config.zhihuAccessSecret), executable: Boolean(config.zhihuAccessSecret), lastRetrieval: null } }),
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
