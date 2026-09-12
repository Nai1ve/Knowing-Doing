import { createHmac, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { RuntimeKind } from './product-types.js'

const protocolVersion = 1
const digestPattern = /^sha256:[a-f0-9]{64}$/i

export interface EnvironmentRuntimeReferenceClaims {
  version: typeof protocolVersion
  buildId: string
  learningCaseId: string
  runtimeKind: RuntimeKind
  environmentKey: string
  environmentVersion: string
  runtimeImageDigest: string
  runtimeImageReference: string
  manifestFingerprint: string
  requiredLabels: Record<string, string>
  issuedAt: number
  expiresAt: number
}

export class EnvironmentRuntimeReferenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'EnvironmentRuntimeReferenceError'
  }
}

function encode(value: string): string { return Buffer.from(value, 'utf8').toString('base64url') }
function decode(value: string): string { return Buffer.from(value, 'base64url').toString('utf8') }
function signature(body: string, secret: string): string { return createHmac('sha256', secret).update(body).digest('base64url') }

function validateClaims(value: unknown, now = Date.now()): EnvironmentRuntimeReferenceClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用内容无效')
  const claims = value as Partial<EnvironmentRuntimeReferenceClaims>
  if (claims.version !== protocolVersion || typeof claims.buildId !== 'string' || !claims.buildId || typeof claims.learningCaseId !== 'string' || !claims.learningCaseId) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用缺少构建标识')
  if (claims.runtimeKind !== 'docker_workspace' && claims.runtimeKind !== 'mysql_lab') throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用运行时无效')
  if (typeof claims.environmentKey !== 'string' || !claims.environmentKey || typeof claims.environmentVersion !== 'string' || !claims.environmentVersion) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用缺少环境版本')
  if (typeof claims.runtimeImageDigest !== 'string' || !digestPattern.test(claims.runtimeImageDigest) || typeof claims.runtimeImageReference !== 'string' || !claims.runtimeImageReference) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用镜像 digest 无效')
  if (typeof claims.manifestFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(claims.manifestFingerprint)) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用清单指纹无效')
  if (!claims.requiredLabels || typeof claims.requiredLabels !== 'object' || Array.isArray(claims.requiredLabels) || Object.entries(claims.requiredLabels).some(([key, item]) => !key || typeof item !== 'string' || !item)) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用标签无效')
  const issuedAt = claims.issuedAt
  const expiresAt = claims.expiresAt
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number' || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt <= issuedAt) throw new EnvironmentRuntimeReferenceError('environment_reference_expired', '环境引用已过期')
  return claims as EnvironmentRuntimeReferenceClaims
}

export function signEnvironmentRuntimeReference(claims: Omit<EnvironmentRuntimeReferenceClaims, 'version'>, secret: string): string {
  if (!secret) throw new EnvironmentRuntimeReferenceError('environment_reference_signing_unavailable', '环境引用签名密钥尚未配置')
  const full: EnvironmentRuntimeReferenceClaims = { version: protocolVersion, ...claims }
  validateClaims(full, full.issuedAt - 1)
  const body = encode(JSON.stringify(full))
  return `${body}.${signature(body, secret)}`
}

export function verifyEnvironmentRuntimeReference(reference: string, secret: string, now = Date.now()): EnvironmentRuntimeReferenceClaims {
  if (!secret) throw new EnvironmentRuntimeReferenceError('environment_reference_signing_unavailable', '环境引用签名密钥尚未配置')
  const [body, suppliedSignature, ...extra] = reference.split('.')
  if (!body || !suppliedSignature || extra.length > 0) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用格式无效')
  const expectedSignature = signature(body, secret)
  const actual = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new EnvironmentRuntimeReferenceError('environment_reference_invalid_signature', '环境引用签名无效')
  try {
    return validateClaims(JSON.parse(decode(body)), now)
  } catch (error) {
    if (error instanceof EnvironmentRuntimeReferenceError) throw error
    throw new EnvironmentRuntimeReferenceError('environment_reference_invalid', '环境引用内容无效')
  }
}

type Row = Record<string, unknown>
const text = (row: Row, key: string): string => String(row[key])
const json = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback } catch { return fallback }
}

/**
 * Reads only server-owned runtime bindings and issues short-lived, signed
 * references for internal Runner calls. Browser/API callers never see image
 * references, labels, manifests, or this signature.
 */
export class EnvironmentRuntimeReferenceService {
  constructor(private readonly db: Database.Database, private readonly signingKey: string, private readonly ttlMs = 10 * 60_000) {}

  referenceForCase(input: { learnerId: string; learningCaseId: string; runtimeKind: RuntimeKind; environmentKey: string; environmentVersion: string }): string | null {
    const row = this.db.prepare(`SELECT b.learning_case_id, b.gym_build_job_id, b.runtime_kind, b.runtime_image_digest, b.runtime_image_ref, b.manifest_fingerprint, b.resource_lease_json, b.status AS binding_status,
      j.environment_key, j.environment_version, j.protocol_version, j.status AS build_status
      FROM environment_runtime_bindings b
      INNER JOIN gym_build_jobs j ON j.id = b.gym_build_job_id
      WHERE b.learner_id = ? AND b.learning_case_id = ? AND b.runtime_kind = ?
        AND b.status IN ('ready', 'active') AND j.status IN ('running', 'ready', 'cleanup_pending')
      ORDER BY b.updated_at DESC LIMIT 1`).get(input.learnerId, input.learningCaseId, input.runtimeKind) as Row | undefined
    if (!row) return null
    if (text(row, 'environment_key') !== input.environmentKey || text(row, 'environment_version') !== input.environmentVersion) return null
    const lease = json<{ attemptId?: unknown }>(row.resource_lease_json, {})
    if (typeof lease.attemptId !== 'string' || !lease.attemptId) return null
    const now = Date.now()
    return signEnvironmentRuntimeReference({
      buildId: text(row, 'gym_build_job_id'),
      learningCaseId: text(row, 'learning_case_id'),
      runtimeKind: text(row, 'runtime_kind') as RuntimeKind,
      environmentKey: text(row, 'environment_key'),
      environmentVersion: text(row, 'environment_version'),
      runtimeImageDigest: text(row, 'runtime_image_digest'),
      runtimeImageReference: text(row, 'runtime_image_ref') || text(row, 'runtime_image_digest'),
      manifestFingerprint: text(row, 'manifest_fingerprint'),
      requiredLabels: {
        'zhixing.case-build': text(row, 'gym_build_job_id'),
        'zhixing.case-attempt': lease.attemptId,
        'zhixing.protocol-version': text(row, 'protocol_version'),
        'zhixing.resource-role': 'runtime_artifact',
        'zhixing.runtime-kind': text(row, 'runtime_kind'),
        'zhixing.environment-key': text(row, 'environment_key'),
        'zhixing.environment-version': text(row, 'environment_version'),
      },
      issuedAt: now,
      expiresAt: now + this.ttlMs,
    }, this.signingKey)
  }
}

export interface EnvironmentRuntimeReferenceProvider {
  referenceForCase(input: { learnerId: string; learningCaseId: string; runtimeKind: RuntimeKind; environmentKey: string; environmentVersion: string }): string | null
}
