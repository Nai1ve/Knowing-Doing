import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { RuntimeKind } from './product-types.js'

export const ENVIRONMENT_BUILD_PROTOCOL_VERSION = 1
export const environmentBuildPhases = ['designing', 'provisioning', 'initializing', 'preflighting', 'repairing'] as const
export const environmentBuildTerminalPhases = ['ready', 'failed', 'cleanup_pending'] as const
export const environmentBuildStatuses = ['queued', 'running', ...environmentBuildTerminalPhases] as const
export const environmentBuildFailureCategories = ['platform_fault', 'agent_failure', 'preflight_failure'] as const

export type EnvironmentBuildPhase = typeof environmentBuildPhases[number]
export type EnvironmentBuildTerminalPhase = typeof environmentBuildTerminalPhases[number]
export type EnvironmentBuildStatus = typeof environmentBuildStatuses[number]
export type EnvironmentBuildFailureCategory = typeof environmentBuildFailureCategories[number]

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/i, '镜像必须使用 sha256 digest')
const imageReference = z.string().min(1).max(512).regex(/@sha256:[a-f0-9]{64}$/i, '镜像引用必须固定到 sha256 digest')
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i, '物料指纹必须是 sha256')
const file = z.object({ path: z.string().min(1).max(180), content: z.string().max(2 * 1024 * 1024) }).strict()
const resource = z.object({
  kind: z.enum(['container', 'network', 'volume', 'image']),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256).optional(),
  role: z.enum(['builder', 'candidate', 'preflight', 'runtime_artifact']),
  labels: z.record(z.string(), z.string()).default({}),
}).strict()

/**
 * The only artifact an OpenHands task may hand back to the product service.
 * The server resolves command keys and checks image labels independently; the
 * manifest is deliberately not a command execution authority.
 */
export const environmentBuildManifestSchema = z.object({
  protocolVersion: z.literal(ENVIRONMENT_BUILD_PROTOCOL_VERSION),
  runtimeKind: z.enum(['mysql_lab', 'docker_workspace']),
  environment: z.object({
    key: z.string().min(1).max(80),
    version: z.string().min(1).max(24),
    baseImageDigest: digest.optional(),
    runtimeImageDigest: digest,
    runtimeImageRef: imageReference.optional(),
  }).strict(),
  starterFiles: z.array(file).max(10).default([]),
  referenceFiles: z.array(file).max(10).default([]),
  mysql: z.object({
    contractFingerprint: fingerprint,
    initializationSql: z.array(z.string().min(1).max(256 * 1024)).max(16).default([]),
    starterExplain: z.string().min(1).max(32 * 1024).optional(),
    referenceSql: z.array(z.string().min(1).max(32 * 1024)).max(8).default([]),
  }).strict().optional(),
  verification: z.object({
    commandKeys: z.array(z.string().min(1).max(80)).min(1).max(4),
    successSignals: z.array(z.string().min(1).max(300)).max(12).default([]),
  }).strict(),
  resources: z.array(resource).max(64).default([]),
}).strict().superRefine((value, context) => {
  if (value.runtimeKind === 'mysql_lab' && !value.mysql) context.addIssue({ code: z.ZodIssueCode.custom, path: ['mysql'], message: 'MySQL manifest 必须包含初始化资产' })
  if (value.runtimeKind === 'docker_workspace' && value.starterFiles.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['starterFiles'], message: 'Workspace manifest 必须包含 starter 文件' })
  if (value.runtimeKind === 'docker_workspace' && value.referenceFiles.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['referenceFiles'], message: 'Workspace manifest 必须包含私有参考修复' })
  if (value.runtimeKind === 'docker_workspace' && value.verification.successSignals.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['verification', 'successSignals'], message: 'Workspace manifest 必须声明成功信号' })
})

export type EnvironmentBuildManifest = z.infer<typeof environmentBuildManifestSchema>

/**
 * Server-produced, case-specific MySQL facts supplied only to the internal
 * Builder.  The Builder can use this to produce an immutable image, but it
 * cannot alter the server's source of truth for the case materialization.
 */
export interface OpenHandsMySqlBuildContract {
  learningCaseId: string
  database: string
  materializationFingerprint: string
  schemaSql: string
  seed: { rowCount: number; distribution: 'uniform' | 'skewed' }
  faultSql: string
  starterExplain: string
  referenceSql: string
}

export const environmentBuildAdapterEventSchema = z.object({
  id: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  phase: z.enum([...environmentBuildPhases, ...environmentBuildTerminalPhases]).optional(),
  type: z.enum(['phase', 'tool', 'docker', 'diagnostic', 'status']),
  summary: z.string().min(1).max(1_200),
  command: z.string().max(600).nullable().optional(),
  diagnostic: z.object({ code: z.string().max(120), message: z.string().max(1_200) }).strict().nullable().optional(),
  resource: z.object({ kind: z.string().max(40), id: z.string().max(256), action: z.string().max(40) }).strict().nullable().optional(),
  createdAt: z.string().datetime(),
}).strict()

export type EnvironmentBuildAdapterEvent = z.infer<typeof environmentBuildAdapterEventSchema>

export const environmentBuildTaskStatusSchema = z.object({
  taskId: z.string().min(1).max(128),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  manifest: environmentBuildManifestSchema.nullable().optional(),
  failure: z.object({ code: z.string().max(120), message: z.string().max(1_200), category: z.enum(environmentBuildFailureCategories).optional() }).strict().nullable().optional(),
  updatedAt: z.string().datetime(),
}).strict()

export type EnvironmentBuildTaskStatus = z.infer<typeof environmentBuildTaskStatusSchema>

export interface OpenHandsBuildTaskInput {
  buildId: string
  attemptId: string
  protocolVersion: number
  runtimeKind: RuntimeKind
  card: Record<string, unknown>
  learnerProfile: Array<Record<string, unknown>>
  environment: { capabilityKey: string; environmentKey: string; environmentVersion: string; displayName: string; agentSummary: string }
  successCriteria: { commandKeys: string[]; successSignals: string[] }
  mysqlContract?: OpenHandsMySqlBuildContract | null
  repairDiagnostic?: SafeBuildDiagnostic | null
  limits: { maxRepairRounds: number; timeoutMs: number; maxLogBytes: number }
}

export interface OpenHandsMySqlRuntimeInput {
  buildId: string
  attemptId: string
  learningCaseId: string
  database: string
  mysqlContractFingerprint: string
  runtimeImageDigest: string
  runtimeImageRef: string
  leaseMs: number
}

export interface OpenHandsMySqlRuntime {
  runtimeId: string
  leaseExpiresAt: string
}

export interface OpenHandsMySqlExecution {
  status: 'succeeded' | 'failed' | 'timed_out'
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface OpenHandsBuildAdapter {
  createTask(input: OpenHandsBuildTaskInput): Promise<{ taskId: string }>
  events(taskId: string, afterSequence: number): Promise<{ events: EnvironmentBuildAdapterEvent[]; nextSequence: number }>
  status(taskId: string): Promise<EnvironmentBuildTaskStatus>
  cancel(taskId: string): Promise<void>
  cleanup(input: { buildId: string; attemptId?: string | null; retainRuntimeArtifact?: boolean }): Promise<void>
  startMySqlRuntime(input: OpenHandsMySqlRuntimeInput): Promise<OpenHandsMySqlRuntime>
  resetMySqlRuntime(runtimeId: string): Promise<void>
  createMySqlSession(runtimeId: string, name: string): Promise<{ sessionId: string }>
  executeMySql(runtimeId: string, sessionId: string, statement: string): Promise<OpenHandsMySqlExecution>
  closeMySqlSession(runtimeId: string, sessionId: string): Promise<void>
  endMySqlRuntime(runtimeId: string): Promise<void>
}

export class OpenHandsBuildAdapterError extends Error {
  constructor(public readonly code: string, message: string, public readonly category: EnvironmentBuildFailureCategory = 'platform_fault') {
    super(message)
    this.name = 'OpenHandsBuildAdapterError'
  }
}

const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|password|token)\s*[=:]\s*|authorization\s*[=:]\s*(?:bearer\s+)?)(?:[^\s,;]{4,})/gi
const urlCredentialPattern = /([a-z]+:\/\/)[^\s/@:]+(?::[^\s/@]+)?@/gi

export function safeBuildText(value: unknown, max = 1_200): string {
  const source = String(value ?? '').replace(secretPattern, '[redacted]').replace(urlCredentialPattern, '$1[redacted]@').replace(/\u0000/g, '')
  return source.length > max ? `${source.slice(0, max)}\n…[truncated]` : source
}

export interface SafeBuildDiagnostic {
  code: string
  message: string
  phase: EnvironmentBuildPhase
  repairRound: number
}

export function safeBuildDiagnostic(input: { code: string; message: unknown; phase: EnvironmentBuildPhase; repairRound: number }): SafeBuildDiagnostic {
  return { code: safeBuildText(input.code, 120), message: safeBuildText(input.message), phase: input.phase, repairRound: input.repairRound }
}

export function manifestFingerprint(manifest: EnvironmentBuildManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}
