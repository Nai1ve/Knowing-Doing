import { describe, expect, it } from 'vitest'
import { environmentBuildManifestSchema, safeBuildText } from '../src/environment-build.js'
import { EnvironmentRuntimeReferenceError, signEnvironmentRuntimeReference, verifyEnvironmentRuntimeReference } from '../src/environment-runtime-reference.js'

const digest = `sha256:${'a'.repeat(64)}`

describe('environment build contracts', () => {
  it('requires a runtime digest and MySQL initialization assets', () => {
    const parsed = environmentBuildManifestSchema.safeParse({
      protocolVersion: 1,
      runtimeKind: 'mysql_lab',
      environment: { key: 'mysql-performance-v1', version: '1', runtimeImageDigest: digest },
      starterFiles: [], referenceFiles: [], verification: { commandKeys: ['explain'], successSignals: ['key'] }, resources: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('redacts credentials before diagnostic events are persisted', () => {
    expect(safeBuildText('Authorization: Bearer secret-token\napi_key=abc123\nsk-this-must-not-appear')).not.toContain('secret-token')
    expect(safeBuildText('postgres://user:password@example.test/db')).toContain('[redacted]')
  })

  it('issues short-lived signed runtime references and rejects tampering', () => {
    const issuedAt = Date.now()
    const reference = signEnvironmentRuntimeReference({
      buildId: 'build-1', learningCaseId: 'case-1', runtimeKind: 'docker_workspace', environmentKey: 'python-pytest-v1', environmentVersion: '1',
      runtimeImageDigest: digest, runtimeImageReference: `registry.example/python@${digest}`, manifestFingerprint: 'b'.repeat(64),
      requiredLabels: { 'zhixing.case-build': 'build-1' }, issuedAt, expiresAt: issuedAt + 60_000,
    }, 'test-signing-key')
    expect(verifyEnvironmentRuntimeReference(reference, 'test-signing-key', issuedAt + 1)).toMatchObject({ buildId: 'build-1', runtimeKind: 'docker_workspace' })
    expect(() => verifyEnvironmentRuntimeReference(`${reference}x`, 'test-signing-key', issuedAt + 1)).toThrow(EnvironmentRuntimeReferenceError)
    expect(() => verifyEnvironmentRuntimeReference(reference, 'test-signing-key', issuedAt + 60_001)).toThrow(/过期/)
  })
})
