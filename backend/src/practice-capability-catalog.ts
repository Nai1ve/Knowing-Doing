export interface PracticeCapability {
  key: 'mysql.slow-query-index'
  nodeKey: 'mysql-slow-query-index-gym'
  title: string
  capabilityKey: 'mysql.slow-query'
  caseIntent: 'mysql.slow-query-index'
  caseId: 'mysql-order-list-index-001'
  learningMode: 'lab'
  completionStandard: string
  keywords: RegExp
}

const MYSQL_SLOW_QUERY: PracticeCapability = {
  key: 'mysql.slow-query-index',
  nodeKey: 'mysql-slow-query-index-gym',
  title: 'MySQL 慢查询与索引实验',
  capabilityKey: 'mysql.slow-query',
  caseIntent: 'mysql.slow-query-index',
  caseId: 'mysql-order-list-index-001',
  learningMode: 'lab',
  completionStandard: '完成一次慢查询定位，使用 EXPLAIN 和索引调整验证判断。',
  keywords: /(mysql|慢查询|慢查|explain|执行计划|联合索引|索引优化|数据库性能|查询优化)/i,
}

export class PracticeCapabilityCatalog {
  private readonly capabilities = [MYSQL_SLOW_QUERY] as const

  all(): readonly PracticeCapability[] { return this.capabilities }
  get(key: string): PracticeCapability | null { return this.capabilities.find((item) => item.key === key) ?? null }
  mysqlSlowQuery(): PracticeCapability { return MYSQL_SLOW_QUERY }
  recommend(text: string): PracticeCapability[] { return this.capabilities.filter((item) => item.keywords.test(text)) }
}

export const practiceCapabilityCatalog = new PracticeCapabilityCatalog()
