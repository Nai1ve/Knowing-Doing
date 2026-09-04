import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentPlanningService, type PlanningProvider } from '../src/agent-planning.js'
import { PlanningContextCompiler } from '../src/planning-context.js'
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

  it('accepts feedback only for materials in the owned route', async () => withService(async (service, repository) => {
    repository.ensureLearner('feedback-learner')
    const roadmapId = randomUUID(); const nodeId = randomUUID(); const routeSetId = randomUUID(); const sourceId = randomUUID(); const now = new Date().toISOString()
    repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES (?, ?, 'senior-backend-ai-v1', 'feedback', 'active', 1, '{}', ?, ?)").run(roadmapId, 'feedback-learner', now, now)
    repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, case_id, created_at) VALUES (?, ?, NULL, 'feedback-node', 'concept', '反馈节点', '', '{}', '', 10, 1, 1, 'knowledge', NULL, ?)").run(nodeId, roadmapId, now)
    repository.db.prepare("INSERT INTO knowledge_route_sets(id, learner_id, roadmap_node_id, profile_snapshot_id, query_fingerprint, status, research_json, created_at, updated_at) VALUES (?, ?, ?, NULL, 'feedback-fingerprint', 'ready', '{}', ?, ?)").run(routeSetId, 'feedback-learner', nodeId, now, now)
    repository.db.prepare("INSERT INTO source_items(id, provider, external_id, title, author, url, excerpt, query, retrieved_at, metadata_json) VALUES (?, 'zhihu', ?, '材料', NULL, 'https://www.zhihu.com/a', '', NULL, ?, '{}')").run(sourceId, sourceId, now)
    repository.db.prepare("INSERT INTO knowledge_route_items(id, route_set_id, source_item_id, position, role, reason, learning_question) VALUES (?, ?, ?, 1, 'foundation', '', '')").run(randomUUID(), routeSetId, sourceId)

    service.feedback('feedback-learner', routeSetId, sourceId, 'read')
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM knowledge_route_feedback').get()).toMatchObject({ count: 1 })
    expect(() => service.feedback('feedback-learner', routeSetId, randomUUID(), 'read')).toThrow('材料不属于当前知识路径')
  }))

  it('accumulates sourced facts and closes covered questions across context versions', async () => withService(async (service, repository) => {
    const learnerId = 'context-learner'; const session = service.createSession(learnerId, { message: '我想成为高级后端工程师', clientRequestId: 'context-1' }); const compiler = new PlanningContextCompiler(repository.db)
    const firstMessage = repository.db.prepare("SELECT id FROM planning_messages WHERE session_id = ? AND role = 'user'").get(session.id) as { id: string }
    const first = compiler.update({ learnerId, sessionId: session.id, goal: session.goal, messageId: firstMessage.id, clientRequestId: 'context-1', resumeText: null, delta: { evidence: [{ topicKey: 'projects', sourceType: 'user_message', sourceId: firstMessage.id, excerpt: '参与过支付服务开发' }], dimensions: [], coveredTopics: ['projects'], followUpTopic: 'responsibility' } })
    repository.db.prepare("INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, client_request_id, created_at) VALUES (?, ?, 2, 'user', '我负责服务边界和发布决策', '{}', 'context-2', ?)").run(randomUUID(), session.id, new Date().toISOString())
    const secondMessage = repository.db.prepare("SELECT id FROM planning_messages WHERE session_id = ? AND client_request_id = 'context-2'").get(session.id) as { id: string }
    const second = compiler.update({ learnerId, sessionId: session.id, goal: session.goal, messageId: secondMessage.id, clientRequestId: 'context-2', resumeText: null, delta: { evidence: [{ topicKey: 'responsibility', sourceType: 'user_message', sourceId: secondMessage.id, excerpt: '负责服务边界和发布决策' }], dimensions: [], coveredTopics: ['responsibility'], followUpTopic: null } })
    expect(first.version).toBe(1); expect(second.version).toBe(2); expect(second.explicitFacts.map((item) => item.content)).toEqual(expect.arrayContaining(['参与过支付服务开发', '负责服务边界和发布决策']))
    expect(second.openQuestions).toHaveLength(0)
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM planning_context_snapshots WHERE session_id = ?').get(session.id)).toMatchObject({ count: 2 })
  }))
})
