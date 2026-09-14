import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'

describe('Zhihu canonical identity migration 060', () => {
  it('preserves historical learner data while deterministically retiring duplicate provider identities', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-identity-060-'))
    const databasePath = path.join(directory, 'product.db')
    const migrationDirectory = path.resolve(process.cwd(), 'migrations/product')
    const database = new Database(databasePath)
    try {
      database.pragma('foreign_keys = ON')
      database.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
      const files = readdirSync(migrationDirectory).filter((file) => /^\d+_.+\.sql$/.test(file) && file < '060_zhihu_canonical_identity.sql').sort()
      for (const file of files) {
        const apply = database.transaction(() => {
          database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'))
          database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
        })
        if (file.startsWith('059_')) {
          database.pragma('foreign_keys = OFF')
          try { apply() } finally { database.pragma('foreign_keys = ON') }
        } else apply()
      }

      const now = '2026-09-14T00:00:00.000Z'
      database.prepare('INSERT INTO learners(id, created_at, updated_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)').run('learner-first', now, now, 'learner-second', now, now, 'learner-legacy', now, now, 'learner-real-oauth-prefix', now, now)
      const insertConnection = database.prepare(`
        INSERT INTO provider_connections(id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag, scopes_json, status, created_at, updated_at)
        VALUES (?, ?, 'zhihu', ?, 'ciphertext', 'iv', 'tag', '[]', 'active', ?, ?)
      `)
      insertConnection.run('connection-first', 'learner-first', 'same-account', '2026-01-01T00:00:00.000Z', now)
      insertConnection.run('connection-second', 'learner-second', 'same-account', '2026-02-01T00:00:00.000Z', now)
      insertConnection.run('connection-legacy-token-hash', 'learner-legacy', `oauth-${'a'.repeat(24)}`, '2026-03-01T00:00:00.000Z', now)
      insertConnection.run('connection-real-oauth-prefix', 'learner-real-oauth-prefix', 'oauth-real-user', '2026-04-01T00:00:00.000Z', now)
      database.prepare(`
        INSERT INTO external_source_collections(id, learner_id, connection_id, provider, external_id, kind, title, metadata_json, created_at, updated_at)
        VALUES ('collection-second', 'learner-second', 'connection-second', 'zhihu', 'favorites', 'favorites', '保留的历史收藏', '{}', ?, ?)
      `).run(now, now)
    } finally {
      database.close()
    }

    try {
      applyProductMigrations(databasePath)
      const upgraded = new Database(databasePath)
      try {
        upgraded.pragma('foreign_keys = ON')
        expect(upgraded.prepare('SELECT provider_user_id providerUserId, status, profile_json profileJson FROM provider_connections WHERE id=?').get('connection-first')).toEqual({ providerUserId: 'same-account', status: 'active', profileJson: '{}' })
        expect(upgraded.prepare('SELECT provider_user_id providerUserId, status FROM provider_connections WHERE id=?').get('connection-second')).toEqual({ providerUserId: null, status: 'reauthorization_required' })
        expect(upgraded.prepare('SELECT provider_user_id providerUserId, status FROM provider_connections WHERE id=?').get('connection-legacy-token-hash')).toEqual({ providerUserId: null, status: 'reauthorization_required' })
        expect(upgraded.prepare('SELECT provider_user_id providerUserId, status FROM provider_connections WHERE id=?').get('connection-real-oauth-prefix')).toEqual({ providerUserId: 'oauth-real-user', status: 'active' })
        expect(upgraded.prepare('SELECT learner_id learnerId, connection_id connectionId, title FROM external_source_collections WHERE id=?').get('collection-second')).toEqual({ learnerId: 'learner-second', connectionId: 'connection-second', title: '保留的历史收藏' })
        expect(() => upgraded.prepare(`
          INSERT INTO provider_connections(id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag, scopes_json, status, created_at, updated_at)
          VALUES ('connection-third', 'learner-second', 'zhihu', 'same-account', 'ciphertext', 'iv', 'tag', '[]', 'active', ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString())).toThrow()
        expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
