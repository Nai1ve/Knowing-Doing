import { z } from 'zod'
import type { CaseRequest, CaseSpec, ReferenceSolution } from './product-types.js'
import { getEnvironmentTemplate, resolveEnvironmentCommand } from './environment-registry.js'

export const MAX_WORKSPACE_FILE_BYTES = 262144
export const MAX_WORKSPACE_TOTAL_BYTES = 2 * 1024 * 1024

export const caseRequestSchema = z.object({
  roadmapNodeId: z.string().trim().min(1).max(120),
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('brief'), brief: z.string().trim().min(1).max(4000), sourceItemId: z.undefined().optional() }),
    z.object({ kind: z.literal('zhihu_article'), sourceItemId: z.string().trim().min(1).max(120), brief: z.undefined().optional() }),
  ]),
  desiredOutcome: z.string().trim().max(4000).optional(),
  difficulty: z.enum(['introductory', 'applied', 'advanced']).optional(),
  clientRequestId: z.string().trim().min(1).max(160),
})

export const caseSpecSchema = z.object({
  title: z.string().trim().min(1).max(240),
  scenario: z.string().trim().min(1).max(12000),
  learningGoal: z.string().trim().min(1).max(4000),
  difficulty: z.enum(['introductory', 'applied', 'advanced']),
  environment: z.object({ key: z.string().trim().min(1).max(120).optional(), version: z.string().trim().min(1).max(40).optional(), templateKey: z.string().trim().min(1).max(120).optional(), services: z.array(z.string().trim().min(1).max(80)).max(8) }),
  starterFiles: z.array(z.object({ path: z.string().trim().min(1).max(180), content: z.string().max(262144) })).min(1).max(10),
  tasks: z.array(z.object({ key: z.string().trim().min(1).max(80), instruction: z.string().trim().min(1).max(4000), recommendedCommands: z.array(z.string().trim().min(1).max(240)).min(1).max(8), expectedObservation: z.string().trim().min(1).max(2000) })).min(1).max(12),
  verification: z.object({ commands: z.array(z.string().trim().min(1).max(240)).min(1).max(8), successSignals: z.array(z.string().trim().min(1).max(240)).min(1).max(12) }),
  tutorContext: z.object({ concepts: z.array(z.string().trim().min(1).max(240)).max(20), likelyMisconceptions: z.array(z.string().trim().min(1).max(400)).max(20), evidenceToNotice: z.array(z.string().trim().min(1).max(400)).max(20) }),
})

const referenceSolutionSchema = z.object({
  files: z.array(z.object({ path: z.string().trim().min(1).max(180), content: z.string().max(262144) })).min(1).max(10),
  verificationCommandKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
})

export const caseGenerationOutputSchema = z.union([
  caseSpecSchema,
  z.object({ exerciseSpec: caseSpecSchema, referenceSolution: referenceSolutionSchema }),
])

export function parseCaseRequest(value: unknown): CaseRequest {
  return caseRequestSchema.parse(value) as CaseRequest
}

export function parseCaseSpec(value: unknown): CaseSpec {
  const parsed = caseSpecSchema.parse(value)
  const key = parsed.environment.key ?? parsed.environment.templateKey
  if (!key) throw new Error('environment_key_required')
  if (parsed.environment.templateKey && parsed.environment.templateKey !== key) throw new Error('environment_template_mismatch')
  const template = getEnvironmentTemplate(key, parsed.environment.version ?? '1')
  if (!template || template.status !== 'available') throw new Error(`unsupported_environment:${key}`)
  const version = parsed.environment.version ?? template.version
  const spec = {
    ...parsed,
    environment: { ...parsed.environment, key, version, templateKey: parsed.environment.templateKey ?? key },
    tasks: parsed.tasks.map((task) => ({ ...task, recommendedCommands: task.recommendedCommands.map((command) => resolveCommand(key, version, command)) })),
    verification: { ...parsed.verification, commands: parsed.verification.commands.map((command) => resolveCommand(key, version, command)) },
  } as CaseSpec
  validateCaseSpecBoundaries(spec)
  return spec
}

function resolveCommand(environmentKey: string, version: string, command: string): string {
  const resolved = resolveEnvironmentCommand(environmentKey, version, command)
  if (!resolved) throw new Error(`unsupported_command_key:${command}`)
  return resolved
}

export function parseCaseGenerationOutput(value: unknown): { spec: CaseSpec; referenceSolution: ReferenceSolution | null } {
  const parsed = caseGenerationOutputSchema.parse(value)
  if ('exerciseSpec' in parsed) {
    const spec = parseCaseSpec(parsed.exerciseSpec)
    const version = spec.environment.version ?? '1'
    const files = parsed.referenceSolution.files.map((file) => ({ path: file.path, content: file.content }))
    const verificationCommands = parsed.referenceSolution.verificationCommandKeys.map((command) => resolveCommand(spec.environment.key ?? spec.environment.templateKey, version, command))
    validateReferenceSolution(files, verificationCommands)
    return { spec, referenceSolution: { files, verificationCommands } }
  }
  return { spec: parseCaseSpec(parsed), referenceSolution: null }
}

function validateReferenceSolution(files: Array<{ path: string; content: string }>, commands: string[]): void {
  const paths = new Set<string>()
  let totalBytes = 0
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`duplicate_reference_path:${file.path}`)
    if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) throw new Error(`invalid_reference_path:${file.path}`)
    if (!/\.(py|json|md|txt)$/.test(file.path)) throw new Error(`unsupported_reference_extension:${file.path}`)
    paths.add(file.path)
    totalBytes += Buffer.byteLength(file.content, 'utf8')
  }
  if (totalBytes > MAX_WORKSPACE_TOTAL_BYTES) throw new Error('reference_files_too_large')
  if (commands.length === 0) throw new Error('reference_verification_required')
}

export function validateCaseSpecBoundaries(spec: CaseSpec): void {
  const paths = new Set<string>()
  const commands = new Set([...spec.verification.commands, ...spec.tasks.flatMap((task) => task.recommendedCommands)])
  let totalBytes = 0
  for (const file of spec.starterFiles) {
    if (paths.has(file.path)) throw new Error(`duplicate_starter_path:${file.path}`)
    paths.add(file.path)
    if (file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) throw new Error(`invalid_starter_path:${file.path}`)
    if (!/\.(py|json|md|txt)$/.test(file.path)) throw new Error(`unsupported_starter_extension:${file.path}`)
    totalBytes += Buffer.byteLength(file.content, 'utf8')
  }
  if (totalBytes > MAX_WORKSPACE_TOTAL_BYTES) throw new Error('starter_files_too_large')
  for (const command of commands) {
    if (!isAllowedPythonCommand(command)) throw new Error(`unsupported_command:${command}`)
  }
}

export function isAllowedPythonCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')
  return normalized === 'pytest -q' || normalized === 'python -m pytest -q' || /^python -m pytest [\w./-]+(?: [\w./-]+)*$/.test(normalized)
}
