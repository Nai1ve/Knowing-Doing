import { describe, expect, it } from 'vitest'
import { materializeMySqlExercise, mysqlMaterializationFingerprint, mysqlRequestForProfile, parseMySqlExerciseRequest } from '../src/mysql-case-interpreter.js'

const request = { capabilityKey: 'mysql.slow-query', environmentKey: 'mysql-performance-v1', environmentVersion: '1', schemaTemplateKey: 'orders-v1', seedProfileKey: 'orders-100k-v1', faultKey: 'wrong_index', queryTemplateKey: 'orders-by-user-created-v1', parameters: { rowCount: 100_000, distribution: 'skewed' } }

describe('MySQL exercise interpreter', () => {
  it('materializes only registered templates and emits a private repair plan', () => {
    const plan = materializeMySqlExercise(request)
    expect(plan.request.queryTemplateKey).toBe('orders-by-user-created-v1')
    expect(plan.faultSeed.sql).toContain('idx_orders_user_id_created')
    expect(plan.referenceSolution.sql).toContain('created_at')
    expect(plan.schemaSql).not.toContain('DROP DATABASE')
  })

  it('rejects model-owned environment and seed expansion', () => {
    expect(() => parseMySqlExerciseRequest({ ...request, environmentKey: 'mysql-8-custom' })).toThrow()
    expect(() => materializeMySqlExercise({ ...request, parameters: { rowCount: 1_000_000, distribution: 'uniform' } })).toThrow('mysql_seed_row_count_exceeds_profile')
  })

  it('fingerprints the frozen request deterministically', () => {
    expect(mysqlMaterializationFingerprint(request)).toBe(mysqlMaterializationFingerprint({ ...request, parameters: { distribution: 'skewed', rowCount: 100_000 } }))
  })

  it('keeps the EXPLAIN card on its own registered profile', () => {
    const plan = materializeMySqlExercise(mysqlRequestForProfile('mysql.explain-plan-v1'))
    expect(plan.request.capabilityKey).toBe('mysql.explain-plan')
    expect(plan.query.key).toBe('orders-explain-filter-sort-v1')
    expect(plan.referenceSolution.sql).toContain('user_id, status, created_at')
    expect(plan.referenceSolution.sql).not.toContain('idx_orders_user_id_created_at')
  })
})
