import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentPlanningService, DeepSeekPlanningAgent, PlanningAgentError, type PlanningProvider } from '../src/agent-planning.js'
import { PlanningContextCompiler } from '../src/planning-context.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { PlanningService } from '../src/planning.js'

function withService<T>(callback: (service: AgentPlanningService, repository: ProductRepository) => Promise<T> | T, providerOverride?: PlanningProvider): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-agent-planning-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const provider: PlanningProvider = { providerName: 'test', modelName: 'test-model', async stream(_input, onDelta) { await onDelta('我先确认你的目标。'); return '我先确认你的目标。' }, async interpret() { return { coveredTopics: ['goal_deadline'], dimensions: [{ key: 'backend', level: 'applied', confidence: 0.7, summary: '有实践线索', nextValidation: '完成一个真实单元' }], evidence: [], followUpTopic: 'projects' } } }
  try { return Promise.resolve(callback(new AgentPlanningService(repository, providerOverride ?? provider), repository)).finally(() => repository.close()) } catch (error) { repository.close(); throw error }
}

const validRoadmap = { nodes: [{ key: 'root', parentKey: null, type: 'domain', title: '后端能力', summary: '围绕当前目标组织学习。', points: ['目标'], standard: '能够说明目标和下一步。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] }], unitKeys: ['root'], dependencies: [] }

function modelResponse(value: unknown): Response { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } }) }

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
    expect(events).toContain('roadmap_readiness')
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM planning_agent_invocations').get()).toMatchObject({ count: 2 })
  }))

  it('exposes resumable planning state and coalesces concurrent roadmap generation', async () => withService(async (service, repository) => {
    const learnerId = 'state-learner'
    const session = service.createSession(learnerId, { message: '我想学习 MySQL 慢查询和索引优化', clientRequestId: 'state-start' })
    await service.streamMessage(learnerId, session.id, session.goal, 'state-start', async () => undefined)

    const first = await service.generateRoadmap(learnerId, session.id, 'state-roadmap')
    const second = await service.generateRoadmap(learnerId, session.id, 'state-roadmap-retry')
    expect(second.id).toBe(first.id)

    await new Promise((resolve) => setTimeout(resolve, 20))
    const state = service.planningState(learnerId)
    expect(state.session?.id).toBe(session.id)
    expect(state.generation?.id).toBe(first.id)
    expect(state.generation?.status).toBe('succeeded')
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM roadmap_generation_runs WHERE planning_session_id = ?').get(session.id)).toMatchObject({ count: 1 })
    const plan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT id FROM roadmap_generation_runs WHERE planning_session_id = ? ORDER BY created_at DESC LIMIT 1').all(session.id) as Array<{ detail: string }>
    expect(plan.some((row) => row.detail.includes('idx_roadmap_generation_session_created'))).toBe(true)
  }))

  it('repairs one invalid critic response before returning a roadmap', async () => {
    const responses = [{ domains: [] }, { modules: [] }, { units: [] }, { malformed: true }, validRoadmap]
    const fetchMock = vi.fn(async () => modelResponse(responses.shift() ?? validRoadmap))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const agent = new DeepSeekPlanningAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const phases: Array<{ phase: string; status: string }> = []
      const plan = await agent.generateRoadmap({ goal: '成为后端工程师', messages: [], context: null, onPhase: (event) => { phases.push(event) } })
      expect(plan).toEqual(validRoadmap)
      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(phases.filter((event) => event.phase === 'critic' && event.status === 'succeeded')).toHaveLength(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('fails transparently after the critic repair is also invalid', async () => {
    const responses = [{ domains: [] }, { modules: [] }, { units: [] }, { malformed: true }, { stillMalformed: true }]
    vi.stubGlobal('fetch', vi.fn(async () => modelResponse(responses.shift() ?? {})))
    try {
      const agent = new DeepSeekPlanningAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      await expect(agent.generateRoadmap({ goal: '成为后端工程师', messages: [], context: null, onPhase: () => undefined })).rejects.toMatchObject({ code: 'roadmap_invalid_output' })
    } finally { vi.unstubAllGlobals() }
  })

  it('marks the session failed while retaining messages when roadmap generation fails', async () => {
    const failingProvider: PlanningProvider = {
      providerName: 'test-failure', modelName: 'test-model',
      async stream(_input, onDelta) { await onDelta('我先确认你的目标。'); return '我先确认你的目标。' },
      async interpret() { return { coveredTopics: [], dimensions: [], evidence: [], followUpTopic: null } },
      async generateRoadmap({ onPhase }) { onPhase({ phase: 'domain', status: 'started' }); throw new PlanningAgentError('roadmap_invalid_output', '路线 JSON 无效', true, { validationIssues: [{ path: 'nodes', code: 'too_small' }] }) },
    }
    await withService(async (service) => {
      const session = service.createSession('failed-generation-learner', { message: '我想学习后端系统设计', clientRequestId: 'failed-start' })
      const generation = await service.generateRoadmap('failed-generation-learner', session.id, 'failed-roadmap')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(service.getRoadmapGeneration('failed-generation-learner', generation.id)).toMatchObject({ status: 'failed', failureCode: 'roadmap_invalid_output' })
      const restored = service.getSession('failed-generation-learner', session.id)
      expect(restored.agentStatus).toBe('failed')
      expect(restored.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    }, failingProvider)
  })

  it('does not append the original user message during invocation retry', async () => withService(async (service, repository) => {
    const first = service.createSession('retry-learner', { message: '我想系统学习后端', clientRequestId: 'start-2' })
    await service.streamMessage('retry-learner', first.id, first.goal, 'start-2', async () => undefined)
    const invocation = repository.db.prepare("SELECT id FROM planning_agent_invocations WHERE session_id = ? AND kind = 'planner'").get(first.id) as { id: string }
    await service.retryInvocation('retry-learner', invocation.id, async () => undefined)
    expect(repository.db.prepare("SELECT COUNT(*) AS count FROM planning_messages WHERE session_id = ? AND role = 'user'").get(first.id)).toMatchObject({ count: 1 })
  }))

  it('rejects a second process while the session row is marked running', async () => withService(async (service, repository) => {
    const session = service.createSession('busy-learner', { message: '我想学习后端系统设计', clientRequestId: 'busy-start' })
    repository.db.prepare("UPDATE planning_sessions SET agent_status = 'running' WHERE id = ?").run(session.id)
    await expect(service.streamMessage('busy-learner', session.id, '补充我的项目经历', 'busy-turn', async () => undefined)).rejects.toMatchObject({ code: 'planning_busy' })
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM planning_messages WHERE session_id = ?').get(session.id)).toMatchObject({ count: 1 })
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

  it('keeps the original planning message when the interpreter returns no evidence', async () => withService(async (service, repository) => {
    const learnerId = 'raw-message-learner'; const session = service.createSession(learnerId, { message: '我想成为后端和 AI 应用工程师', clientRequestId: 'raw-1' })
    const message = repository.db.prepare("SELECT id FROM planning_messages WHERE session_id = ? AND role = 'user'").get(session.id) as { id: string }
    const packet = new PlanningContextCompiler(repository.db).update({ learnerId, sessionId: session.id, goal: session.goal, messageId: message.id, clientRequestId: 'raw-1', resumeText: null, delta: { evidence: [], dimensions: [], coveredTopics: [], followUpTopic: null } })
    expect(packet.explicitFacts.map((item) => item.content)).toContain('我想成为后端和 AI 应用工程师')
    expect(packet.explicitFacts.map((item) => item.content)).not.toContain('用户补充了一轮信息。')
  }))

  it('generates a dynamic MySQL route and materializes the Lab unit from the conversation', async () => withService(async (service, repository) => {
    const session = service.createSession('dynamic-learner', { message: '我想学习 MySQL 慢查询、EXPLAIN 和索引优化', clientRequestId: 'dynamic-1' })
    await service.streamMessage('dynamic-learner', session.id, session.goal, 'dynamic-1', async () => undefined)
    const generation = await service.generateRoadmap('dynamic-learner', session.id, 'roadmap-1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const completed = service.getRoadmapGeneration('dynamic-learner', generation.id)
    expect(completed.status).toBe('succeeded')
    expect(completed.roadmapId).toBeTruthy()
    const planning = new PlanningService(repository)
    const draft = planning.getDraftForLearner('dynamic-learner', completed.roadmapId as string)
    expect(draft.templateKey).toBe('agent-roadmap-v2')
    expect(draft.nodes.some((node) => node.caseId === 'mysql-order-list-index-001')).toBe(true)
    expect(draft.nodes.some((node) => node.evidence.length > 0)).toBe(true)
    const plan = planning.confirm('dynamic-learner', draft.id, draft.revision)
    expect(plan.units[0].learningMode).toBe('lab')
    expect(plan.units[0].caseId).toBe('mysql-order-list-index-001')

    const nodePlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT n.id FROM roadmap_nodes n WHERE n.roadmap_id = ? AND n.parent_id IS NULL ORDER BY n.position').all(draft.id) as Array<{ detail: string }>
    expect(nodePlan.some((row) => row.detail.includes('idx_roadmap_nodes_parent_position'))).toBe(true)
    const evidencePlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT e.source_type, e.source_id FROM roadmap_node_evidence e WHERE e.roadmap_id = ? AND e.node_id = ? ORDER BY e.position').all(draft.id, draft.nodes.find((node) => node.caseId === 'mysql-order-list-index-001')?.id) as Array<{ detail: string }>
    expect(evidencePlan.some((row) => row.detail.includes('idx_roadmap_node_evidence_node_position'))).toBe(true)
  }))
})
