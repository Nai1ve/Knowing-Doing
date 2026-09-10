import { z } from 'zod'
import type { CaseRequest, CaseSpec, ExerciseSpecV2, ReferenceSolution, ReferenceSolutionV2 } from './product-types.js'
import { getEnvironmentTemplate } from './environment-registry.js'
import { getEnvironmentInterpreter } from './environment-interpreters.js'

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

const exerciseAssetSchema = z.object({
  kind: z.enum(['file', 'fixture', 'dataset_seed', 'schema', 'fault_seed']),
  key: z.string().trim().min(1).max(120),
  content: z.string().max(262144),
  path: z.string().trim().min(1).max(180).optional(),
})

export const exerciseSpecV2Schema = z.object({
  specVersion: z.literal(2), capabilityKey: z.string().trim().min(1).max(160), title: z.string().trim().min(1).max(240),
  scenario: z.string().trim().min(1).max(12000), learningGoal: z.string().trim().min(1).max(4000), difficulty: z.enum(['introductory', 'applied', 'advanced']),
  environment: z.object({ key: z.string().trim().min(1).max(120), version: z.string().trim().min(1).max(40), services: z.array(z.string().trim().min(1).max(80)).max(8) }),
  starterAssets: z.array(exerciseAssetSchema).min(1).max(16),
  tasks: z.array(z.object({ key: z.string().trim().min(1).max(80), instruction: z.string().trim().min(1).max(4000), recommendedCommandKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(8), expectedObservation: z.string().trim().min(1).max(2000) })).min(1).max(12),
  verification: z.object({ commandKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(8), successSignals: z.array(z.string().trim().min(1).max(240)).min(1).max(12) }),
  tutorContext: z.object({ concepts: z.array(z.string().trim().min(1).max(240)).max(20), likelyMisconceptions: z.array(z.string().trim().min(1).max(400)).max(20), evidenceToNotice: z.array(z.string().trim().min(1).max(400)).max(20) }),
})

const referenceSolutionV2Schema = z.object({ assets: z.array(exerciseAssetSchema).min(1).max(16), verificationCommandKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(8) })

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
  getEnvironmentInterpreter(key, version).validateCaseSpec(spec)
  return spec
}

function resolveCommand(environmentKey: string, version: string, command: string): string {
  return getEnvironmentInterpreter(environmentKey, version).resolveCommand(command)
}

export function parseExerciseSpecV2(value: unknown): ExerciseSpecV2 {
  const parsed = exerciseSpecV2Schema.parse(value) as ExerciseSpecV2
  getEnvironmentInterpreter(parsed.environment.key, parsed.environment.version).validateExerciseSpec(parsed)
  return parsed
}

export function parseExerciseGenerationOutput(value: unknown): { spec: ExerciseSpecV2; referenceSolution: ReferenceSolutionV2 } {
  const parsed = z.object({ exerciseSpec: exerciseSpecV2Schema, referenceSolution: referenceSolutionV2Schema }).parse(value)
  const spec = parseExerciseSpecV2(parsed.exerciseSpec)
  const referenceSolution = parsed.referenceSolution as ReferenceSolutionV2
  getEnvironmentInterpreter(spec.environment.key, spec.environment.version).validateReferenceSolution(referenceSolution)
  return { spec, referenceSolution }
}

export function parseCaseGenerationOutput(value: unknown): { spec: CaseSpec; referenceSolution: ReferenceSolution | null } {
  const parsed = caseGenerationOutputSchema.parse(value)
  if ('exerciseSpec' in parsed) {
    const spec = parseCaseSpec(parsed.exerciseSpec)
    const version = spec.environment.version ?? '1'
    const files = parsed.referenceSolution.files.map((file) => ({ path: file.path, content: file.content }))
    const verificationCommands = parsed.referenceSolution.verificationCommandKeys.map((command) => resolveCommand(spec.environment.key ?? spec.environment.templateKey, version, command))
    getEnvironmentInterpreter(spec.environment.key ?? spec.environment.templateKey, version).validateReferenceSolution({ assets: files.map((file) => ({ kind: 'file', key: file.path, path: file.path, content: file.content })), verificationCommandKeys: parsed.referenceSolution.verificationCommandKeys })
    return { spec, referenceSolution: { files, verificationCommands } }
  }
  return { spec: parseCaseSpec(parsed), referenceSolution: null }
}

export function validateCaseSpecBoundaries(spec: CaseSpec): void {
  getEnvironmentInterpreter(spec.environment.key ?? spec.environment.templateKey, spec.environment.version ?? '1').validateCaseSpec(spec)
}

export function isAllowedPythonCommand(command: string): boolean {
  return getEnvironmentInterpreter('python-pytest-v1', '1').canExecute(command)
}
