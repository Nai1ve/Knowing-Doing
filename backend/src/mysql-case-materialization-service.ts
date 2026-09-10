import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CaseMaterialization, MySqlMaterializationPlan } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import { materializeMySqlExercise, mysqlMaterializationFingerprint } from './mysql-case-interpreter.js'

type Row = Record<string, unknown>
const text = (row: Row, key: string) => String(row[key])
const nullable = (row: Row, key: string) => row[key] == null ? null : String(row[key])
const parse = <T>(value: unknown, fallback: T): T => typeof value === 'string' ? (() => { try { return JSON.parse(value) as T } catch { return fallback } })() : fallback

function from(row: Row): CaseMaterialization {
  return { id: text(row, 'id'), learnerId: text(row, 'learner_id'), learningCaseId: text(row, 'learning_case_id'), environmentKey: text(row, 'environment_key'), environmentVersion: text(row, 'environment_version'), materializationFingerprint: text(row, 'materialization_fingerprint'), registryVersion: text(row, 'registry_version'), status: text(row, 'status') as CaseMaterialization['status'], plan: row.materialization_json === '{}' ? null : parse<MySqlMaterializationPlan | null>(row.materialization_json, null), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

export class MySqlCaseMaterializationService {
  constructor(private readonly repository: ProductRepository) {}
  private get db(): Database.Database { return this.repository.db }

  materialize(learnerId: string, learningCaseId: string, input: unknown): CaseMaterialization {
    const caseRow = this.db.prepare('SELECT id, learner_id, capability_key, environment_key, environment_version, runtime_kind FROM learning_cases WHERE id = ? AND learner_id = ?').get(learningCaseId, learnerId) as Row | undefined
    if (!caseRow) throw new Error('learning_case_not_found')
    if (text(caseRow, 'capability_key') !== 'mysql.slow-query' || text(caseRow, 'environment_key') !== 'mysql-performance-v1' || text(caseRow, 'runtime_kind') !== 'mysql_lab') throw new Error('mysql_case_capability_mismatch')
    const fingerprint = mysqlMaterializationFingerprint(input)
    const existing = this.db.prepare('SELECT * FROM case_materializations WHERE learning_case_id = ? AND materialization_fingerprint = ?').get(learningCaseId, fingerprint) as Row | undefined
    if (existing && text(existing, 'status') === 'materialized') return from(existing)
    const id = existing ? text(existing, 'id') : randomUUID()
    const now = new Date().toISOString()
    if (!existing) {
      this.db.prepare(`INSERT INTO case_materializations(id, learner_id, learning_case_id, environment_key, environment_version, materialization_fingerprint, registry_version, status, materialization_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '{}', ?, ?)`).run(id, learnerId, learningCaseId, text(caseRow, 'environment_key'), text(caseRow, 'environment_version'), fingerprint, 'pending', now, now)
    } else {
      this.db.prepare("UPDATE case_materializations SET status = 'pending', materialization_json = '{}', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, id, learnerId)
    }
    try {
      const plan = materializeMySqlExercise(input)
      this.db.transaction(() => {
        this.db.prepare("UPDATE case_materializations SET registry_version = ?, status = 'materialized', materialization_json = ?, failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'pending'").run(plan.registryVersion, JSON.stringify(plan), now, id, learnerId)
        this.db.prepare('UPDATE learning_cases SET materialization_id = ?, updated_at = ? WHERE id = ? AND learner_id = ?').run(id, now, learningCaseId, learnerId)
        this.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, learningCaseId, id, 'materialized', JSON.stringify({ fingerprint, registryVersion: plan.registryVersion }), now)
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'MySQL 案例物料化失败'
      this.db.transaction(() => {
        this.db.prepare("UPDATE case_materializations SET status = 'failed', materialization_json = '{}', failure_code = 'mysql_materialization_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, now, id, learnerId)
        this.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, learningCaseId, id, 'materialization_failed', JSON.stringify({ message }), now)
      })()
    }
    return from(this.db.prepare('SELECT * FROM case_materializations WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row)
  }

  get(learnerId: string, learningCaseId: string): CaseMaterialization | null {
    const row = this.db.prepare('SELECT * FROM case_materializations WHERE learner_id = ? AND learning_case_id = ? ORDER BY created_at DESC LIMIT 1').get(learnerId, learningCaseId) as Row | undefined
    return row ? from(row) : null
  }
}
