import { createServer } from 'node:http'
import { createCaseBuilderService } from './service.mjs'

const service = createCaseBuilderService({
  token: process.env.CASE_BUILDER_TOKEN ?? '',
  stateDir: process.env.CASE_BUILDER_STATE_DIR ?? '/var/lib/case-builder-agent',
  taskTimeoutMs: process.env.CASE_BUILDER_TASK_TIMEOUT_MS ?? 20 * 60_000,
  maxLogBytes: process.env.CASE_BUILDER_MAX_LOG_BYTES ?? 64 * 1024,
  openHandsImage: process.env.CASE_BUILDER_OPENHANDS_IMAGE ?? '',
  openHandsCommand: process.env.CASE_BUILDER_OPENHANDS_COMMAND ?? '',
  simulated: process.env.CASE_BUILDER_SIMULATED === 'true',
  dockerSocketEnabled: process.env.CASE_BUILDER_DOCKER_SOCKET_ENABLED === 'true',
  llmBaseUrl: process.env.CASE_BUILDER_LLM_BASE_URL ?? process.env.ZHIXING_MODEL_BASE_URL ?? '',
  llmApiKey: process.env.CASE_BUILDER_LLM_API_KEY ?? process.env.ZHIXING_MODEL_API_KEY ?? '',
  llmModel: process.env.CASE_BUILDER_LLM_MODEL ?? process.env.ZHIXING_MODEL_NAME ?? '',
  pythonBaseImage: process.env.CASE_BUILDER_PYTHON_BASE_IMAGE ?? '',
  mysqlRootPassword: process.env.CASE_BUILDER_MYSQL_ROOT_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD ?? '',
  mysqlRuntimeLeaseMs: process.env.CASE_BUILDER_MYSQL_RUNTIME_LEASE_MS ?? 20 * 60_000,
  mysqlExecutionTimeoutMs: process.env.CASE_BUILDER_MYSQL_EXECUTION_TIMEOUT_MS ?? 10_000,
  maxRequestBytes: process.env.CASE_BUILDER_MAX_REQUEST_BYTES ?? 2 * 1024 * 1024,
  maxConcurrentTasks: process.env.CASE_BUILDER_MAX_CONCURRENT ?? 1,
})

await service.restore()
service.resume()
const server = createServer((request, reply) => { void service.route(request, reply) })
const port = Number(process.env.CASE_BUILDER_PORT ?? 3102)
const bindHost = process.env.CASE_BUILDER_BIND_HOST ?? '0.0.0.0'
server.listen(port, bindHost, () => console.log(`[case-builder-agent] listening on ${bindHost}:${port}`))
process.once('SIGTERM', () => { void service.shutdown().finally(() => server.close()) })
process.once('SIGINT', () => { void service.shutdown().finally(() => server.close()) })
