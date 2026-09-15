import { describe, expect, it, vi } from 'vitest'
import { environmentBuildManifestSchema, validateEnvironmentManifest, type EnvironmentBuildManifest, type OpenHandsMySqlBuildContract } from '../src/environment-build.js'
import { HttpOpenHandsBuildAdapter } from '../src/openhands-build-adapter.js'

const DIGEST = `sha256:${'0'.repeat(64)}`
const FINGERPRINT = 'a'.repeat(64)

function manifest(overrides: Partial<EnvironmentBuildManifest> = {}): EnvironmentBuildManifest {
  return {
    protocolVersion: 1,
    runtimeKind: 'docker_workspace',
    environment: { key: 'py-v1', version: '1', runtimeImageDigest: DIGEST, runtimeImageRef: DIGEST },
    starterFiles: [{ path: 'tests/test_environment.py', content: 'def test_environment():\n    assert True\n' }],
    referenceFiles: [{ path: 'solution.py', content: 'def ready():\n    return True\n' }],
    verification: { commandKeys: ['pytest'], successSignals: ['PASSED'] },
    resources: [{ kind: 'image', id: DIGEST, role: 'runtime_artifact', labels: {
      'zhixing.case-build': 'build-1', 'zhixing.case-attempt': 'attempt-1', 'zhixing.protocol-version': '1',
      'zhixing.resource-role': 'runtime_artifact', 'zhixing.runtime-kind': 'docker_workspace',
      'zhixing.runtime-image-digest': DIGEST, 'zhixing.environment-key': 'py-v1', 'zhixing.environment-version': '1',
    } }],
    ...overrides,
  }
}

const context = { jobId: 'build-1', attemptId: 'attempt-1', runtimeKind: 'docker_workspace' as const, environmentKey: 'py-v1', environmentVersion: '1', mysqlContract: null as OpenHandsMySqlBuildContract | null }

describe('backend to Case Builder HTTP contract', () => {
  it('rejects an illegal Manifest via the adapter status schema', async () => {
    const adapter = new HttpOpenHandsBuildAdapter({ baseUrl: 'http://builder.test', token: 'token', timeoutMs: 1000 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ taskId: 'task-1', status: 'succeeded', manifest: { protocolVersion: 1, runtimeKind: 'mysql_lab', environment: { key: 'x' }, verification: {} }, updatedAt: new Date().toISOString() }), { status: 200 })) as typeof fetch
    await expect(adapter.status('task-1')).rejects.toThrow()
    void fetchMock
  })

  it('rejects an unknown (non-sha256) runtime image digest', () => {
    expect(() => environmentBuildManifestSchema.parse(manifest({ environment: { key: 'py-v1', version: '1', runtimeImageDigest: 'not-a-digest' } }))).toThrow()
  })

  it('rejects wrong resource labels against the server-side manifest fence', () => {
    const bad = manifest({ resources: [{ kind: 'image', id: DIGEST, role: 'runtime_artifact', labels: { 'zhixing.case-build': 'other-build' } }] })
    expect(() => validateEnvironmentManifest(bad, context)).toThrow(/构建标签/)
  })

  it('rejects an unauthorized MySQL contract mismatch', () => {
    const mysqlContract: OpenHandsMySqlBuildContract = { learningCaseId: 'case-1', database: 'zhixing_dynamic_1234567890ab', materializationFingerprint: FINGERPRINT, schemaSql: 'CREATE TABLE t (id INT)', seed: { rowCount: 5000, distribution: 'uniform' }, faultSql: 'ALTER TABLE t DROP PRIMARY KEY', starterExplain: 'plan', referenceSql: 'SELECT 1' }
    const bad = manifest({ runtimeKind: 'mysql_lab' as const, environment: { key: 'mysql-performance-v1', version: '1', runtimeImageDigest: DIGEST, runtimeImageRef: DIGEST }, verification: { commandKeys: ['mysql_explain'], successSignals: [] }, mysql: { contractFingerprint: 'b'.repeat(64), initializationSql: ['CREATE TABLE t (id INT)'], starterExplain: 'plan', referenceSql: ['SELECT 1'] }, resources: [{ kind: 'image', id: DIGEST, role: 'runtime_artifact', labels: { 'zhixing.case-build': 'build-1', 'zhixing.case-attempt': 'attempt-1', 'zhixing.protocol-version': '1', 'zhixing.resource-role': 'runtime_artifact', 'zhixing.runtime-kind': 'mysql_lab', 'zhixing.runtime-image-digest': DIGEST, 'zhixing.environment-key': 'mysql-performance-v1', 'zhixing.environment-version': '1' } }] })
    expect(() => validateEnvironmentManifest(bad, { ...context, runtimeKind: 'mysql_lab', environmentKey: 'mysql-performance-v1', mysqlContract })).toThrow(/物料不一致/)
  })

  it('rejects an invalid (unauthorized) MySQL execution response', async () => {
    const adapter = new HttpOpenHandsBuildAdapter({ baseUrl: 'http://builder.test', token: 'token', timeoutMs: 1000 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'succeeded', stdout: 42 }), { status: 200 })) as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(adapter.executeMySql('runtime-1', 'session-1', 'SELECT 1')).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
