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
import { CaseWorkspaceService } from './case-workspace-service.js'
import { FixtureCaseBuilder, StagedModelCaseBuilder } from './case-builder.js'
import { FakeWorkspaceRunnerClient, HttpWorkspaceRunnerClient } from './workspace-runner-client.js'
import { DockerWorkspaceRuntimeAdapter } from './runtime-adapter.js'
import { WorkspaceCompletionService } from './workspace-completion-service.js'
import { SourceSnapshotService, ZhihuSourceContentProvider } from './case-source-snapshot.js'
import { MySqlDynamicCaseService } from './mysql-dynamic-case-service.js'
import { EnvironmentBuildOrchestrator } from './gym-build-service.js'
import { HttpOpenHandsBuildAdapter } from './openhands-build-adapter.js'
import { EnvironmentRuntimeReferenceService } from './environment-runtime-reference.js'
import { MySqlLabStore } from './mysql-store.js'
import { EnvironmentBoundMySqlStore } from './environment-bound-mysql-store.js'
import { IdentityService } from './identity-service.js'
import { ZhihuGateway } from './zhihu-gateway.js'
import { MixedGymService } from './mixed-gym-service.js'
import { DeepSeekPracticeCardGenerator } from './practice-card-generator.js'

const config = loadConfig()
const productRepository = new ProductRepository(config.productDbPath)
const identityService = new IdentityService(productRepository)
const zhihuOpenApi = new ZhihuOpenApiClient({ accessSecret: config.zhihuAccessSecret, baseUrl: config.zhihuApiBaseUrl, timeoutMs: config.retrievalTimeoutMs, articlePath: config.zhihuArticlePath })
const zhihuGateway = new ZhihuGateway(productRepository, { clientId: config.zhihuOauthClientId, clientSecret: config.zhihuOauthClientSecret, baseUrl: config.zhihuOauthBaseUrl, encryptionKey: config.oauthTokenEncryptionKey, allowInsecureCallback: config.allowInsecureOauthCallback, authorizePath: config.zhihuOauthAuthorizePath, tokenPath: config.zhihuOauthTokenPath, userPath: config.zhihuUserPath, collectionsPath: config.zhihuCollectionsPath, collectionItemsPath: config.zhihuCollectionItemsPath, contentPath: config.zhihuContentPath, momentsPath: config.zhihuMomentsPath, redirectUri: config.zhihuOauthRedirectUri, scopes: config.zhihuOauthScopes, publicSearch: zhihuOpenApi })
if (config.zhihuSourceSyncEnabled) zhihuGateway.resume()
productRepository.markRunningTutorInvocationsInterrupted()
const retrieval = new RetrievalService(productRepository, new ZhihuCliProvider(config), config.retrievalCacheTtlMs)
const curation = new CurationService(productRepository, new ModelCurationSummarizer(config))
curation.resume()
const writingService = new WritingService(productRepository, curation, new DeepSeekWritingAgent(config))
writingService.resumeGenerations()
const planningService = new PlanningService(productRepository, { resumeStoragePath: config.resumeStoragePath, resumeMaxBytes: config.resumeMaxBytes })
const agentPlanningService = new AgentPlanningService(productRepository, new DeepSeekPlanningAgent(config), { modelName: config.modelName, plannerAssessmentV2Enabled: config.plannerAssessmentV2Enabled }, zhihuOpenApi)
agentPlanningService.recoverRoadmapGenerations()
const workspaceRunner = config.workspaceRunnerFake
  ? new FakeWorkspaceRunnerClient()
  : new HttpWorkspaceRunnerClient(config.workspaceRunnerUrl, config.workspaceRunnerToken, config.workspaceRunnerTimeoutMs)
const workspaceRuntime = new DockerWorkspaceRuntimeAdapter(workspaceRunner)
const caseBuilder = config.caseBuilderProvider === 'model' ? new StagedModelCaseBuilder(config) : new FixtureCaseBuilder()
const workspaceCompletion = new WorkspaceCompletionService(productRepository, planningService, (runId) => { writingService.enqueueAutoDraft(runId) })
const sourceSnapshots = new SourceSnapshotService(productRepository.db, new ZhihuSourceContentProvider(zhihuOpenApi))
const environmentRuntimeReferences = new EnvironmentRuntimeReferenceService(productRepository.db, config.environmentRuntimeSigningKey, config.environmentRuntimeReferenceTtlMs)
const caseWorkspaceService = new CaseWorkspaceService(productRepository, caseBuilder, workspaceRuntime, workspaceCompletion, undefined, sourceSnapshots, environmentRuntimeReferences)
const openHandsAdapter = config.caseBuilderEnabled
  ? new HttpOpenHandsBuildAdapter({ baseUrl: config.caseBuilderUrl, token: config.caseBuilderToken, timeoutMs: config.caseBuilderRequestTimeoutMs })
  : null
const labStore = openHandsAdapter
  ? new EnvironmentBoundMySqlStore(new MySqlLabStore(config), productRepository.db, openHandsAdapter, config.runLeaseMs)
  : undefined
await caseWorkspaceService.resumeCaseJobs()
await caseWorkspaceService.resumeWorkspaces()
workspaceCompletion.resumePending()
const { app, scheduler } = buildApp({
  config,
  store: labStore,
  practiceServiceFactory: (labScheduler) => new PracticeService(productRepository, labScheduler, new TutorEngine(config), retrieval, curation, (runId) => { planningService.markLabVerified(runId); writingService.enqueueAutoDraft(runId) }),
  writingServiceFactory: () => writingService,
  planningServiceFactory: () => planningService,
  agentPlanningServiceFactory: () => agentPlanningService,
  caseWorkspaceServiceFactory: () => caseWorkspaceService,
  mysqlDynamicCaseServiceFactory: (scheduler) => new MySqlDynamicCaseService(productRepository, scheduler, config),
  gymBuildServiceFactory: (workspace, mysql) => new EnvironmentBuildOrchestrator(productRepository, workspace, mysql, {
    adapter: openHandsAdapter,
    enabled: config.caseBuilderEnabled,
    taskTimeoutMs: config.caseBuilderTaskTimeoutMs,
    maxRepairRounds: config.caseBuilderMaxRepairRounds,
    maxLogBytes: config.caseBuilderMaxLogBytes,
    failureRetentionHours: config.caseBuilderFailureRetentionHours,
    maxConcurrent: config.caseBuilderMaxConcurrent,
  }),
  identityService: config.signedDeviceSessionEnabled ? identityService : undefined,
  zhihuGateway: config.signedDeviceSessionEnabled ? zhihuGateway : undefined,
  mixedGymServiceFactory: (build) => new MixedGymService(productRepository, build, new DeepSeekPracticeCardGenerator(config), zhihuOpenApi),
  runtimeStatus: async () => ({ model: { configured: Boolean(config.modelBaseUrl && config.modelApiKey), name: config.modelName }, caseBuilder: { enabled: config.caseBuilderEnabled, endpointConfigured: Boolean(config.caseBuilderUrl), model: config.caseBuilderLlmModel }, zhihu: { configured: Boolean(config.zhihuAccessSecret), executable: Boolean(config.zhihuAccessSecret), lastRetrieval: null } }),
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
