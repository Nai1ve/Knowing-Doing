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

const validRoadmap = { nodes: [
  { key: 'root', parentKey: null, type: 'domain', title: '后端能力', summary: '围绕当前目标组织学习。', points: ['目标'], standard: '能够说明目标和下一步。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] },
  { key: 'root-2', parentKey: null, type: 'domain', title: '工程能力', summary: '补充工程目标。', points: ['工程'], standard: '能够说明工程目标。', minutes: 60, priority: 2, mode: 'knowledge', caseIntent: null, contextKeys: [] },
  { key: 'module', parentKey: 'root', type: 'capability', title: '系统设计', summary: '系统设计能力。', points: ['设计'], standard: '能够说明系统设计。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] },
  { key: 'module-2', parentKey: 'root-2', type: 'capability', title: '交付能力', summary: '交付能力。', points: ['交付'], standard: '能够说明交付能力。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] },
  { key: 'concept', parentKey: 'module', type: 'concept', title: '具体学习节点', summary: '围绕当前目标推进一次学习。', points: ['观察'], standard: '能够说明目标和下一步。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] },
  { key: 'concept-2', parentKey: 'module-2', type: 'concept', title: '交付学习节点', summary: '围绕交付推进一次学习。', points: ['实践'], standard: '能够说明交付和下一步。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] },
], unitKeys: ['concept'], dependencies: [] }

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

  it('treats an uploaded resume as explicit planner context and profile evidence', async () => {
    let streamedResume: string | null = null
    let streamedFacts: string[] = []
    let interpretedResume: string | null = null
    const provider: PlanningProvider = {
      providerName: 'resume-test', modelName: 'test-model',
      async stream(input, onDelta) {
        streamedResume = input.resumeText ?? null
        streamedFacts = input.context?.explicitFacts.map((item) => item.content) ?? []
        await onDelta('我已经结合简历中的经历继续确认。')
        return '我已经结合简历中的经历继续确认。'
      },
      async interpret(input) {
        interpretedResume = input.resumeText ?? null
        return { coveredTopics: [], dimensions: [], evidence: [], followUpTopic: 'projects' }
      },
    }
    await withService(async (service, repository) => {
      const learnerId = 'resume-agent-learner'
      const session = service.createSession(learnerId, { message: '我想成为高级后端工程师', clientRequestId: 'resume-agent-start' })
      const attachment = repository.replacePlanningResumeAttachment({ id: 'resume-attachment-1', learnerId, planningSessionId: session.id, originalFilename: 'resume.pdf', storedFilename: 'resume-attachment-1.pdf', sizeBytes: 128, sha256: 'resume-hash', pageCount: 1, extractedText: '在支付平台负责订单服务、MySQL 性能和发布决策。' })
      await service.attachResume(learnerId, session.id)
      const context = new PlanningContextCompiler(repository.db).current(learnerId, session.id)
      expect(context?.explicitFacts).toEqual(expect.arrayContaining([expect.objectContaining({ content: '在支付平台负责订单服务、MySQL 性能和发布决策。', confidence: 1, importance: 5 })]))
      await service.streamMessage(learnerId, session.id, session.goal, 'resume-agent-start', async () => undefined)
      expect(streamedResume).toContain('支付平台负责订单服务')
      expect(streamedFacts).toContain('在支付平台负责订单服务、MySQL 性能和发布决策。')
      expect(interpretedResume).toContain('MySQL 性能')
      expect(service.getSession(learnerId, session.id).profile?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'resume', sourceId: 'resume-attachment-1' })]))
    }, provider)
  })

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
    const responses = [
      { domains: [{ key: 'root', title: '后端能力', summary: '围绕当前目标组织学习。', points: ['目标'], standard: '能够说明目标和下一步。', minutes: 60, priority: 1, contextKeys: [] }, { key: 'root-2', title: '工程能力', summary: '补充工程目标。', points: ['工程'], standard: '能够说明工程目标。', minutes: 60, priority: 2, contextKeys: [] }] },
      { modules: [{ key: 'module', domainKey: 'root', title: '系统设计', summary: '系统设计能力。', points: ['设计'], standard: '能够说明系统设计。', minutes: 60, priority: 1, contextKeys: [] }, { key: 'module-2', domainKey: 'root-2', title: '交付能力', summary: '交付能力。', points: ['交付'], standard: '能够说明交付能力。', minutes: 60, priority: 1, contextKeys: [] }] },
      { units: [{ key: 'concept', parentKey: 'module', type: 'concept', title: '具体学习节点', summary: '围绕当前目标推进一次学习。', points: ['观察'], standard: '能够说明目标和下一步。', minutes: 60, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] }, { key: 'concept-2', parentKey: 'module-2', type: 'concept', title: '交付学习节点', summary: '围绕交付推进一次学习。', points: ['实践'], standard: '能够说明交付和下一步。', minutes: 60, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] }], unitKeys: ['concept'] },
      { malformed: true },
      { unitKeys: ['concept'], dependencies: [], revisions: [] },
    ]
    const fetchMock = vi.fn(async () => modelResponse(responses.shift() ?? validRoadmap))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const agent = new DeepSeekPlanningAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const phases: Array<{ phase: string; status: string }> = []
      const plan = await agent.generateRoadmap({ goal: '成为后端工程师', messages: [], context: null, onPhase: (event) => { phases.push(event) } })
      expect(plan).toMatchObject({ unitKeys: ['concept'], dependencies: [] })
      expect(plan.nodes.map((node) => [node.key, node.parentKey, node.type])).toEqual(validRoadmap.nodes.map((node) => [node.key, node.parentKey, node.type]))
      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(phases.filter((event) => event.phase === 'critic' && event.status === 'succeeded')).toHaveLength(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('repairs missing module coverage before compiling the complete three-level tree', async () => {
    const domain = (key: string) => ({ key, title: key, summary: '能力域说明', points: ['关键点'], standard: '完成标准', minutes: 60, priority: 1, contextKeys: [] })
    const module = (key: string, domainKey: string) => ({ key, domainKey, title: key, summary: '能力分支说明', points: ['关键点'], standard: '完成标准', minutes: 60, priority: 1, contextKeys: [] })
    const unit = (key: string, parentKey: string) => ({ key, parentKey, type: 'concept', title: key, summary: '具体学习节点', points: ['观察'], standard: '完成标准', minutes: 60, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] })
    const responses = [
      { domains: [domain('domain-one'), domain('domain-two')] },
      { modules: [module('module-one', 'domain-one')] },
      { modules: [module('module-one', 'domain-one'), module('module-two', 'domain-two')] },
      { units: [unit('unit-one', 'module-one'), unit('unit-two', 'module-two')], unitKeys: ['unit-one'] },
      { unitKeys: ['unit-one'], dependencies: [], revisions: [] },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => modelResponse(responses.shift() ?? {})))
    try {
      const agent = new DeepSeekPlanningAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const plan = await agent.generateRoadmap({ goal: '成为后端工程师', messages: [], context: null, onPhase: () => undefined })
      expect(plan.nodes).toHaveLength(6)
      expect(plan.nodes.filter((node) => node.type === 'domain')).toHaveLength(2)
      expect(plan.nodes.filter((node) => node.type === 'capability')).toHaveLength(2)
      expect(plan.nodes.filter((node) => node.type === 'concept')).toHaveLength(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('fails transparently after the critic repair is also invalid', async () => {
    const responses = [{ domains: [] }, { malformed: true }]
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

  it('replaces only the active roadmap owned by the planning session and preserves its lineage', async () => withService(async (service, repository) => {
    const learnerId = 'repair-learner'
    const session = service.createSession(learnerId, { message: '我想学习 MySQL 慢查询和索引优化', clientRequestId: 'repair-start' })
    const firstGeneration = await service.generateRoadmap(learnerId, session.id, 'repair-initial')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const oldRoadmapId = service.getRoadmapGeneration(learnerId, firstGeneration.id).roadmapId as string
    const plan = new PlanningService(repository).confirm(learnerId, oldRoadmapId, 1)

    const replacement = await service.repairCurrentRoadmap(learnerId, session.id, 'repair-replace')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const newRoadmapId = service.getRoadmapGeneration(learnerId, replacement.id).roadmapId as string
    expect(newRoadmapId).not.toBe(oldRoadmapId)
    expect(repository.db.prepare('SELECT status, based_on_roadmap_id FROM learning_roadmaps WHERE id = ?').get(oldRoadmapId)).toMatchObject({ status: 'archived' })
    expect(repository.db.prepare('SELECT status, based_on_roadmap_id FROM learning_roadmaps WHERE id = ?').get(newRoadmapId)).toMatchObject({ status: 'active', based_on_roadmap_id: oldRoadmapId })
    expect(repository.getActivePlan(learnerId)?.id).toBe(plan.id)
    expect(repository.getActivePlan(learnerId)?.roadmapId).toBe(newRoadmapId)
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM plan_units WHERE plan_id = ?').get(plan.id)).toMatchObject({ count: 1 })

    const unrelated = service.createSession(learnerId, { message: '我想学习 Python list', clientRequestId: 'repair-unrelated' })
    await expect(service.repairCurrentRoadmap(learnerId, unrelated.id, 'repair-unrelated-request')).rejects.toMatchObject({ code: 'roadmap_replace_session_mismatch' })
  }))

  it('rejects direct replacement once the active plan has a practice reference', async () => withService(async (service, repository) => {
    const learnerId = 'repair-practice-learner'
    const session = service.createSession(learnerId, { message: '我想学习 MySQL 慢查询', clientRequestId: 'repair-practice-start' })
    const generation = await service.generateRoadmap(learnerId, session.id, 'repair-practice-initial')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const roadmapId = service.getRoadmapGeneration(learnerId, generation.id).roadmapId as string
    const plan = new PlanningService(repository).confirm(learnerId, roadmapId, 1)
    repository.startPlanUnitPractice({ learnerId, planId: plan.id, planUnitId: plan.units[0].id, caseId: 'mysql-order-list-index-001' })
    await expect(service.repairCurrentRoadmap(learnerId, session.id, 'repair-practice-replace')).rejects.toMatchObject({ code: 'roadmap_replace_has_practice' })
  }))
})
