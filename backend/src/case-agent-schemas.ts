import { z } from 'zod'
import type { CaseBlueprint, CaseIntent } from './product-types.js'

const boundedString = (max: number) => z.string().trim().min(1).max(max)

export const caseIntentSchema = z.object({
  targetCapability: boundedString(160),
  learnerRole: boundedString(240),
  scenario: boundedString(4000),
  desiredObservation: boundedString(2000),
  difficulty: z.enum(['introductory', 'applied', 'advanced']),
  scope: z.array(boundedString(400)).min(1).max(8),
  constraints: z.array(boundedString(400)).max(8),
})

export const caseBlueprintSchema = z.object({
  title: boundedString(240),
  learningGoal: boundedString(4000),
  taskSequence: z.array(z.object({
    key: boundedString(80),
    instruction: boundedString(2000),
    expectedObservation: boundedString(1200),
  })).min(1).max(8),
  assetPlan: z.array(z.object({
    kind: z.enum(['file', 'fixture', 'dataset_seed', 'schema', 'fault_seed']),
    key: boundedString(120),
    purpose: boundedString(800),
  })).min(1).max(16),
  verificationPlan: z.object({
    commandKeys: z.array(boundedString(80)).min(1).max(8),
    successSignals: z.array(boundedString(240)).min(1).max(12),
  }),
  tutorFocus: z.object({
    concepts: z.array(boundedString(240)).max(20),
    likelyMisconceptions: z.array(boundedString(400)).max(20),
    evidenceToNotice: z.array(boundedString(400)).max(20),
  }),
})

export function parseCaseIntent(value: unknown): CaseIntent { return caseIntentSchema.parse(value) as CaseIntent }
export function parseCaseBlueprint(value: unknown): CaseBlueprint { return caseBlueprintSchema.parse(value) as CaseBlueprint }
