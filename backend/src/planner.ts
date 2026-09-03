import type { CaseId } from './domain.js'
import type { Intake, LearningPlan, PlanUnit } from './product-types.js'
import type { ProductRepository } from './product-repository.js'

const MYSQL_UNITS: Array<{ title: string; objective: string; caseId: CaseId | null }> = [
  { title: '建立数据库问题的观察框架', objective: '从症状、业务约束和可验证证据开始，而不是先背优化答案。', caseId: null },
  { title: '慢查询与联合索引', objective: '能用 EXPLAIN、结果集和基准验证一个慢查询优化假设。', caseId: 'mysql-order-list-index-001' },
  { title: '死锁与锁等待', objective: '区分临时止损和根因修复，并用两个事务会话复测访问顺序。', caseId: 'mysql-deadlock-lock-order-001' },
  { title: '深分页与产品约束', objective: '比较 OFFSET 和游标分页，说明性能与交互能力的取舍。', caseId: 'mysql-deep-pagination-001' },
  { title: '把一次排障写成可复用方法', objective: '从事件、证据、失败尝试和残余风险整理工程复盘。', caseId: null },
]

export function createPlan(repository: ProductRepository, intake: Intake): LearningPlan {
  const technology = /mysql|数据库|sql/i.test(`${intake.technology} ${intake.goal}`) ? 'MySQL 8' : intake.technology
  const units: Array<Omit<PlanUnit, 'id' | 'planId'>> = MYSQL_UNITS.map((unit, index) => ({
    ...unit, position: index + 1, status: index === 0 ? 'current' : 'upcoming', availability: unit.caseId && index === 1 ? 'available' : 'coming_soon', completedAt: null, sourceRefs: [], learningMode: unit.caseId ? 'lab' : 'unavailable', estimatedMinutes: 90, rationale: '按固定学习路线推进。',
  }))
  return repository.createPlan({ learnerId: intake.learnerId, intakeId: intake.id, title: `${technology} 工程实践路线`, goal: intake.goal, sourceStatus: 'local_catalog', units })
}
