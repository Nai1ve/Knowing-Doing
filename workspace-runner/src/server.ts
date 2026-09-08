import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { URL } from 'node:url'
import { isValidPythonCommand, isValidWorkspacePath, MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES } from './validation.js'

const port = Number(process.env.WORKSPACE_RUNNER_PORT ?? 3101)
const token = process.env.WORKSPACE_RUNNER_TOKEN ?? 'development-workspace-runner-token'
const image = process.env.WORKSPACE_PYTHON_IMAGE ?? 'zhixing-python-pytest-v1:local'
const maxOutputBytes = 1024 * 1024
const leaseMs = 30 * 60_000
const idleMs = 5 * 60_000

type Run = { id: string; containerId: string; files: Map<string, number>; commands: Set<string>; leaseExpiresAt: number; lastUsedAt: number; ended: boolean }
const runs = new Map<string, Run>()

class RunnerError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); this.name = 'RunnerError' }
}

function send(reply: ServerResponse, status: number, body: unknown): void {
  reply.statusCode = status; reply.setHeader('content-type', 'application/json; charset=utf-8'); reply.end(JSON.stringify(body))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RunnerError('invalid_request', '请求体必须是对象')
  return parsed as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, key: string): string {
  const item = value[key]; if (typeof item !== 'string' || !item.trim()) throw new RunnerError('invalid_request', `${key} 不能为空`); return item.trim()
}

const validPath = isValidWorkspacePath
const validCommand = isValidPythonCommand

async function docker(args: string[], options: { input?: string; timeout?: number; allowNonZero?: boolean } = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }); const stdout: Buffer[] = []; const stderr: Buffer[] = []; let total = 0; let stderrTotal = 0; let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeout ?? 10_000)
    child.stdout.on('data', (chunk: Buffer) => { if (total < maxOutputBytes) { stdout.push(chunk.subarray(0, Math.max(0, maxOutputBytes - total))); total += chunk.length } })
    child.stderr.on('data', (chunk: Buffer) => { if (stderrTotal < maxOutputBytes) { stderr.push(chunk.subarray(0, maxOutputBytes - stderrTotal)); stderrTotal += chunk.length } })
    child.once('error', (error) => { clearTimeout(timer); reject(new RunnerError('docker_error', error.message, 503)) })
    child.once('close', (code) => { clearTimeout(timer); if (timedOut) return reject(new RunnerError('execution_timeout', '容器命令超时', 408)); const out = Buffer.concat(stdout).toString('utf8'); const err = Buffer.concat(stderr).toString('utf8'); const exitCode = code ?? 1; if (exitCode !== 0 && !options.allowNonZero) return reject(new RunnerError('docker_error', err.slice(0, 1000) || `docker exit ${String(code)}`, 503)); resolve({ stdout: out, stderr: err, exitCode }) })
    if (options.input) child.stdin.write(options.input); child.stdin.end()
  })
}

const writeScript = "import os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p),exist_ok=True); open(p,'wb').write(sys.stdin.buffer.read())"

async function writeContainerFile(run: Run, path: string, content: string): Promise<void> {
  if (!validPath(path)) throw new RunnerError('invalid_file_path', '文件路径不受支持')
  if (content.length > MAX_FILE_BYTES) throw new RunnerError('file_too_large', '文件内容过大', 422)
  await docker(['exec', '-i', run.containerId, 'python', '-c', writeScript, `/workspace/${path}`], { input: content, timeout: 10_000 }); run.files.set(path, (run.files.get(path) ?? 0) + 1); run.lastUsedAt = Date.now(); run.leaseExpiresAt = Date.now() + leaseMs
}

const clearScript = "import os,shutil; p='/workspace'; [shutil.rmtree(os.path.join(p,n)) if os.path.isdir(os.path.join(p,n)) else os.remove(os.path.join(p,n)) for n in os.listdir(p)]"

async function clearContainerFiles(run: Run): Promise<void> {
  await docker(['exec', run.containerId, 'python', '-c', clearScript], { timeout: 10_000 })
  run.files.clear()
}

async function createRun(input: Record<string, unknown>): Promise<{ runnerRunId: string; leaseExpiresAt: string }> {
  if (stringField(input, 'templateKey') !== 'python-pytest-v1') throw new RunnerError('template_not_available', '只支持 python-pytest-v1', 409)
  const files = input.files; const commands = input.commands; if (!Array.isArray(files) || !Array.isArray(commands)) throw new RunnerError('invalid_request', 'files 和 commands 必须是数组')
  if (files.length < 1 || files.length > 10 || commands.length < 1) throw new RunnerError('invalid_request', '工作区文件或命令数量无效')
  const paths = new Set<string>(); let totalBytes = 0
  for (const item of files) {
    if (!item || typeof item !== 'object') throw new RunnerError('invalid_file', '文件格式无效')
    const file = item as Record<string, unknown>; const path = stringField(file, 'path'); const content = file.content
    if (!validPath(path) || paths.has(path) || typeof content !== 'string' || content.length > MAX_FILE_BYTES) throw new RunnerError('invalid_file', '文件格式无效')
    paths.add(path); totalBytes += Buffer.byteLength(content, 'utf8')
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) throw new RunnerError('invalid_file', '工作区文件总大小过大', 422)
  const allowed = new Set(commands.map((item) => String(item).trim())); const id = randomUUID()
  const created = await docker(['run', '-d', '--rm', '--name', `zhixing-ws-${id}`, '--network', 'none', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/workspace:rw,nosuid,nodev,size=32m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--workdir', '/workspace', image, 'tail', '-f', '/dev/null'])
  const containerId = created.stdout.trim(); const run: Run = { id, containerId, files: new Map(), commands: allowed, leaseExpiresAt: Date.now() + leaseMs, lastUsedAt: Date.now(), ended: false }; runs.set(id, run)
  try { for (const item of files) { const file = item as Record<string, unknown>; await writeContainerFile(run, stringField(file, 'path'), file.content as string) } } catch (error) { await endRun(run).catch(() => undefined); throw error }
  return { runnerRunId: id, leaseExpiresAt: new Date(run.leaseExpiresAt).toISOString() }
}

async function endRun(run: Run): Promise<void> { if (run.ended) return; run.ended = true; runs.delete(run.id); await docker(['rm', '-f', run.containerId], { timeout: 10_000 }).catch(() => undefined) }

async function route(request: IncomingMessage, reply: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    try { await docker(['image', 'inspect', image], { timeout: 5_000 }); return send(reply, 200, { ready: true, dockerReady: true, template: image }) } catch { return send(reply, 503, { ready: false, dockerReady: false, template: image }) }
  }
  if (request.headers['x-workspace-runner-token'] !== token) return send(reply, 401, { error: { code: 'unauthorized', message: 'Runner token 无效' } })
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`); const parts = url.pathname.split('/').filter(Boolean); const runId = parts[3] ?? null
  try {
    if (request.method === 'POST' && url.pathname === '/internal/v1/workspace-runs') return send(reply, 201, await createRun(await body(request)))
    if (!runId || !url.pathname.startsWith('/internal/v1/workspace-runs/')) throw new RunnerError('not_found', 'Runner 路径不存在', 404)
    const run = runs.get(runId); if (!run || run.ended) throw new RunnerError('runner_run_not_found', 'Runner 工作区不存在', 404)
    if (request.method === 'GET' && parts.length === 4) return send(reply, 200, { status: 'active', leaseExpiresAt: new Date(run.leaseExpiresAt).toISOString() })
    if (request.method === 'PUT' && parts[4] === 'files') {
      const path = decodeURIComponent(parts.slice(5).join('/')); const input = await body(request); const expected = Number(input.expectedRevision); const current = run.files.get(path) ?? 0; if (!Number.isInteger(expected) || expected !== current) throw new RunnerError('file_revision_conflict', 'Runner 文件版本冲突', 409); const content = input.content; if (typeof content !== 'string' || content.length > 262144) throw new RunnerError('file_too_large', '文件内容过大', 422); await writeContainerFile(run, path, content); return send(reply, 200, { revision: current + 1 })
    }
    if (request.method === 'POST' && parts[4] === 'executions') {
      const input = await body(request); const command = stringField(input, 'command'); if (!validCommand(command, run.commands)) throw new RunnerError('unsupported_command', '命令不在 Runner allowlist 内', 400); const started = Date.now(); const args = command === 'pytest -q' ? ['exec', run.containerId, 'python', '-m', 'pytest', '-q'] : ['exec', run.containerId, ...command.split(/\s+/)];
      try {
        const result = await docker(args, { timeout: 30_000, allowNonZero: true })
        return send(reply, 200, { runnerExecutionId: randomUUID(), status: result.exitCode === 0 ? 'succeeded' : 'failed', stdout: result.stdout.slice(0, maxOutputBytes), stderr: result.stderr.slice(0, maxOutputBytes), exitCode: result.exitCode, durationMs: Date.now() - started })
      } catch (error) {
        if (error instanceof RunnerError && error.code === 'execution_timeout') {
          await endRun(run)
          return send(reply, 200, { runnerExecutionId: randomUUID(), status: 'timed_out', stdout: '', stderr: error.message, exitCode: null, durationMs: Date.now() - started })
        }
        throw error
      }
    }
    if (request.method === 'POST' && parts[4] === 'reset') { const input = await body(request); const files = input.files; if (!Array.isArray(files) || files.length < 1 || files.length > 10) throw new RunnerError('invalid_request', 'files 必须是 1 到 10 个文件'); await clearContainerFiles(run); for (const item of files) { const file = item as Record<string, unknown>; if (typeof file.content !== 'string') throw new RunnerError('invalid_file', '文件格式无效'); await writeContainerFile(run, stringField(file, 'path'), file.content) }; return send(reply, 204, {}) }
    if (request.method === 'POST' && parts[4] === 'end') { await endRun(run); return send(reply, 204, {}) }
    throw new RunnerError('not_found', 'Runner 路径不存在', 404)
  } catch (error) { if (error instanceof RunnerError) return send(reply, error.statusCode, { error: { code: error.code, message: error.message } }); return send(reply, 500, { error: { code: 'runner_internal_error', message: 'Runner 内部错误' } }) }
}

const server = createServer((request, reply) => { void route(request, reply) })
server.listen(port, '0.0.0.0', () => console.log(`[workspace-runner] listening on ${port}`))
const cleanup = async () => { await Promise.all([...runs.values()].map((run) => endRun(run))); server.close(); process.exit(0) }
process.once('SIGTERM', () => { void cleanup() }); process.once('SIGINT', () => { void cleanup() })
setInterval(() => { for (const run of runs.values()) if (Date.now() > run.leaseExpiresAt || Date.now() - run.lastUsedAt > idleMs) void endRun(run) }, 30_000).unref()
