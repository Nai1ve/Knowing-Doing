import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.env.CASE_BUILDER_PORT ?? 3102)
const token = process.env.CASE_BUILDER_TOKEN ?? ''
const stateDir = process.env.CASE_BUILDER_STATE_DIR ?? '/var/lib/case-builder-agent'
const taskTimeoutMs = Number(process.env.CASE_BUILDER_TASK_TIMEOUT_MS ?? 20 * 60_000)
const maxLogBytes = Number(process.env.CASE_BUILDER_MAX_LOG_BYTES ?? 64 * 1024)
const openHandsImage = process.env.CASE_BUILDER_OPENHANDS_IMAGE ?? ''
const openHandsCommand = process.env.CASE_BUILDER_OPENHANDS_COMMAND ?? ''
const simulated = process.env.CASE_BUILDER_SIMULATED === 'true'
const dockerSocketEnabled = process.env.CASE_BUILDER_DOCKER_SOCKET_ENABLED === 'true'
const llmBaseUrl = process.env.CASE_BUILDER_LLM_BASE_URL ?? process.env.ZHIXING_MODEL_BASE_URL ?? ''
const llmApiKey = process.env.CASE_BUILDER_LLM_API_KEY ?? process.env.ZHIXING_MODEL_API_KEY ?? ''
const llmModel = process.env.CASE_BUILDER_LLM_MODEL ?? process.env.ZHIXING_MODEL_NAME ?? ''
const pythonBaseImage = process.env.CASE_BUILDER_PYTHON_BASE_IMAGE ?? ''
const mysqlRootPassword = process.env.CASE_BUILDER_MYSQL_ROOT_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD ?? ''
const mysqlRuntimeLeaseMs = Number(process.env.CASE_BUILDER_MYSQL_RUNTIME_LEASE_MS ?? 20 * 60_000)
const mysqlExecutionTimeoutMs = Number(process.env.CASE_BUILDER_MYSQL_EXECUTION_TIMEOUT_MS ?? 10_000)
const maxRequestBytes = Number(process.env.CASE_BUILDER_MAX_REQUEST_BYTES ?? 2 * 1024 * 1024)
const maxConcurrentTasks = Math.min(1, Math.max(1, Number(process.env.CASE_BUILDER_MAX_CONCURRENT ?? 1)))
const tasks = new Map()
const mysqlRuntimes = new Map()
const taskQueue = []
let activeTaskCount = 0

const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|password|token)\s*[=:]\s*|authorization\s*[=:]\s*(?:bearer\s+)?)(?:[^\s,;]{4,})/gi
const clean = (value, max = 1200) => {
  const text = String(value ?? '').replace(secretPattern, '[redacted]').replace(/\u0000/g, '')
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text
}
const now = () => new Date().toISOString()
const taskPath = (id) => path.join(stateDir, `${id}.json`)
const runtimePath = (id) => path.join(stateDir, `runtime-${id}.json`)

async function persist(task) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(taskPath(task.id), JSON.stringify(task), 'utf8')
}

async function persistRuntime(runtime) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(runtimePath(runtime.id), JSON.stringify(runtime), 'utf8')
}

async function removeRuntimeState(id) { await rm(runtimePath(id), { force: true }).catch(() => undefined) }

async function restore() {
  await mkdir(stateDir, { recursive: true })
  for (const entry of await readdir(stateDir)) {
    if (!entry.endsWith('.json')) continue
    try {
      const task = JSON.parse(await readFile(path.join(stateDir, entry), 'utf8'))
      if (entry.startsWith('runtime-') && task && typeof task.id === 'string' && typeof task.containerId === 'string') mysqlRuntimes.set(task.id, task)
      else if (task && typeof task.id === 'string' && task.input) {
        await rm(path.join(stateDir, `${task.id}.env`), { force: true }).catch(() => undefined)
        // We cannot safely reattach a Node child process after this service
        // restarts.  Report the interruption; the product-side orchestrator
        // consumes the event cursor and creates a fresh repair task if needed.
        if (task.status === 'running') {
          task.status = 'failed'
          task.failure = { code: 'case_builder_agent_restarted', message: 'Case Builder 服务重启，原任务需要恢复', category: 'platform_fault' }
          event(task, { phase: 'failed', type: 'diagnostic', summary: 'Case Builder 服务重启中断了任务', diagnostic: task.failure })
          await persist(task)
        }
        tasks.set(task.id, task)
      }
    } catch { /* malformed state never reaches the public API */ }
  }
}

function event(task, input) {
  const item = {
    id: randomUUID(), sequence: task.events.length + 1, phase: input.phase ?? undefined,
    type: input.type, summary: clean(input.summary), command: input.command ? clean(input.command, 600) : null,
    diagnostic: input.diagnostic ? { code: clean(input.diagnostic.code, 120), message: clean(input.diagnostic.message) } : null,
    resource: input.resource ?? null, createdAt: now(),
  }
  task.events.push(item)
  task.updatedAt = item.createdAt
  return item
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []; const err = []; let outBytes = 0; let errBytes = 0; let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeoutMs ?? taskTimeoutMs)
    child.stdout.on('data', (chunk) => { if (outBytes < maxLogBytes) out.push(chunk.subarray(0, Math.max(0, maxLogBytes - outBytes))); outBytes += chunk.length })
    child.stderr.on('data', (chunk) => { if (errBytes < maxLogBytes) err.push(chunk.subarray(0, Math.max(0, maxLogBytes - errBytes))); errBytes += chunk.length })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, timedOut, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }) })
  })
}

function assertInput(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('请求体必须是对象'), { code: 'invalid_request' })
  if (input.protocolVersion !== 1) throw Object.assign(new Error('环境构建协议版本不受支持'), { code: 'invalid_request' })
  for (const key of ['buildId', 'attemptId', 'runtimeKind']) if (typeof input[key] !== 'string' || !input[key]) throw Object.assign(new Error(`${key} 不能为空`), { code: 'invalid_request' })
  if (!['mysql_lab', 'docker_workspace'].includes(input.runtimeKind)) throw Object.assign(new Error('runtimeKind 不受支持'), { code: 'invalid_request' })
  if (!input.environment || typeof input.environment !== 'object' || typeof input.environment.environmentKey !== 'string' || typeof input.environment.environmentVersion !== 'string') throw Object.assign(new Error('环境目录信息无效'), { code: 'invalid_request' })
  if (!input.limits || typeof input.limits !== 'object' || !Number.isFinite(input.limits.timeoutMs) || input.limits.timeoutMs <= 0 || input.limits.timeoutMs > taskTimeoutMs || !Number.isFinite(input.limits.maxLogBytes) || input.limits.maxLogBytes <= 0 || input.limits.maxLogBytes > maxLogBytes) throw Object.assign(new Error('构建资源限制无效'), { code: 'invalid_request' })
  if (input.runtimeKind === 'mysql_lab') {
    const contract = input.mysqlContract
    if (!contract || typeof contract !== 'object' || typeof contract.learningCaseId !== 'string' || !contract.learningCaseId || typeof contract.database !== 'string' || !/^zhixing_dynamic_[a-f0-9]{12,64}$/.test(contract.database) || typeof contract.materializationFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(contract.materializationFingerprint) || typeof contract.schemaSql !== 'string' || !contract.schemaSql || !contract.seed || typeof contract.seed !== 'object' || !Number.isInteger(contract.seed.rowCount) || contract.seed.rowCount < 1_000 || contract.seed.rowCount > 1_000_000 || !['uniform', 'skewed'].includes(contract.seed.distribution) || typeof contract.faultSql !== 'string' || typeof contract.starterExplain !== 'string' || typeof contract.referenceSql !== 'string') throw Object.assign(new Error('MySQL 案例构建契约无效'), { code: 'invalid_request' })
  } else if (input.mysqlContract != null) throw Object.assign(new Error('Docker workspace 不能携带 MySQL 案例构建契约'), { code: 'invalid_request' })
}

function configured() {
  return Boolean(token && dockerSocketEnabled && openHandsImage.includes('@sha256:') && openHandsCommand && llmBaseUrl && llmApiKey && llmModel)
}

function enqueueTask(task) {
  taskQueue.push(task.id)
  void drainTaskQueue()
}

async function drainTaskQueue() {
  while (activeTaskCount < maxConcurrentTasks && taskQueue.length > 0) {
    const taskId = taskQueue.shift()
    const task = tasks.get(taskId)
    if (!task || task.status !== 'queued') continue
    activeTaskCount += 1
    void executeTask(task).catch((error) => {
      console.error('[case-builder-agent] task_unhandled', clean(error instanceof Error ? error.message : String(error)))
    }).finally(() => {
      activeTaskCount -= 1
      void drainTaskQueue()
    })
  }
}

function taskFailureCategory(error) {
  const code = String(error?.code ?? '')
  if (/manifest|runtime_image|command_failed/.test(code)) return 'agent_failure'
  return 'platform_fault'
}

async function verifyRuntimeArtifact(task) {
  const manifest = task.manifest
  if (!manifest || typeof manifest !== 'object' || !manifest.environment || !Array.isArray(manifest.resources)) throw Object.assign(new Error('OpenHands 未输出有效 Manifest'), { code: 'manifest_invalid' })
  const digest = manifest.environment.runtimeImageDigest
  const reference = manifest.environment.runtimeImageRef ?? digest
  const resource = manifest.resources.find((item) => item && item.kind === 'image' && item.role === 'runtime_artifact')
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(digest) || typeof reference !== 'string' || !resource || !resource.labels || typeof resource.labels !== 'object') throw Object.assign(new Error('Manifest 缺少运行时镜像产物'), { code: 'manifest_runtime_artifact_missing' })
  const requiredLabels = {
    'zhixing.case-build': task.input.buildId,
    'zhixing.case-attempt': task.input.attemptId,
    'zhixing.protocol-version': '1',
    'zhixing.resource-role': 'runtime_artifact',
    'zhixing.runtime-kind': task.input.runtimeKind,
    'zhixing.environment-key': task.input.environment.environmentKey,
    'zhixing.environment-version': task.input.environment.environmentVersion,
  }
  if (task.input.mysqlContract) requiredLabels['zhixing.mysql-contract-fingerprint'] = task.input.mysqlContract.materializationFingerprint
  if (Object.entries(requiredLabels).some(([key, value]) => resource.labels[key] !== value)) throw Object.assign(new Error('Manifest 运行时镜像标签不完整'), { code: 'manifest_runtime_artifact_labels_invalid' })
  const inspected = await run('docker', ['image', 'inspect', reference], { timeoutMs: 20_000 })
  if (inspected.code !== 0) throw Object.assign(new Error(clean(inspected.stderr || inspected.stdout)), { code: 'runtime_image_unavailable' })
  let image
  try { image = JSON.parse(inspected.stdout)?.[0] } catch { throw Object.assign(new Error('运行时镜像元数据无效'), { code: 'runtime_image_invalid' }) }
  const repoDigests = Array.isArray(image?.RepoDigests) ? image.RepoDigests : []
  if (image?.Id !== digest && !repoDigests.some((item) => typeof item === 'string' && item.endsWith(`@${digest}`))) throw Object.assign(new Error('运行时镜像 digest 与 Manifest 不一致'), { code: 'runtime_image_digest_mismatch' })
  const labels = image?.Config?.Labels && typeof image.Config.Labels === 'object' ? image.Config.Labels : {}
  if (Object.entries(requiredLabels).some(([key, value]) => labels[key] !== value)) throw Object.assign(new Error('运行时镜像缺少平台标签'), { code: 'runtime_image_label_mismatch' })
  const maxRuntimeImageBytes = Number(process.env.CASE_BUILDER_MAX_RUNTIME_IMAGE_BYTES ?? 4 * 1024 * 1024 * 1024)
  if (!Number.isFinite(image?.Size) || image.Size < 0 || image.Size > maxRuntimeImageBytes) throw Object.assign(new Error('运行时镜像超过大小限制'), { code: 'runtime_image_too_large' })
  event(task, { phase: 'preflighting', type: 'docker', summary: '已核验运行时镜像 digest、标签和大小限制', resource: { kind: 'image', id: digest, action: 'inspect' } })
}

async function executeTask(task) {
  if (task.status === 'cancelled') return
  task.status = 'running'; event(task, { phase: 'designing', type: 'phase', summary: 'OpenHands 任务已启动' }); await persist(task)
  const workdir = path.join(stateDir, 'work', task.id)
  try {
    if (!simulated && !configured()) throw Object.assign(new Error('OpenHands 镜像 digest 或命令未配置'), { code: 'case_builder_not_configured' })
    await mkdir(workdir, { recursive: true })
    await writeFile(path.join(workdir, 'request.json'), JSON.stringify(task.input), 'utf8')
    event(task, { phase: 'provisioning', type: 'docker', summary: '正在创建带构建标签的 OpenHands 任务容器', resource: { kind: 'container', id: `zhixing-case-builder-${task.id}`, action: 'create' } }); await persist(task)
    if (simulated) {
      const digest = `sha256:${'0'.repeat(64)}`
      task.manifest = {
        protocolVersion: 1, runtimeKind: task.input.runtimeKind,
        environment: { key: task.input.environment.environmentKey, version: task.input.environment.environmentVersion, runtimeImageDigest: digest, runtimeImageRef: digest },
        starterFiles: task.input.runtimeKind === 'docker_workspace' ? [{ path: 'tests/test_environment.py', content: 'def test_environment():\n    assert True\n' }] : [],
        referenceFiles: task.input.runtimeKind === 'docker_workspace' ? [{ path: 'solution.py', content: 'def ready():\n    return True\n' }] : [], mysql: task.input.runtimeKind === 'mysql_lab' ? { contractFingerprint: task.input.mysqlContract.materializationFingerprint, initializationSql: [task.input.mysqlContract.schemaSql, task.input.mysqlContract.faultSql], starterExplain: task.input.mysqlContract.starterExplain, referenceSql: [task.input.mysqlContract.referenceSql] } : undefined,
        verification: { commandKeys: task.input.successCriteria.commandKeys, successSignals: task.input.successCriteria.successSignals },
        resources: [{ kind: 'image', id: digest, role: 'runtime_artifact', labels: {
          'zhixing.case-build': task.input.buildId,
          'zhixing.case-attempt': task.input.attemptId,
          'zhixing.protocol-version': '1',
          'zhixing.resource-role': 'runtime_artifact',
          'zhixing.runtime-kind': task.input.runtimeKind,
          'zhixing.runtime-image-digest': digest,
          'zhixing.environment-key': task.input.environment.environmentKey,
          'zhixing.environment-version': task.input.environment.environmentVersion,
          ...(task.input.mysqlContract ? { 'zhixing.mysql-contract-fingerprint': task.input.mysqlContract.materializationFingerprint } : {}),
        } }],
      }
    } else {
      // The deployment-owned command runs inside the pinned OpenHands image and
      // must write one JSON manifest to /workspace/manifest.json. The wrapper
      // intentionally never exposes API credentials in events or output.
      const taskEnvPath = path.join(stateDir, `${task.id}.env`)
      const taskEnv = [['CASE_BUILDER_LLM_BASE_URL', llmBaseUrl], ['CASE_BUILDER_LLM_API_KEY', llmApiKey], ['CASE_BUILDER_LLM_MODEL', llmModel], ['CASE_BUILDER_PYTHON_BASE_IMAGE', pythonBaseImage]]
        .filter(([, value]) => value)
        .map(([target, value]) => {
          if (/\r|\n/.test(value)) throw Object.assign(new Error('Case Builder 环境变量格式无效'), { code: 'case_builder_env_invalid' })
          return `${target}=${value}`
        }).join('\n') + '\n'
      await writeFile(taskEnvPath, taskEnv, { encoding: 'utf8', mode: 0o600 })
      const socketArgs = dockerSocketEnabled ? ['-v', '/var/run/docker.sock:/var/run/docker.sock'] : []
      let result
      try {
        result = await run('docker', ['run', '--rm', '--name', `zhixing-case-builder-${task.id}`, '--label', `zhixing.case-build=${task.input.buildId}`, '--label', `zhixing.case-attempt=${task.input.attemptId}`, '--label', 'zhixing.protocol-version=1', '--label', 'zhixing.resource-role=builder', '--network', 'bridge', '--memory', process.env.CASE_BUILDER_TASK_MEMORY ?? '4g', '--cpus', process.env.CASE_BUILDER_TASK_CPUS ?? '2', '--pids-limit', process.env.CASE_BUILDER_TASK_PIDS ?? '512', '-v', `${workdir}:/workspace`, ...socketArgs, '-e', 'CASE_BUILDER_REQUEST=/workspace/request.json', '--env-file', taskEnvPath, '--entrypoint', 'sh', openHandsImage, '-lc', openHandsCommand], { timeoutMs: taskTimeoutMs })
      } finally {
        await rm(taskEnvPath, { force: true }).catch(() => undefined)
      }
      event(task, { phase: 'initializing', type: 'tool', summary: result.code === 0 ? 'OpenHands 已完成构建命令' : 'OpenHands 构建命令失败', command: 'openhands environment-build', diagnostic: result.code === 0 ? null : { code: result.timedOut ? 'case_builder_task_timeout' : 'case_builder_command_failed', message: clean(result.stderr || result.stdout) } })
      if (task.status === 'cancelled') return
      if (result.code !== 0) throw Object.assign(new Error(clean(result.stderr || result.stdout)), { code: result.timedOut ? 'case_builder_task_timeout' : 'case_builder_command_failed' })
      try { task.manifest = JSON.parse(await readFile(path.join(workdir, 'manifest.json'), 'utf8')) } catch { throw Object.assign(new Error('OpenHands 未写入可解析的 Manifest'), { code: 'manifest_parse_failed' }) }
      await verifyRuntimeArtifact(task)
    }
    event(task, { phase: 'preflighting', type: 'phase', summary: '已生成 Manifest，等待产品服务独立预检' })
    task.status = 'succeeded'; event(task, { type: 'status', summary: 'OpenHands 任务完成' })
  } catch (error) {
    if (task.status === 'cancelled') return
    task.status = 'failed'
    task.failure = { code: error?.code ?? 'case_builder_failed', message: clean(error instanceof Error ? error.message : 'Case Builder 失败'), category: taskFailureCategory(error) }
    event(task, { phase: 'failed', type: 'diagnostic', summary: 'OpenHands 任务失败', diagnostic: task.failure })
  } finally {
    task.updatedAt = now(); await persist(task)
  }
}

function runtimeError(code, message) { return Object.assign(new Error(message), { code }) }

function assertMysqlRuntimeInput(input) {
  if (!input || typeof input !== 'object') throw runtimeError('invalid_request', 'MySQL 运行时请求无效')
  for (const key of ['buildId', 'attemptId', 'learningCaseId', 'database', 'mysqlContractFingerprint', 'runtimeImageDigest', 'runtimeImageRef']) if (typeof input[key] !== 'string' || !input[key]) throw runtimeError('invalid_request', `${key} 不能为空`)
  if (!/^sha256:[a-f0-9]{64}$/i.test(input.runtimeImageDigest)) throw runtimeError('invalid_request', 'runtimeImageDigest 无效')
  if (!/^zhixing_dynamic_[a-f0-9]{12,64}$/.test(input.database)) throw runtimeError('invalid_request', 'MySQL 案例数据库无效')
  if (!/^[a-f0-9]{64}$/i.test(input.mysqlContractFingerprint)) throw runtimeError('invalid_request', 'MySQL 案例物料指纹无效')
  if (input.runtimeImageRef !== input.runtimeImageDigest && !input.runtimeImageRef.endsWith(`@${input.runtimeImageDigest}`)) throw runtimeError('invalid_request', 'runtimeImageRef 必须固定到声明 digest')
  if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0 || input.leaseMs > 30 * 60_000) throw runtimeError('invalid_request', 'MySQL 运行时租约无效')
}

async function inspectRuntimeImage(input) {
  const result = await run('docker', ['image', 'inspect', input.runtimeImageRef], { timeoutMs: 10_000 })
  if (result.code !== 0) throw runtimeError('mysql_runtime_image_unavailable', clean(result.stderr || result.stdout))
  let image
  try { image = JSON.parse(result.stdout)?.[0] } catch { throw runtimeError('mysql_runtime_image_invalid', '无法读取 MySQL 环境镜像元数据') }
  const repoDigests = Array.isArray(image?.RepoDigests) ? image.RepoDigests : []
  if (image?.Id !== input.runtimeImageDigest && !repoDigests.some((value) => typeof value === 'string' && value.endsWith(`@${input.runtimeImageDigest}`))) throw runtimeError('mysql_runtime_image_digest_mismatch', 'MySQL 环境镜像 digest 不匹配')
  const labels = image?.Config?.Labels && typeof image.Config.Labels === 'object' ? image.Config.Labels : {}
  const required = {
    'zhixing.case-build': input.buildId,
    'zhixing.case-attempt': input.attemptId,
    'zhixing.protocol-version': '1',
    'zhixing.resource-role': 'runtime_artifact',
    'zhixing.runtime-kind': 'mysql_lab',
    'zhixing.environment-key': 'mysql-performance-v1',
    'zhixing.environment-version': '1',
    'zhixing.mysql-contract-fingerprint': input.mysqlContractFingerprint,
  }
  if (Object.entries(required).some(([key, value]) => labels[key] !== value)) throw runtimeError('mysql_runtime_image_label_mismatch', 'MySQL 环境镜像缺少平台验证标签')
}

async function waitForMysql(runtime) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await run('docker', ['exec', '-e', `MYSQL_PWD=${mysqlRootPassword}`, runtime.containerId, 'mysqladmin', 'ping', '-h', '127.0.0.1', '-uroot', '--silent'], { timeoutMs: 3_000 })
    if (result.code === 0) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw runtimeError('mysql_runtime_start_timeout', 'MySQL 运行时未能在限定时间内就绪')
}

async function launchMysqlRuntime(runtime) {
  if (!dockerSocketEnabled) throw runtimeError('docker_socket_disabled', 'Case Builder 未启用 Docker socket')
  if (!mysqlRootPassword) throw runtimeError('mysql_runtime_credentials_missing', 'MySQL 运行时凭据未配置')
  await inspectRuntimeImage(runtime)
  const result = await run('docker', [
    'run', '-d', '--rm', '--name', runtime.containerName,
    '--label', `zhixing.case-build=${runtime.buildId}`,
    '--label', `zhixing.case-attempt=${runtime.attemptId}`,
    '--label', `zhixing.case-runtime=${runtime.id}`,
    '--label', 'zhixing.protocol-version=1',
    '--label', 'zhixing.resource-role=runtime_instance',
    '--label', 'zhixing.runtime-kind=mysql_lab',
    '--label', `zhixing.runtime-image-digest=${runtime.runtimeImageDigest}`,
    '--label', 'zhixing.environment-key=mysql-performance-v1',
    '--label', 'zhixing.environment-version=1',
    '--label', `zhixing.runtime-database=${runtime.database}`,
    '--label', `zhixing.mysql-contract-fingerprint=${runtime.mysqlContractFingerprint}`,
    '--network', 'none', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--memory', process.env.CASE_BUILDER_MYSQL_MEMORY ?? '1024m', '--cpus', process.env.CASE_BUILDER_MYSQL_CPUS ?? '1', '--pids-limit', process.env.CASE_BUILDER_MYSQL_PIDS ?? '256',
    '-e', `MYSQL_ROOT_PASSWORD=${mysqlRootPassword}`,
    runtime.runtimeImageRef,
  ], { timeoutMs: 30_000 })
  if (result.code !== 0) throw runtimeError('mysql_runtime_start_failed', clean(result.stderr || result.stdout))
  runtime.containerId = result.stdout.trim()
  runtime.sessions = {}
  runtime.lastUsedAt = Date.now()
  runtime.leaseExpiresAt = Date.now() + runtime.leaseMs
  try { await waitForMysql(runtime) } catch (error) { await run('docker', ['rm', '-f', runtime.containerId], { timeoutMs: 10_000 }).catch(() => undefined); throw error }
  await persistRuntime(runtime)
}

async function stopMysqlRuntime(runtime) {
  if (runtime.containerId) await run('docker', ['rm', '-f', runtime.containerId], { timeoutMs: 15_000 }).catch(() => undefined)
  runtime.containerId = ''
  runtime.sessions = {}
}

async function resetMysqlRuntime(runtime) {
  await stopMysqlRuntime(runtime)
  await launchMysqlRuntime(runtime)
}

function mysqlRuntime(id) {
  const runtime = mysqlRuntimes.get(id)
  if (!runtime || !runtime.containerId) throw runtimeError('mysql_runtime_not_found', 'MySQL 运行时不存在或已结束')
  if (runtime.leaseExpiresAt <= Date.now() || Date.now() - runtime.lastUsedAt > Math.min(mysqlRuntimeLeaseMs, 5 * 60_000)) throw runtimeError('mysql_runtime_expired', 'MySQL 运行时租约已过期')
  return runtime
}

async function startMysqlRuntime(input) {
  assertMysqlRuntimeInput(input)
  const runtime = {
    id: randomUUID(), buildId: input.buildId, attemptId: input.attemptId, learningCaseId: input.learningCaseId, database: input.database, mysqlContractFingerprint: input.mysqlContractFingerprint,
    runtimeImageDigest: input.runtimeImageDigest, runtimeImageRef: input.runtimeImageRef,
    leaseMs: Math.min(input.leaseMs, mysqlRuntimeLeaseMs), containerName: `zhixing-case-mysql-${randomUUID()}`,
    containerId: '', sessions: {}, createdAt: now(), updatedAt: now(), lastUsedAt: Date.now(), leaseExpiresAt: Date.now() + Math.min(input.leaseMs, mysqlRuntimeLeaseMs),
  }
  await launchMysqlRuntime(runtime)
  mysqlRuntimes.set(runtime.id, runtime)
  return { runtimeId: runtime.id, leaseExpiresAt: new Date(runtime.leaseExpiresAt).toISOString() }
}

async function executeMysql(runtime, sessionId, statement) {
  if (!runtime.sessions[sessionId]) throw runtimeError('mysql_session_not_found', 'MySQL 会话不存在')
  if (typeof statement !== 'string' || !statement.trim() || Buffer.byteLength(statement, 'utf8') > 32 * 1024) throw runtimeError('invalid_request', 'SQL 语句无效')
  const started = Date.now()
  const result = await run('docker', ['exec', '-e', `MYSQL_PWD=${mysqlRootPassword}`, runtime.containerId, 'mysql', '-h', '127.0.0.1', '-uroot', '--database', runtime.database, '--batch', '--raw', '--connect-timeout=5', '-e', statement], { timeoutMs: mysqlExecutionTimeoutMs })
  runtime.lastUsedAt = Date.now(); runtime.leaseExpiresAt = Date.now() + runtime.leaseMs; runtime.updatedAt = now(); await persistRuntime(runtime)
  return { status: result.timedOut ? 'timed_out' : result.code === 0 ? 'succeeded' : 'failed', stdout: clean(result.stdout, maxLogBytes), stderr: clean(result.stderr, maxLogBytes), exitCode: result.timedOut ? null : result.code, durationMs: Date.now() - started }
}

async function cleanup(input) {
  const labels = [`label=zhixing.case-build=${input.buildId}`]
  if (input.attemptId) labels.push(`label=zhixing.case-attempt=${input.attemptId}`)
  const list = async (kind, role) => {
    const args = kind === 'image' ? ['image', 'ls', '-q'] : [kind, 'ls', '-q']
    for (const filter of [...labels, `label=zhixing.resource-role=${role}`]) args.push('--filter', filter)
    const result = await run('docker', args, { timeoutMs: 30_000 })
    if (result.code !== 0) throw new Error(clean(result.stderr || result.stdout))
    return result.stdout.trim().split(/\s+/).filter(Boolean)
  }
  const roles = input.retainRuntimeArtifact ? ['builder', 'candidate', 'preflight'] : ['builder', 'candidate', 'preflight', 'runtime_instance', 'runtime_artifact']
  for (const role of roles) {
    for (const id of await list('container', role)) await run('docker', ['rm', '-f', id], { timeoutMs: 30_000 })
    for (const id of await list('network', role)) await run('docker', ['network', 'rm', id], { timeoutMs: 30_000 })
    for (const id of await list('volume', role)) await run('docker', ['volume', 'rm', id], { timeoutMs: 30_000 })
    for (const id of await list('image', role)) await run('docker', ['image', 'rm', id], { timeoutMs: 30_000 })
  }
}

async function body(request) {
  const chunks = []; let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); total += buffer.length
    if (total > maxRequestBytes) throw runtimeError('request_too_large', '请求体超过 Case Builder 限制')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8'); return raw ? JSON.parse(raw) : {}
}

function send(reply, status, payload) { reply.statusCode = status; reply.setHeader('content-type', 'application/json; charset=utf-8'); reply.end(JSON.stringify(payload)) }
function notFound(reply) { return send(reply, 404, { error: { code: 'not_found', message: 'Case Builder 路径不存在' } }) }

async function route(request, reply) {
  if (request.method === 'GET' && request.url === '/health') return send(reply, configured() || simulated ? 200 : 503, { ready: configured() || simulated, dockerSocketEnabled: process.env.CASE_BUILDER_DOCKER_SOCKET_ENABLED === 'true', imagePinned: openHandsImage.includes('@sha256:'), simulated })
  if (!token || request.headers['x-case-builder-token'] !== token) return send(reply, 401, { error: { code: 'unauthorized', message: 'Case Builder token 无效' } })
  const url = new URL(request.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (request.method === 'POST' && url.pathname === '/internal/v1/environment-builds') {
      const input = await body(request); assertInput(input)
      const task = { id: randomUUID(), input, status: 'queued', events: [], manifest: null, failure: null, createdAt: now(), updatedAt: now() }
      tasks.set(task.id, task); event(task, { type: 'status', summary: '已接受环境构建任务，等待 Builder 容量' }); await persist(task); enqueueTask(task)
      return send(reply, 202, { taskId: task.id })
    }
    if (request.method === 'POST' && url.pathname === '/internal/v1/environment-builds/cleanup') { await cleanup(await body(request)); return send(reply, 204, {}) }
    if (request.method === 'POST' && url.pathname === '/internal/v1/mysql-runtimes') return send(reply, 201, await startMysqlRuntime(await body(request)))
    const runtimeId = parts[3]
    if (runtimeId && parts.slice(0, 3).join('/') === 'internal/v1/mysql-runtimes') {
      // End is deliberately idempotent, including for an already-expired
      // runtime, so the scheduler can always release a 20-minute lease.
      if (request.method === 'POST' && parts.length === 5 && parts[4] === 'end') {
        const runtime = mysqlRuntimes.get(runtimeId)
        if (runtime) {
          await stopMysqlRuntime(runtime)
          mysqlRuntimes.delete(runtime.id)
          await removeRuntimeState(runtime.id)
        }
        return send(reply, 204, {})
      }
      const runtime = mysqlRuntime(runtimeId)
      if (request.method === 'POST' && parts.length === 5 && parts[4] === 'reset') { await resetMysqlRuntime(runtime); return send(reply, 204, {}) }
      if (request.method === 'POST' && parts.length === 5 && parts[4] === 'sessions') {
        const input = await body(request); const name = typeof input.name === 'string' && input.name === 'default' ? input.name : null
        if (!name) throw runtimeError('invalid_request', 'MySQL 会话名称无效')
        const sessionId = randomUUID(); runtime.sessions[sessionId] = { name, createdAt: now() }; runtime.lastUsedAt = Date.now(); runtime.leaseExpiresAt = Date.now() + runtime.leaseMs; await persistRuntime(runtime)
        return send(reply, 201, { sessionId })
      }
      if (request.method === 'POST' && parts.length === 7 && parts[4] === 'sessions' && parts[6] === 'executions') return send(reply, 200, await executeMysql(runtime, parts[5], (await body(request)).statement))
      if (request.method === 'POST' && parts.length === 7 && parts[4] === 'sessions' && parts[6] === 'end') { delete runtime.sessions[parts[5]]; await persistRuntime(runtime); return send(reply, 204, {}) }
      return notFound(reply)
    }
    const taskId = parts[3]
    const task = taskId ? tasks.get(taskId) : null
    if (!task || parts.slice(0, 3).join('/') !== 'internal/v1/environment-builds') return notFound(reply)
    if (request.method === 'GET' && parts.length === 4) return send(reply, 200, { taskId: task.id, status: task.status, manifest: task.manifest, failure: task.failure, updatedAt: task.updatedAt })
    if (request.method === 'GET' && parts[4] === 'events') { const after = Number(url.searchParams.get('afterSequence') ?? 0); const events = task.events.filter((item) => item.sequence > (Number.isInteger(after) && after >= 0 ? after : 0)); return send(reply, 200, { events, nextSequence: events.at(-1)?.sequence ?? after }) }
    if (request.method === 'POST' && parts[4] === 'cancel') {
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'cancelled'
        event(task, { type: 'status', summary: '任务已取消' })
        if (dockerSocketEnabled) await run('docker', ['rm', '-f', `zhixing-case-builder-${task.id}`], { timeoutMs: 15_000 }).catch(() => undefined)
        await persist(task)
      }
      return send(reply, 204, {})
    }
    return notFound(reply)
  } catch (error) { return send(reply, 400, { error: { code: error?.code ?? 'invalid_request', message: clean(error instanceof Error ? error.message : '请求无效') } }) }
}

await restore()
for (const task of tasks.values()) if (task.status === 'queued') enqueueTask(task)
const server = createServer((request, reply) => { void route(request, reply) })
const bindHost = process.env.CASE_BUILDER_BIND_HOST ?? '0.0.0.0'
server.listen(port, bindHost, () => console.log(`[case-builder-agent] listening on ${bindHost}:${port}`))
const runtimeReaper = setInterval(() => {
  for (const runtime of mysqlRuntimes.values()) {
    if (runtime.leaseExpiresAt <= Date.now() || Date.now() - runtime.lastUsedAt > Math.min(mysqlRuntimeLeaseMs, 5 * 60_000)) {
      void stopMysqlRuntime(runtime).finally(async () => { mysqlRuntimes.delete(runtime.id); await removeRuntimeState(runtime.id) })
    }
  }
}, 30_000)
runtimeReaper.unref()
const shutdown = async () => {
  clearInterval(runtimeReaper)
  await Promise.all([...mysqlRuntimes.values()].map((runtime) => stopMysqlRuntime(runtime)))
  server.close()
}
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
