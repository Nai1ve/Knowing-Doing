import { describe, expect, it } from 'vitest'
import { getManifest } from '../src/fixtures.js'
import { validateStatement } from '../src/sql-policy.js'

const slow = getManifest('mysql-order-list-index-001')

describe('SQL policy', () => {
  it('allows a query against the current case table', () => {
    expect(validateStatement('EXPLAIN SELECT * FROM orders LIMIT 1', slow).kind).toBe('query')
  })

  it('allows index changes but rejects table changes', () => {
    expect(validateStatement('CREATE INDEX idx_demo ON orders (user_id)', slow).kind).toBe('ddl')
    expect(() => validateStatement('DROP TABLE orders', slow)).toThrowError('不允许执行 drop SQL')
  })

  it('rejects multi-statements and cross-case access', () => {
    expect(() => validateStatement('SELECT * FROM orders; SELECT 1', slow)).toThrowError('一次只能执行一条 SQL')
    expect(() => validateStatement('SELECT * FROM other_table', slow)).toThrowError('SQL 只能访问当前案例的受控表')
    expect(() => validateStatement('SELECT * FROM other_schema.orders', slow)).toThrowError('SQL 只能访问当前案例 schema')
  })

  it('allows index inspection and index DDL only', () => {
    expect(validateStatement('SHOW INDEX FROM orders', slow).kind).toBe('query')
    expect(validateStatement('DROP INDEX idx_orders_user_id ON orders', slow).kind).toBe('ddl')
    expect(() => validateStatement('ALTER TABLE orders MODIFY index VARCHAR(20)', slow)).toThrowError('只允许创建或调整当前案例的索引')
    expect(() => validateStatement('SHOW TABLES', slow)).toThrowError('只允许查看当前案例的索引')
  })

  it('allows explicit transaction commands for named sessions', () => {
    expect(validateStatement('START TRANSACTION', getManifest('mysql-deadlock-lock-order-001')).kind).toBe('transaction')
    expect(validateStatement('ROLLBACK', getManifest('mysql-deadlock-lock-order-001')).kind).toBe('transaction')
  })
})
