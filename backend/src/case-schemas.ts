import { z } from 'zod'
import type { CaseRequest, CaseSpec } from './product-types.js'

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
  environment: z.object({ templateKey: z.literal('python-pytest-v1'), services: z.array(z.string().trim().min(1).max(80)).max(8) }),
  starterFiles: z.array(z.object({ path: z.string().trim().min(1).max(180), content: z.string().max(262144) })).min(1).max(10),
  tasks: z.array(z.object({ key: z.string().trim().min(1).max(80), instruction: z.string().trim().min(1).max(4000), recommendedCommands: z.array(z.string().trim().min(1).max(240)).min(1).max(8), expectedObservation: z.string().trim().min(1).max(2000) })).min(1).max(12),
  verification: z.object({ commands: z.array(z.string().trim().min(1).max(240)).min(1).max(8), successSignals: z.array(z.string().trim().min(1).max(240)).min(1).max(12) }),
  tutorContext: z.object({ concepts: z.array(z.string().trim().min(1).max(240)).max(20), likelyMisconceptions: z.array(z.string().trim().min(1).max(400)).max(20), evidenceToNotice: z.array(z.string().trim().min(1).max(400)).max(20) }),
})

export function parseCaseRequest(value: unknown): CaseRequest {
  return caseRequestSchema.parse(value) as CaseRequest
}

export function parseCaseSpec(value: unknown): CaseSpec {
  const spec = caseSpecSchema.parse(value) as CaseSpec
  validateCaseSpecBoundaries(spec)
  return spec
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
