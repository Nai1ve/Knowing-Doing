import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'

describe('planning_sessions migration 059', () => {
  it('upgrades a fully migrated v058 database with foreign keys enabled and preserves child rows', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-planning-059-'))
    const databasePath = path.join(directory, 'product.db')
    const migrationDirectory = path.resolve(process.cwd(), 'migrations/product')
    const database = new Database(databasePath)
    try {
      database.pragma('foreign_keys = ON')
      database.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
      const files = readdirSync(migrationDirectory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
      for (const file of files) {
        if (file.startsWith('059_')) break
        database.transaction(() => {
          database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'))
          database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
        })()
      }

      const now = new Date().toISOString()
      database.prepare('INSERT INTO learners(id, created_at, updated_at) VALUES (?, ?, ?)').run('migration-learner', now, now)
      database.prepare("INSERT INTO planning_sessions(id, learner_id, template_key, goal, status, current_step, answers_json, revision, client_request_id, created_at, updated_at, mode, agent_status, stage, baseline_turn_count, requirements_turn_count) VALUES (?, ?, 'agent', '验证迁移', 'draft', 0, '{}', 1, 'migration-request', ?, ?, 'agent', 'idle', 'baseline', 3, 2)").run('migration-session', 'migration-learner', now, now)
      database.prepare("INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, client_request_id, created_at) VALUES (?, ?, 1, 'user', '我有真实项目经验', '{}', 'message-request', ?)").run('migration-message', 'migration-session', now)
      database.prepare("INSERT INTO planning_assessments(id, session_id, learner_id, version, status, direction, model, dimensions_json, client_request_id, created_at, updated_at) VALUES (?, ?, ?, 1, 'answering', '验证迁移', 'fixture', '[]', 'assessment-request', ?, ?)").run('migration-assessment', 'migration-session', 'migration-learner', now, now)
      database.prepare("INSERT INTO planning_assessment_questions(id, assessment_id, position, dimension_key, question_type, difficulty, prompt, options_json, rubric_json, reference_answer_json, created_at) VALUES (?, ?, 1, 'fundamentals', 'short_text', 'foundation', '解释一个概念及其边界', '[]', '{\"criteria\":[\"清晰\"]}', '{}', ?)").run('migration-question', 'migration-assessment', now)
      database.prepare("INSERT INTO planning_requirement_briefs(id, session_id, learner_id, version, status, content_json, created_at, updated_at) VALUES (?, ?, ?, 1, 'draft', '{\"goal\":\"验证迁移\"}', ?, ?)").run('migration-brief', 'migration-session', 'migration-learner', now, now)
      database.prepare("UPDATE planning_sessions SET active_assessment_id = ?, active_requirement_brief_id = ? WHERE id = ?").run('migration-assessment', 'migration-brief', 'migration-session')
    } finally {
      database.close()
    }

    try {
      applyProductMigrations(databasePath)
      const upgraded = new Database(databasePath)
      try {
        upgraded.pragma('foreign_keys = ON')
        expect(upgraded.prepare('SELECT baseline_turn_count, requirements_turn_count FROM planning_sessions WHERE id = ?').get('migration-session')).toEqual({ baseline_turn_count: 3, requirements_turn_count: 2 })
        expect(upgraded.prepare('SELECT content FROM planning_messages WHERE id = ?').get('migration-message')).toEqual({ content: '我有真实项目经验' })
        expect(upgraded.prepare('SELECT prompt FROM planning_assessment_questions WHERE id = ?').get('migration-question')).toEqual({ prompt: '解释一个概念及其边界' })
        expect(upgraded.prepare('SELECT id FROM planning_requirement_briefs WHERE id = ?').get('migration-brief')).toEqual({ id: 'migration-brief' })
        upgraded.prepare('UPDATE planning_sessions SET baseline_turn_count = 6 WHERE id = ?').run('migration-session')
        expect(() => upgraded.prepare('UPDATE planning_sessions SET baseline_turn_count = 7 WHERE id = ?').run('migration-session')).toThrow()
        expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1)
        expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
