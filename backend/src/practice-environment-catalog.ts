import type Database from 'better-sqlite3'
import { resolveCapability } from './environment-registry.js'
import type { ExerciseKind, LearningMode, RuntimeKind } from './product-types.js'

type Row = Record<string, unknown>

export interface AgentPracticeEnvironment {
  planningKey: string
  capabilityKey: string
  environmentKey: string
  environmentVersion: string
  runtimeKind: RuntimeKind
  learningMode: Extract<LearningMode, 'lab' | 'workspace'>
  caseIntent: string
  displayName: string
  agentSummary: string
  exerciseKinds: ExerciseKind[]
  aliases: string[]
}

function text(row: Row, key: string): string { return String(row[key]) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }

/**
 * Database-owned product capability catalogue. It is deliberately intersected
 * with the code-owned runtime registry before it reaches an Agent or a caller.
 */
export class PracticeEnvironmentCatalog {
  constructor(private readonly db: Database.Database) {}

  available(): AgentPracticeEnvironment[] {
    const rows = this.db.prepare(`SELECT planning_key, capability_key, environment_key, environment_version, runtime_kind, learning_mode, case_intent, display_name, agent_summary, exercise_kinds_json, aliases_json
      FROM practice_environment_capabilities WHERE status = 'available' ORDER BY position ASC, planning_key ASC`).all() as Row[]
    return rows.flatMap((row) => {
      const resolved = resolveCapability(text(row, 'capability_key'))
      if (!resolved || resolved.template.key !== text(row, 'environment_key') || resolved.template.version !== text(row, 'environment_version') || resolved.template.runtimeKind !== text(row, 'runtime_kind')) return []
      return [{
        planningKey: text(row, 'planning_key'), capabilityKey: text(row, 'capability_key'), environmentKey: text(row, 'environment_key'), environmentVersion: text(row, 'environment_version'), runtimeKind: text(row, 'runtime_kind') as RuntimeKind,
        learningMode: text(row, 'learning_mode') as Extract<LearningMode, 'lab' | 'workspace'>, caseIntent: text(row, 'case_intent'), displayName: text(row, 'display_name'), agentSummary: text(row, 'agent_summary'),
        exerciseKinds: json<ExerciseKind[]>(row.exercise_kinds_json, []), aliases: json<string[]>(row.aliases_json, []),
      }]
    })
  }

  get(planningKey: string): AgentPracticeEnvironment | null { return this.available().find((item) => item.planningKey === planningKey) ?? null }

  byCapability(capabilityKey: string): AgentPracticeEnvironment | null { return this.available().find((item) => item.capabilityKey === capabilityKey) ?? null }

  recommend(textToMatch: string): AgentPracticeEnvironment | null {
    const value = textToMatch.toLowerCase()
    return this.available().find((item) => item.aliases.some((alias) => value.includes(alias.toLowerCase()))) ?? null
  }

  agentContext(): AgentPracticeEnvironment[] { return this.available() }
}
