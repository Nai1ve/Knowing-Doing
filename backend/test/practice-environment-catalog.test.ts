import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PracticeEnvironmentCatalog } from '../src/practice-environment-catalog.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

describe('PracticeEnvironmentCatalog', () => {
  it('only gives agents enabled rows backed by a matching platform runtime', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-environment-catalog-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    try {
      const catalog = new PracticeEnvironmentCatalog(repository.db)
      expect(catalog.get('mysql.slow-query-index')).toMatchObject({ capabilityKey: 'mysql.slow-query', runtimeKind: 'mysql_lab', learningMode: 'lab' })
      expect(catalog.get('go.testing')).toBeNull()

      repository.db.prepare("UPDATE practice_environment_capabilities SET environment_key = 'untrusted-template' WHERE planning_key = 'python.testing'").run()
      expect(catalog.get('python.testing')).toBeNull()
      expect(catalog.agentContext().map((item) => item.planningKey)).toContain('python.collections.list')
    } finally { repository.close() }
  })
})
