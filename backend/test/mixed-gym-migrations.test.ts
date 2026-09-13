import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'

describe('mixed Gym migration compatibility', () => {
  it('upgrades a migration-055 database without losing existing profile evidence', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-migration-'))
    const databasePath = path.join(directory, 'product.db')
    const migrationDirectory = path.resolve(process.cwd(), 'migrations/product')
    const database = new Database(databasePath)
    try {
      database.pragma('foreign_keys = ON')
      database.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
      const files = readdirSync(migrationDirectory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
      for (const file of files) {
        if (file.startsWith('056_')) break
        database.transaction(() => {
          database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'))
          database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(file, new Date().toISOString())
        })()
      }
      const timestamp = new Date().toISOString()
      database.prepare('INSERT INTO learners(id,created_at,updated_at) VALUES(?,?,?)').run('legacy-learner', timestamp, timestamp)
      database.prepare("INSERT INTO learner_profile_snapshots(id,learner_id,version,status,input_fingerprint,summary_json,created_at) VALUES(?, ?, 1, 'current', ?, '{}', ?)").run('legacy-snapshot', 'legacy-learner', 'fingerprint', timestamp)
      database.prepare("INSERT INTO learner_profile_evidence(id,snapshot_id,topic_key,source_type,source_id,excerpt,created_at) VALUES(?,?,?,?,?,?,?)").run('legacy-evidence', 'legacy-snapshot', 'mysql', 'lab', 'run-1', '已有实践证据', timestamp)
    } finally {
      database.close()
    }

    try {
      applyProductMigrations(databasePath)
      const upgraded = new Database(databasePath, { readonly: true })
      try {
        expect(upgraded.prepare('SELECT excerpt FROM learner_profile_evidence WHERE id=?').get('legacy-evidence')).toEqual({ excerpt: '已有实践证据' })
        expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('learner_sessions','practice_cards','gym_sessions') ORDER BY name").all()).toHaveLength(3)
        const evidenceTable = upgraded.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='learner_profile_evidence'").get() as { sql: string }
        expect(evidenceTable.sql).toContain("'gym_knowledge'")
      } finally { upgraded.close() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
