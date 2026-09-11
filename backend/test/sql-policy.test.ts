import { describe, expect, it } from 'vitest'
import type { CaseManifest } from '../src/domain.js'
import { validateStatement } from '../src/sql-policy.js'

const manifest: CaseManifest = {
  id: 'dynamic-case-1', title: '动态案例', schema: 'zhixing_dynamic_123456789abc', allowedSessions: ['default'], fixtureVersion: 'dynamic-v1', tables: ['orders'], baselineIndexes: { orders: { PRIMARY: '' } },
}

describe('SQL policy', () => {
  it('allows SQL scoped to the registered dynamic manifest', () => {
    expect(validateStatement('EXPLAIN SELECT id FROM orders WHERE user_id = 1', manifest)).toMatchObject({ kind: 'query' })
  })

  it('rejects foreign schemas and table definitions', () => {
    expect(() => validateStatement('SELECT * FROM mysql.user', manifest)).toThrow('SQL 只能访问当前案例 schema')
    expect(() => validateStatement('CREATE TABLE orders2 (id INT)', manifest)).toThrow('SQL 只能访问当前案例的受控表')
  })
})
