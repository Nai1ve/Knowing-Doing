import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentPlanningService, type PlanningProvider } from '../src/agent-planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

function withService<T>(callback: (service: AgentPlanningService, repository: ProductRepository) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-agent-planning-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const provider: PlanningProvider = { providerName: 'test', modelName: 'test-model', async stream(_input, onDelta) { await onDelta('我先确认你的目标。'); return '我先确认你的目标。' }, async interpret() { return { coveredTopics: ['goal_deadline'], dimensions: [{ key: 'backend', level: 'applied', confidence: 0.7, summary: '有实践线索', nextValidation: '完成一个真实单元' }], evidence: [], followUpTopic: 'projects' } } }
  try { return Promise.resolve(callback(new AgentPlanningService(repository, provider), repository)).finally(() => repository.close()) } catch (error) { repository.close(); throw error }
}

describe('AgentPlanningService', () => {
  it('stores arbitrary messages, required topics and profile increments without duplicate requests', async () => withService(async (service, repository) => {
    const events: string[] = []; const first = service.createSession('agent-learner', { message: '我想成为高级后端和 AI 应用工程师', clientRequestId: 'start-1' })
    await service.streamMessage('agent-learner', first.id, first.goal, 'start-1', async (event) => { events.push(event.type) })
    await service.streamMessage('agent-learner', first.id, '我做过支付服务，也负责过数据库优化', 'turn-2', async (event) => { events.push(event.type) })
    const session = service.getSession('agent-learner', first.id)
    expect(session.messages.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(session.requiredTopics.find((topic) => topic.key === 'goal_deadline')?.status).toBe('covered')
    expect(session.profile?.dimensions[0].level).toBe('applied')
    expect(events).toContain('profile_updated')
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM planning_agent_invocations').get()).toMatchObject({ count: 2 })
  }))

  it('does not append the original user message during invocation retry', async () => withService(async (service, repository) => {
    const first = service.createSession('retry-learner', { message: '我想系统学习后端', clientRequestId: 'start-2' })
    await service.streamMessage('retry-learner', first.id, first.goal, 'start-2', async () => undefined)
    const invocation = repository.db.prepare("SELECT id FROM planning_agent_invocations WHERE session_id = ? AND kind = 'planner'").get(first.id) as { id: string }
    await service.retryInvocation('retry-learner', invocation.id, async () => undefined)
    expect(repository.db.prepare("SELECT COUNT(*) AS count FROM planning_messages WHERE session_id = ? AND role = 'user'").get(first.id)).toMatchObject({ count: 1 })
  }))
})
