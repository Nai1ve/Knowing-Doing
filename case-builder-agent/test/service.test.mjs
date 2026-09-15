import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCaseBuilderService } from '../src/service.mjs'

const DIGEST = `sha256:${'0'.repeat(64)}`
const FINGERPRINT = 'a'.repeat(64)

function buildInput(overrides = {}) {
  return {
    protocolVersion: 1, buildId: 'build-1', attemptId: 'attempt-1', runtimeKind: 'docker_workspace',
    environment: { environmentKey: 'py-v1', environmentVersion: '1' },
    successCriteria: { commandKeys: ['pytest'], successSignals: ['PASSED'] },
    limits: { timeoutMs: 60000, maxLogBytes: 4096 },
    ...overrides,
  }
}

function makeService(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'case-builder-'))
  const service = createCaseBuilderService({ stateDir: dir, token: 'secret', simulated: true, ...options })
  return { service, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function req({ method = 'POST', url = '/internal/v1/environment-builds', headers = {}, body = null } = {}) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))]
  let sent = false
  return { method, url, headers, [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c } }
}
function rep() {
  const r = { statusCode: 0, headers: {}, body: '' }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = (t) => { r.body = t }
  return r
}
const auth = () => ({ 'x-case-builder-token': 'secret' })

test('route rejects unauthorized requests and accepts health without auth', async () => {
  const { service, cleanup } = makeService()
  try {
    const ok = rep(); await service.route(req({ method: 'GET', url: '/health' }), ok)
    assert.equal(ok.statusCode, 200)
    const bad = rep(); await service.route(req({ headers: { 'x-case-builder-token': 'wrong' }, body: buildInput() }), bad)
    assert.equal(bad.statusCode, 401)
    assert.equal(JSON.parse(bad.body).error.code, 'unauthorized')
  } finally { await service.shutdown(); cleanup() }
})

test('parameter limits reject bad protocol, bounds, and oversized bodies', async () => {
  const { service, cleanup } = makeService()
  try {
    assert.throws(() => service.assertInput({ ...buildInput(), protocolVersion: 2 }), /协议版本/)
    assert.throws(() => service.assertInput({ ...buildInput(), limits: { timeoutMs: 1e9, maxLogBytes: 4096 } }), /资源限制/)
    assert.throws(() => service.assertInput({ ...buildInput(), runtimeKind: 'mysql_lab', mysqlContract: null }), /MySQL 案例构建契约无效/)
    const big = rep(); await service.route(req({ headers: auth(), body: { ...buildInput(), padding: 'x'.repeat(3 * 1024 * 1024) } }), big)
    assert.equal(big.statusCode, 400)
    assert.equal(JSON.parse(big.body).error.code, 'request_too_large')
  } finally { await service.shutdown(); cleanup() }
})

test('event cursor returns only events after the requested sequence', async () => {
  const { service, cleanup } = makeService()
  try {
    const { taskId } = await service.createTask(buildInput())
    const first = service.getTaskEvents(taskId, 0)
    assert.ok(first.events.length >= 1)
    assert.equal(first.nextSequence, first.events.at(-1).sequence)
    const second = service.getTaskEvents(taskId, first.events[0].sequence)
    assert.ok(second.events.every((e) => e.sequence > first.events[0].sequence))
  } finally { await service.shutdown(); cleanup() }
})

test('log redaction masks credentials and truncates long output', async () => {
  const { service, cleanup } = makeService()
  try {
    const cleaned = service.clean('api_key=sk-super-secret-123 password=hunter2 plain')
    assert.ok(!cleaned.includes('sk-super-secret'))
    assert.ok(!cleaned.includes('hunter2'))
    assert.equal(service.clean('x'.repeat(5000), 100).length, 100 + '\n…[truncated]'.length)
  } finally { await service.shutdown(); cleanup() }
})

test('task cancellation prevents execution and marks the task cancelled', async () => {
  const { service, cleanup } = makeService()
  try {
    const { taskId } = await service.createTask(buildInput())
    await service.cancelTask(taskId)
    assert.equal(service.getTask(taskId).status, 'cancelled')
  } finally { await service.shutdown(); cleanup() }
})

test('single-file Manifest constraint rejects missing or duplicate runtime artifacts', async () => {
  const { service, cleanup } = makeService({ runner: async () => ({ code: 0, stdout: '[]', stderr: '' }) })
  try {
    const base = { environment: { runtimeImageDigest: DIGEST, runtimeImageRef: DIGEST }, resources: [] }
    await assert.rejects(() => service.verifyRuntimeArtifact({ input: buildInput(), manifest: { ...base, resources: [] } }), /恰好包含一个/)
    const dup = [{ kind: 'image', role: 'runtime_artifact', labels: {} }, { kind: 'image', role: 'runtime_artifact', labels: {} }]
    await assert.rejects(() => service.verifyRuntimeArtifact({ input: buildInput(), manifest: { ...base, resources: dup } }), /恰好包含一个/)
  } finally { await service.shutdown(); cleanup() }
})

test('manifest label sanitization validates build and attempt labels', async () => {
  const { service, cleanup } = makeService({ runner: async () => ({ code: 0, stdout: '[]', stderr: '' }) })
  try {
    const manifest = { environment: { runtimeImageDigest: DIGEST, runtimeImageRef: DIGEST }, resources: [{ kind: 'image', role: 'runtime_artifact', labels: { 'zhixing.case-build': 'wrong-build' } }] }
    await assert.rejects(() => service.verifyRuntimeArtifact({ input: buildInput(), manifest }), /标签/)
  } finally { await service.shutdown(); cleanup() }
})

test('MySQL controlled execution validates inputs and bounds statement size', async () => {
  const { service, cleanup } = makeService({ token: 'secret', simulated: false, dockerSocketEnabled: true, mysqlRootPassword: 'root', runner: async () => ({ code: 0, stdout: '', stderr: '' }) })
  try {
    assert.throws(() => service.assertMysqlRuntimeInput({ buildId: 'b', attemptId: 'a', learningCaseId: 'c', database: 'zhixing_dynamic_x', mysqlContractFingerprint: FINGERPRINT, runtimeImageDigest: 'bad', runtimeImageRef: DIGEST, leaseMs: 10 * 60_000 }), /digest 无效/i)
    assert.throws(() => service.assertMysqlRuntimeInput({ buildId: 'b', attemptId: 'a', learningCaseId: 'c', database: 'x', mysqlContractFingerprint: FINGERPRINT, runtimeImageDigest: DIGEST, runtimeImageRef: DIGEST, leaseMs: 10 * 60_000 }), /数据库无效/)
  } finally { await service.shutdown(); cleanup() }
})
