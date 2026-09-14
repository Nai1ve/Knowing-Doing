import path from 'node:path'

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

export interface LabConfig {
  host: string
  port: number
  apiHost: string
  apiPort: number
  corsOrigin: string
  runnerUser: string
  runnerPassword: string
  adminUser: string
  adminPassword: string
  tokenSecret: string
  runLeaseMs: number
  runIdleTimeoutMs: number
  queueLeaseMs: number
  queryTimeoutMs: number
  maxRows: number
  maxOutputBytes: number
  runnerPoolSize: number
  productDbPath: string
  modelBaseUrl: string
  modelApiKey: string
  modelName: string
  modelTimeoutMs: number
  resumeStoragePath: string
  resumeMaxBytes: number
  zhihuCliPath: string
  zhihuAccessSecret: string
  zhihuApiBaseUrl: string
  zhihuArticlePath: string
  retrievalTimeoutMs: number
  retrievalCacheTtlMs: number
  identityMode: 'client' | 'shared_demo'
  demoLearnerId: string
  workspaceRunnerUrl: string
  workspaceRunnerToken: string
  workspaceRunnerTimeoutMs: number
  workspaceRunnerFake: boolean
  environmentRuntimeSigningKey: string
  environmentRuntimeReferenceTtlMs: number
  caseBuilderProvider: 'fixture' | 'model'
  caseBuilderEnabled: boolean
  caseBuilderUrl: string
  caseBuilderToken: string
  caseBuilderRequestTimeoutMs: number
  caseBuilderTaskTimeoutMs: number
  caseBuilderMaxRepairRounds: number
  caseBuilderMaxConcurrent: number
  caseBuilderMaxLogBytes: number
  caseBuilderFailureRetentionHours: number
  caseBuilderDockerSocketEnabled: boolean
  caseBuilderOpenHandsImage: string
  caseBuilderLlmBaseUrl: string
  caseBuilderLlmApiKey: string
  caseBuilderLlmModel: string
  zhihuOauthClientId: string
  zhihuOauthClientSecret: string
  oauthTokenEncryptionKey: string
  allowInsecureOauthCallback: boolean
  legacyHeaderLearnerId: boolean
  zhihuOauthAuthorizePath: string
  zhihuOauthTokenPath: string
  zhihuUserPath: string
  zhihuCollectionsPath: string
  zhihuCollectionItemsPath: string
  zhihuContentPath: string
  zhihuMomentsPath: string
  zhihuOauthRedirectUri: string
  zhihuOauthScopes: string
  signedDeviceSessionEnabled: boolean
  zhihuLoginRequired: boolean
  plannerAssessmentV2Enabled: boolean
  zhihuOauthEnabled: boolean
  zhihuSourceSyncEnabled: boolean
  practiceCardV2Enabled: boolean
  mixedGymEnabled: boolean
  legacyCaseFlowEnabled: boolean
  publicOrigin: string
  zhihuOauthBaseUrl: string
}

export function loadConfig(): LabConfig {
  const tokenSecret = process.env.LAB_TOKEN_SECRET ?? 'development-only-change-me'
  if (process.env.NODE_ENV === 'production' && tokenSecret === 'development-only-change-me') {
    throw new Error('LAB_TOKEN_SECRET is required in production')
  }

  const productDbPath = process.env.ZHIXING_PRODUCT_DB_PATH ?? './data/zhixing-product.db'
  const configuredIdentityMode = process.env.ZHIXING_IDENTITY_MODE
  const identityMode: LabConfig['identityMode'] = configuredIdentityMode === 'shared_demo'
    ? 'shared_demo'
    : configuredIdentityMode === 'client'
      ? 'client'
      : process.env.NODE_ENV === 'production'
        ? 'shared_demo'
        : 'client'
  const caseBuilderEnabled = process.env.CASE_BUILDER_ENABLED === 'true'
  const signedDeviceSessionEnabled = process.env.SIGNED_DEVICE_SESSION_ENABLED === 'true'
  const zhihuOauthEnabled = process.env.ZHIHU_OAUTH_ENABLED === 'true'
  const zhihuLoginRequired = process.env.ZHIHU_LOGIN_REQUIRED === 'true'
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? 'http://119.45.243.102'
  const zhihuOauthRedirectUri = process.env.ZHIHU_OAUTH_REDIRECT_URI ?? 'http://119.45.243.102/api/auth/oauth/zhihu/callback'
  const expectedOauthOrigin = 'http://119.45.243.102'
  const expectedOauthCallback = `${expectedOauthOrigin}/api/auth/oauth/zhihu/callback`
  if (zhihuOauthEnabled && !signedDeviceSessionEnabled) throw new Error('SIGNED_DEVICE_SESSION_ENABLED=true is required when ZHIHU_OAUTH_ENABLED=true')
  if (zhihuLoginRequired && !signedDeviceSessionEnabled) throw new Error('SIGNED_DEVICE_SESSION_ENABLED=true is required when ZHIHU_LOGIN_REQUIRED=true')
  if (zhihuLoginRequired && !zhihuOauthEnabled) throw new Error('ZHIHU_OAUTH_ENABLED=true is required when ZHIHU_LOGIN_REQUIRED=true')
  if (process.env.ZHIHU_SOURCE_SYNC_ENABLED === 'true' && !zhihuOauthEnabled) throw new Error('ZHIHU_OAUTH_ENABLED=true is required when ZHIHU_SOURCE_SYNC_ENABLED=true')
  if (process.env.MIXED_GYM_ENABLED === 'true' && process.env.PRACTICE_CARD_V2_ENABLED !== 'true') throw new Error('PRACTICE_CARD_V2_ENABLED=true is required when MIXED_GYM_ENABLED=true')
  if (identityMode === 'shared_demo' && zhihuOauthEnabled) throw new Error('ZHIHU_OAUTH_ENABLED is not permitted in shared_demo identity mode')
  if (zhihuOauthEnabled && (!process.env.ZHIHU_OAUTH_APP_ID || !process.env.ZHIHU_OAUTH_APP_KEY)) throw new Error('ZHIHU_OAUTH_APP_ID and ZHIHU_OAUTH_APP_KEY are required when ZHIHU_OAUTH_ENABLED=true')
  if (zhihuOauthEnabled && (!process.env.OAUTH_TOKEN_ENCRYPTION_KEY || Buffer.byteLength(process.env.OAUTH_TOKEN_ENCRYPTION_KEY) < 32)) throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be at least 32 bytes when ZHIHU_OAUTH_ENABLED=true')
  if (zhihuOauthEnabled && (publicOrigin !== expectedOauthOrigin || zhihuOauthRedirectUri !== expectedOauthCallback)) throw new Error(`Zhihu OAuth requires PUBLIC_ORIGIN=${expectedOauthOrigin} and ZHIHU_OAUTH_REDIRECT_URI=${expectedOauthCallback}`)
  if (zhihuOauthEnabled && zhihuOauthRedirectUri.startsWith('http://') && process.env.ALLOW_INSECURE_OAUTH_CALLBACK !== 'true') throw new Error('ALLOW_INSECURE_OAUTH_CALLBACK=true is required for an HTTP OAuth callback')
  const caseBuilderUrl = process.env.CASE_BUILDER_URL ?? 'http://127.0.0.1:3102'
  const caseBuilderToken = process.env.CASE_BUILDER_TOKEN ?? ''
  if (caseBuilderEnabled && !caseBuilderToken) throw new Error('CASE_BUILDER_TOKEN is required when CASE_BUILDER_ENABLED=true')
  const environmentRuntimeSigningKey = process.env.ENVIRONMENT_RUNTIME_SIGNING_KEY ?? (caseBuilderEnabled ? '' : tokenSecret)
  if (caseBuilderEnabled && !environmentRuntimeSigningKey) throw new Error('ENVIRONMENT_RUNTIME_SIGNING_KEY is required when CASE_BUILDER_ENABLED=true')

  return {
    host: process.env.LAB_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.LAB_MYSQL_PORT ?? 3306),
    apiHost: process.env.LAB_API_HOST ?? '127.0.0.1',
    apiPort: Number(process.env.LAB_API_PORT ?? 3001),
    corsOrigin: process.env.LAB_CORS_ORIGIN ?? 'http://localhost:4175',
    runnerUser: process.env.LAB_MYSQL_RUNNER_USER ?? 'zhixing_lab_runner',
    runnerPassword: process.env.LAB_MYSQL_RUNNER_PASSWORD ?? '',
    adminUser: process.env.LAB_MYSQL_ADMIN_USER ?? 'zhixing_lab_admin',
    adminPassword: process.env.LAB_MYSQL_ADMIN_PASSWORD ?? '',
    tokenSecret,
    runLeaseMs: numberEnv('LAB_RUN_LEASE_MS', 20 * 60 * 1000),
    runIdleTimeoutMs: numberEnv('LAB_RUN_IDLE_TIMEOUT_MS', 5 * 60 * 1000),
    queueLeaseMs: numberEnv('LAB_QUEUE_LEASE_MS', 30 * 60 * 1000),
    queryTimeoutMs: numberEnv('LAB_QUERY_TIMEOUT_MS', 10_000),
    maxRows: numberEnv('LAB_MAX_ROWS', 200),
    maxOutputBytes: numberEnv('LAB_MAX_OUTPUT_BYTES', 1024 * 1024),
    runnerPoolSize: numberEnv('LAB_RUNNER_POOL_SIZE', 6),
    productDbPath,
    modelBaseUrl: process.env.ZHIXING_MODEL_BASE_URL ?? '',
    modelApiKey: process.env.ZHIXING_MODEL_API_KEY ?? '',
    modelName: process.env.ZHIXING_MODEL_NAME ?? 'default',
    modelTimeoutMs: numberEnv('ZHIXING_MODEL_TIMEOUT_MS', 5 * 60 * 1000),
    resumeStoragePath: process.env.ZHIXING_RESUME_STORAGE_PATH ?? path.resolve(process.cwd(), 'data/resumes'),
    resumeMaxBytes: numberEnv('ZHIXING_RESUME_MAX_BYTES', 10 * 1024 * 1024),
    zhihuCliPath: process.env.ZHIXING_ZHIHU_CLI_PATH ?? '',
    zhihuAccessSecret: process.env.ZHIXING_ZHIHU_ACCESS_SECRET ?? '',
    zhihuApiBaseUrl: process.env.ZHIXING_ZHIHU_API_BASE_URL ?? 'https://developer.zhihu.com',
    zhihuArticlePath: process.env.ZHIXING_ZHIHU_ARTICLE_PATH ?? '/api/v1/content/zhihu_article',
    retrievalTimeoutMs: numberEnv('ZHIXING_RETRIEVAL_TIMEOUT_MS', 15_000),
    retrievalCacheTtlMs: numberEnv('ZHIXING_RETRIEVAL_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
    identityMode,
    demoLearnerId: process.env.ZHIXING_DEMO_LEARNER_ID ?? 'demo-learner',
    workspaceRunnerUrl: process.env.WORKSPACE_RUNNER_URL ?? 'http://127.0.0.1:3101',
    workspaceRunnerToken: process.env.WORKSPACE_RUNNER_TOKEN ?? 'development-workspace-runner-token',
    workspaceRunnerTimeoutMs: numberEnv('WORKSPACE_RUNNER_TIMEOUT_MS', 35_000),
    workspaceRunnerFake: process.env.WORKSPACE_RUNNER_FAKE === 'true',
    environmentRuntimeSigningKey,
    environmentRuntimeReferenceTtlMs: numberEnv('ENVIRONMENT_RUNTIME_REFERENCE_TTL_MS', 10 * 60_000),
    caseBuilderProvider: process.env.ZHIXING_CASE_BUILDER_PROVIDER === 'model' ? 'model' : 'fixture',
    caseBuilderEnabled,
    caseBuilderUrl,
    caseBuilderToken,
    caseBuilderRequestTimeoutMs: numberEnv('CASE_BUILDER_REQUEST_TIMEOUT_MS', 30_000),
    caseBuilderTaskTimeoutMs: numberEnv('CASE_BUILDER_TASK_TIMEOUT_MS', 20 * 60 * 1000),
    caseBuilderMaxRepairRounds: Math.min(3, numberEnv('CASE_BUILDER_MAX_REPAIR_ROUNDS', 3)),
    caseBuilderMaxConcurrent: Math.min(1, numberEnv('CASE_BUILDER_MAX_CONCURRENT', 1)),
    caseBuilderMaxLogBytes: numberEnv('CASE_BUILDER_MAX_LOG_BYTES', 64 * 1024),
    caseBuilderFailureRetentionHours: numberEnv('CASE_BUILDER_FAILURE_RETENTION_HOURS', 24),
    caseBuilderDockerSocketEnabled: process.env.CASE_BUILDER_DOCKER_SOCKET_ENABLED === 'true',
    caseBuilderOpenHandsImage: process.env.CASE_BUILDER_OPENHANDS_IMAGE ?? '',
    caseBuilderLlmBaseUrl: process.env.CASE_BUILDER_LLM_BASE_URL ?? process.env.ZHIXING_MODEL_BASE_URL ?? '',
    caseBuilderLlmApiKey: process.env.CASE_BUILDER_LLM_API_KEY ?? process.env.ZHIXING_MODEL_API_KEY ?? '',
    caseBuilderLlmModel: process.env.CASE_BUILDER_LLM_MODEL ?? process.env.ZHIXING_MODEL_NAME ?? 'default',
    zhihuOauthClientId: process.env.ZHIHU_OAUTH_APP_ID ?? process.env.ZHIHU_OAUTH_CLIENT_ID ?? '',
    zhihuOauthClientSecret: process.env.ZHIHU_OAUTH_APP_KEY ?? process.env.ZHIHU_OAUTH_CLIENT_SECRET ?? '',
    oauthTokenEncryptionKey: process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '',
    allowInsecureOauthCallback: process.env.ALLOW_INSECURE_OAUTH_CALLBACK === 'true',
    legacyHeaderLearnerId: process.env.NODE_ENV === 'test' || (process.env.NODE_ENV !== 'production' && (process.env.AUTH_MODE === 'legacy' || process.env.ZHIXING_LEGACY_HEADER_IDENTITY === 'true')),
    zhihuOauthAuthorizePath: process.env.ZHIHU_OAUTH_AUTHORIZE_PATH ?? '/authorize',
    zhihuOauthTokenPath: process.env.ZHIHU_OAUTH_TOKEN_PATH ?? '/access_token',
    zhihuUserPath: process.env.ZHIHU_OAUTH_USER_PATH ?? '/user',
    zhihuCollectionsPath: process.env.ZHIHU_OAUTH_COLLECTIONS_PATH ?? '/user/collections',
    zhihuCollectionItemsPath: process.env.ZHIHU_OAUTH_COLLECTION_ITEMS_PATH ?? '/user/collection/{collection_id}',
    zhihuContentPath: process.env.ZHIHU_OAUTH_CONTENT_PATH ?? '/user/content',
    zhihuMomentsPath: process.env.ZHIHU_OAUTH_MOMENTS_PATH ?? '/user/moments',
    zhihuOauthRedirectUri,
    zhihuOauthScopes: process.env.ZHIHU_OAUTH_SCOPES ?? '',
    signedDeviceSessionEnabled,
    zhihuLoginRequired,
    // Keep the existing assessment generator as the rollout default. V2 is
    // deliberately opt-in until its recovery behaviour has been observed.
    plannerAssessmentV2Enabled: process.env.PLANNER_ASSESSMENT_V2_ENABLED === 'true',
    zhihuOauthEnabled,
    zhihuSourceSyncEnabled: process.env.ZHIHU_SOURCE_SYNC_ENABLED === 'true',
    practiceCardV2Enabled: process.env.PRACTICE_CARD_V2_ENABLED === 'true',
    mixedGymEnabled: process.env.MIXED_GYM_ENABLED === 'true',
    legacyCaseFlowEnabled: process.env.LEGACY_CASE_FLOW_ENABLED !== 'false',
    publicOrigin,
    zhihuOauthBaseUrl: process.env.ZHIHU_OAUTH_BASE_URL ?? 'https://openapi.zhihu.com',
  }
}
