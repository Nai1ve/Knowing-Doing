import type { AgentPlanningSession, AgentProfileDimension, AgentRoadmapGeneration, AgentPlanningTopic, CurrentRoadmapResponse, KnowledgeRoute, PlanningSession, ProductDiagnosticSession, ProductOnboardingState, ProductPlan, ProductPlanProposal, ProductResumeAttachment, RoadmapDraft, RoadmapNode } from '@/types/product'

const DEMO_LEARNER_ID = 'demo-learner-001'
const DEMO_PLAN_ID = 'demo-plan-mysql-001'
const DEMO_ROADMAP_ID = 'demo-roadmap-001'
const DEMO_INTAKE_ID = 'demo-intake-001'
const DEMO_NOW = '2026-09-06T09:00:00.000Z'
const DEFAULT_GOAL = '我想系统掌握 MySQL 慢查询优化，并能从真实问题出发完成定位、验证和复盘。'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function makeProductPlan(goal = DEFAULT_GOAL): ProductPlan {
  return {
    id: DEMO_PLAN_ID,
    learnerId: DEMO_LEARNER_ID,
    intakeId: DEMO_INTAKE_ID,
    roadmapId: DEMO_ROADMAP_ID,
    title: 'MySQL 性能优化实战',
    goal,
    sourceStatus: 'demo',
    status: 'active',
    planState: 'active',
    templateKey: 'mysql-performance-v1',
    revision: 3,
    weeklyMinutes: 240,
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: DEMO_NOW,
    units: [
      {
        id: 'demo-unit-explain', planId: DEMO_PLAN_ID, roadmapNodeId: 'demo-node-explain', position: 1,
        title: '读懂 EXPLAIN 的关键字段', objective: '能从访问类型、候选索引和扫描行数判断一次查询是否值得继续优化。',
        caseId: null, status: 'completed', availability: 'available', learningMode: 'unavailable', estimatedMinutes: 45,
        rationale: '先建立统一的执行计划语言，再进入真实案例。', completedAt: '2026-08-18T11:30:00.000Z', sourceRefs: ['mysql-explain-demo'],
      },
      {
        id: 'demo-unit-order-index', planId: DEMO_PLAN_ID, roadmapNodeId: 'demo-node-order-index', position: 2,
        title: '给订单列表找到合适索引', objective: '从慢查询现象出发，对比索引前后的执行计划和扫描代价，并说明为什么索引有效。',
        caseId: 'mysql-order-list-index-001', status: 'current', availability: 'available', learningMode: 'lab', estimatedMinutes: 60,
        rationale: '这是当前唯一开放的真实实践节点，用来验证索引判断是否能落到数据上。', completedAt: null, sourceRefs: ['mysql-order-list-index-001'],
      },
      {
        id: 'demo-unit-pagination', planId: DEMO_PLAN_ID, roadmapNodeId: 'demo-node-deep-pagination', position: 3,
        title: '修复深分页的扫描浪费', objective: '理解 OFFSET 在深页上的代价，并设计可以验证的 seek pagination 方案。',
        caseId: 'mysql-deep-pagination-001', status: 'upcoming', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 55,
        rationale: '需要先完成订单列表索引案例，内容接入后再开放实践。', completedAt: null, sourceRefs: ['mysql-deep-pagination-001'],
      },
      {
        id: 'demo-unit-deadlock', planId: DEMO_PLAN_ID, roadmapNodeId: 'demo-node-deadlock', position: 4,
        title: '识别并复现死锁', objective: '用两个事务还原锁顺序冲突，记录等待证据，并提出可验证的修复策略。',
        caseId: 'mysql-deadlock-lock-order-001', status: 'upcoming', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 65,
        rationale: '把单条查询优化扩展到并发和事务边界。', completedAt: null, sourceRefs: ['mysql-deadlock-lock-order-001'],
      },
      {
        id: 'demo-unit-retrospective', planId: DEMO_PLAN_ID, roadmapNodeId: 'demo-node-retrospective', position: 5,
        title: '形成一份性能复盘', objective: '把现象、假设、证据、尝试和结论组织成一份可复用的工程复盘。',
        caseId: null, status: 'upcoming', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 45,
        rationale: '最后将实践证据沉淀为可以迁移给团队的表达。', completedAt: null, sourceRefs: ['zhixing-writing-demo'],
      },
    ],
  }
}

let mockProductPlan = makeProductPlan()

function makeNode(input: Partial<RoadmapNode> & Pick<RoadmapNode, 'id' | 'title' | 'summary'>): RoadmapNode {
  return {
    roadmapId: DEMO_ROADMAP_ID,
    parentId: null,
    nodeKey: input.id,
    nodeType: 'concept',
    knowledgeCard: { keyPoints: ['先描述现象，再列出证据。', '每次只验证一个关键假设。'] },
    completionStandard: '能用自己的话解释判断依据，并完成一次可复现验证。',
    estimatedMinutes: 45,
    priority: 1,
    position: 1,
    learningMode: 'knowledge',
    caseId: null,
    status: 'available',
    progressSource: 'demo',
    completedAt: null,
    verifiedAt: null,
    progressRevision: 1,
    childCount: 0,
    ...input,
  }
}

const mockRoadmapNodes: RoadmapNode[] = [
  makeNode({ id: 'demo-domain-foundation', nodeType: 'domain', title: '数据库底层理解', summary: '先理解数据、索引和优化器之间的关系，再判断一次查询为什么慢。', status: 'completed', childCount: 2, estimatedMinutes: 120, position: 1 }),
  makeNode({ id: 'demo-domain-performance', nodeType: 'domain', title: '查询性能优化', summary: '围绕慢查询、执行计划和索引设计，建立从现象到证据的排查路径。', status: 'in_progress', childCount: 2, estimatedMinutes: 180, priority: 2, position: 2 }),
  makeNode({ id: 'demo-domain-delivery', nodeType: 'domain', title: '并发与工程交付', summary: '把单条查询的判断扩展到事务、并发和团队可复用的性能复盘。', status: 'available', childCount: 1, estimatedMinutes: 150, priority: 3, position: 3 }),

  makeNode({ id: 'demo-capability-model', parentId: 'demo-domain-foundation', nodeType: 'capability', title: '建立执行计划心智模型', summary: '知道 EXPLAIN 每个字段在回答什么问题。', status: 'completed', childCount: 2, estimatedMinutes: 75, position: 1 }),
  makeNode({ id: 'demo-capability-evidence', parentId: 'demo-domain-foundation', nodeType: 'capability', title: '建立慢查询证据链', summary: '从现象、假设到验证结果，避免凭经验直接改 SQL。', status: 'completed', childCount: 2, estimatedMinutes: 90, position: 2 }),

  makeNode({ id: 'demo-node-explain', parentId: 'demo-capability-model', nodeType: 'concept', title: 'EXPLAIN 的访问类型', summary: '用 type、rows 和 key 判断查询是否在做不必要的扫描。', status: 'completed', completedAt: '2026-08-18T11:30:00.000Z', verifiedAt: '2026-08-18T11:30:00.000Z', estimatedMinutes: 45, position: 1 }),
  makeNode({ id: 'demo-node-covering-index', parentId: 'demo-capability-model', nodeType: 'concept', title: '覆盖索引与回表', summary: '知道索引命中后还需要回表时，额外成本从哪里来。', status: 'completed', completedAt: '2026-08-19T11:30:00.000Z', estimatedMinutes: 30, position: 2 }),
  makeNode({ id: 'demo-node-slow-log', parentId: 'demo-capability-evidence', nodeType: 'concept', title: '从慢查询日志开始', summary: '先固定查询形状和数据范围，再决定观察哪些计划变化。', status: 'completed', completedAt: '2026-08-20T11:30:00.000Z', estimatedMinutes: 40, position: 1 }),
  makeNode({ id: 'demo-node-plan', parentId: 'demo-capability-evidence', nodeType: 'concept', title: '验证优化是否生效', summary: '让每次改动都有前后对照，避免把偶然变快当成稳定收益。', status: 'available', estimatedMinutes: 50, position: 2 }),

  makeNode({ id: 'demo-capability-index', parentId: 'demo-domain-performance', nodeType: 'capability', title: '订单列表索引设计', summary: '从排序、过滤和返回列共同决定联合索引的列顺序。', status: 'in_progress', childCount: 3, estimatedMinutes: 130, priority: 2, position: 1 }),
  makeNode({ id: 'demo-capability-pagination', parentId: 'demo-domain-performance', nodeType: 'capability', title: '深分页与排序代价', summary: '理解 OFFSET 扫描浪费，并把替代方案落到可测量的查询上。', status: 'locked', childCount: 2, estimatedMinutes: 90, priority: 3, position: 2 }),

  makeNode({ id: 'demo-node-order-index', parentId: 'demo-capability-index', nodeType: 'lab', title: '给 order 表找到合适索引', summary: '在真实 MySQL 案例中，对比索引前后的 EXPLAIN 与扫描行数。', status: 'in_progress', learningMode: 'lab', caseId: 'mysql-order-list-index-001', estimatedMinutes: 60, position: 1 }),
  makeNode({ id: 'demo-node-composite-order', parentId: 'demo-capability-index', nodeType: 'concept', title: '复合索引的列顺序', summary: '把 WHERE、ORDER BY 和选择性放在同一个判断里。', status: 'available', estimatedMinutes: 35, position: 2 }),
  makeNode({ id: 'demo-node-index-verify', parentId: 'demo-capability-index', nodeType: 'concept', title: '用前后对照验证收益', summary: '检查 key、rows、Extra 以及真实耗时是否朝同一个方向变化。', status: 'available', estimatedMinutes: 35, position: 3 }),
  makeNode({ id: 'demo-node-deep-pagination', parentId: 'demo-capability-pagination', nodeType: 'lab', title: '限制深分页的扫描范围', summary: '对比 OFFSET 与基于游标的分页方式，解释扫描代价差异。', status: 'locked', learningMode: 'unavailable', caseId: 'mysql-deep-pagination-001', estimatedMinutes: 55, position: 1 }),
  makeNode({ id: 'demo-node-seek-pagination', parentId: 'demo-capability-pagination', nodeType: 'concept', title: 'Seek pagination', summary: '以稳定排序键作为下一页边界，避免从头跳过大量记录。', status: 'locked', learningMode: 'unavailable', estimatedMinutes: 35, position: 2 }),

  makeNode({ id: 'demo-capability-delivery', parentId: 'demo-domain-delivery', nodeType: 'capability', title: '并发排障与性能复盘', summary: '在事务冲突和工程沟通之间建立一条可追溯证据链。', status: 'locked', childCount: 2, estimatedMinutes: 150, priority: 4, position: 1 }),
  makeNode({ id: 'demo-node-deadlock', parentId: 'demo-capability-delivery', nodeType: 'lab', title: '复现并解释死锁', summary: '用两个事务还原锁顺序冲突，记录等待关系和修复策略。', status: 'locked', learningMode: 'unavailable', caseId: 'mysql-deadlock-lock-order-001', estimatedMinutes: 65, position: 1 }),
  makeNode({ id: 'demo-node-retrospective', parentId: 'demo-capability-delivery', nodeType: 'project', title: '形成一份性能复盘', summary: '把实践过程写成团队可以复用的现象、证据和判断。', status: 'locked', learningMode: 'unavailable', estimatedMinutes: 45, position: 2 }),
]

const mockRoadmapProgress = {
  total: mockRoadmapNodes.length,
  completed: mockRoadmapNodes.filter((node) => node.status === 'completed' || node.status === 'verified').length,
  verified: mockRoadmapNodes.filter((node) => node.status === 'verified').length,
  available: mockRoadmapNodes.filter((node) => node.status === 'available' || node.status === 'in_progress').length,
}

const mockRoadmap = {
  id: DEMO_ROADMAP_ID,
  learnerId: DEMO_LEARNER_ID,
  templateKey: 'senior-backend-ai-v1' as const,
  goal: DEFAULT_GOAL,
  status: 'active' as const,
  revision: 3,
  inputSnapshot: { source: 'demo', weeklyMinutes: 240, priorityDomain: '查询性能优化' },
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: DEMO_NOW,
  progress: mockRoadmapProgress,
}

const mockCurrentRoadmap: CurrentRoadmapResponse = {
  roadmap: mockRoadmap,
  roots: mockRoadmapNodes.filter((node) => node.parentId === null),
  currentPlan: mockProductPlan,
}

const mockRoadmapDraft: RoadmapDraft = {
  ...mockRoadmap,
  status: 'draft',
  planningSessionId: 'demo-planning-session',
  planningSessionRevision: 2,
  diff: [
    { key: 'priority_domain', label: '优先方向', before: null, after: '查询性能优化' },
    { key: 'weekly_minutes', label: '每周投入', before: null, after: '240 分钟' },
    { key: 'first_practice', label: '首个实践', before: null, after: '订单列表索引设计' },
  ],
  nodes: mockRoadmapNodes,
}

const mockTopics: AgentPlanningTopic[] = [
  { key: 'goal_deadline', label: '目标与期限', priority: 1, status: 'covered', evidenceRefs: ['demo-message-1'] },
  { key: 'projects', label: '真实项目经历', priority: 2, status: 'covered', evidenceRefs: ['demo-message-1'] },
  { key: 'responsibility', label: '实际职责与决策范围', priority: 3, status: 'needs_follow_up', evidenceRefs: [] },
  { key: 'strengths_gaps', label: '当前强弱项', priority: 4, status: 'unknown', evidenceRefs: [] },
  { key: 'time_constraints', label: '每周投入与约束', priority: 5, status: 'covered', evidenceRefs: ['demo-message-1'] },
  { key: 'outcome', label: '预期产出', priority: 6, status: 'covered', evidenceRefs: ['demo-message-1'] },
]

const mockDimensions: AgentProfileDimension[] = [
  { key: '后端系统', level: 'applied', confidence: .78, summary: '有服务开发经验，能把问题放回系统边界里思考。', nextValidation: '用一次真实故障说明你的排查顺序。' },
  { key: 'MySQL 性能', level: 'exposed', confidence: .52, summary: '知道慢查询和索引是方向，但还需要通过执行计划验证判断。', nextValidation: '完成订单列表索引案例。' },
  { key: '工程表达', level: 'applied', confidence: .66, summary: '能够描述问题背景，下一步需要把证据和结论连接起来。', nextValidation: '将实践过程整理成性能复盘。' },
]

function makeAgentSession(goal = DEFAULT_GOAL): AgentPlanningSession {
  return {
    id: 'demo-agent-session', learnerId: DEMO_LEARNER_ID, goal, status: 'ready', mode: 'agent', agentStatus: 'waiting_for_user', revision: 2,
    messages: [
      { id: 'demo-message-1', sequence: 1, role: 'user', content: goal, metadata: {}, createdAt: '2026-09-06T08:55:00.000Z' },
      { id: 'demo-message-2', sequence: 2, role: 'assistant', content: '我先把目标收窄到一个可以验证的方向：从 MySQL 慢查询开始，逐步覆盖执行计划、索引设计和并发排障。你可以继续补充一个最近遇到的真实查询问题，也可以先查看这张演示路线。', metadata: { demo: true }, createdAt: DEMO_NOW },
    ],
    requiredTopics: clone(mockTopics),
    profile: { id: 'demo-profile-001', version: 1, summary: { source: 'demo', headline: '先用一个真实 MySQL 案例验证判断。' }, dimensions: clone(mockDimensions), evidence: [] },
    resume: null, roadmapId: DEMO_ROADMAP_ID, createdAt: '2026-09-06T08:55:00.000Z', updatedAt: DEMO_NOW,
  }
}

let mockAgentSession = makeAgentSession()

const mockPlanningSession: PlanningSession = {
  id: 'demo-planning-session', learnerId: DEMO_LEARNER_ID, templateKey: 'senior-backend-ai-v1', goal: DEFAULT_GOAL,
  status: 'proposed', currentStep: 5, revision: 2,
  answers: { goal: DEFAULT_GOAL, priority_domain: '查询性能优化', weekly_minutes: 240, outcome: '完成可复现的性能复盘' },
  turns: [], nextQuestion: null, draftRoadmapId: DEMO_ROADMAP_ID, resume: null,
  createdAt: '2026-09-06T08:55:00.000Z', updatedAt: DEMO_NOW,
}

const mockDiagnosticSession: ProductDiagnosticSession = {
  id: 'demo-diagnostic-session', learnerId: DEMO_LEARNER_ID, intakeId: DEMO_INTAKE_ID, goal: DEFAULT_GOAL, targetKey: 'mysql_performance',
  status: 'draft', rulesVersion: 'diagnostic-v1', revision: 1, createdAt: '2026-09-06T08:55:00.000Z', updatedAt: DEMO_NOW, turns: [], evidence: [],
}

function proposalUnits(): ProductPlanProposal['planSnapshot']['units'] {
  return mockProductPlan.units.map(({ position, title, objective, caseId, status, availability, learningMode, estimatedMinutes, rationale, sourceRefs }) => ({ position, title, objective, caseId, status, availability, learningMode, estimatedMinutes, rationale, sourceRefs }))
}

const mockPlanProposal: ProductPlanProposal = {
  id: 'demo-plan-proposal-001', learnerId: DEMO_LEARNER_ID, diagnosticSessionId: mockDiagnosticSession.id, inputFingerprint: 'demo-fingerprint',
  templateKey: 'mysql-performance-v1', targetKey: 'mysql_performance', status: 'ready', rulesVersion: 'diagnostic-v1', revision: 1,
  inputSnapshot: { goal: DEFAULT_GOAL, weeklyMinutes: 240, experience: '有后端服务开发经验。' },
  planSnapshot: { title: mockProductPlan.title, goal: mockProductPlan.goal, planState: 'active', units: proposalUnits() },
  rationale: [
    { key: 'first_case', label: '先从真实案例开始', effect: '首个可用单元直接连接订单列表索引案例，先形成一条完整证据链。' },
    { key: 'pace', label: '按每周 240 分钟安排', effect: '每周保留一次完整实验和一次复盘时间，避免只看概念。' },
    { key: 'transfer', label: '保留迁移空间', effect: '深分页、死锁和性能写作作为后续节点，等待前置实践完成后开放。' },
  ],
  confirmedPlanId: null, createdAt: '2026-09-06T08:55:00.000Z', updatedAt: DEMO_NOW,
}

let mockOnboardingState: ProductOnboardingState = { status: 'new', currentPlan: null, diagnosticSession: null, proposal: null }

const mockKnowledgeRoute: KnowledgeRoute = {
  id: 'demo-knowledge-route-001', roadmapNodeId: 'demo-node-order-index', status: 'ready',
  research: { provider: 'demo', query: 'MySQL 联合索引 ORDER BY EXPLAIN', generatedAt: DEMO_NOW },
  items: [
    { id: 'demo-source-1', sourceItemId: 'mysql-manual-explain', position: 1, role: 'foundation', reason: '先建立 EXPLAIN 的共同语言。', learningQuestion: 'key、rows 和 Extra 分别在说明什么？', source: { title: 'MySQL 8.4 Reference Manual · EXPLAIN', author: 'MySQL', url: 'https://dev.mysql.com/doc/refman/8.4/en/explain.html', excerpt: '用执行计划观察优化器选择的访问路径。', retrievedAt: DEMO_NOW } },
    { id: 'demo-source-2', sourceItemId: 'mysql-manual-index', position: 2, role: 'case', reason: '把联合索引的列顺序连接到订单列表查询。', learningQuestion: '过滤和排序同时存在时，索引列顺序如何验证？', source: { title: 'MySQL 8.4 Reference Manual · Multiple-Column Indexes', author: 'MySQL', url: 'https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html', excerpt: '联合索引的左前缀决定可用的访问范围。', retrievedAt: DEMO_NOW } },
    { id: 'demo-source-3', sourceItemId: 'demo-practice-note', position: 3, role: 'extension', reason: '用实践结果回看索引收益是否稳定。', learningQuestion: '为什么 rows 下降了，真实耗时却没有同步下降？', source: { title: '知行实践提示 · 前后对照', author: null, url: 'https://github.com/Nai1ve/Knowing-Doing', excerpt: '把执行计划、数据分布和真实耗时放在同一张证据表里。', retrievedAt: DEMO_NOW } },
  ],
}

export function getMockProductPlan(): ProductPlan {
  return clone(mockProductPlan)
}

export function createMockProductPlan(goal = DEFAULT_GOAL): ProductPlan {
  mockProductPlan = makeProductPlan(goal)
  return clone(mockProductPlan)
}

export function getMockOnboardingState(): ProductOnboardingState {
  return clone(mockOnboardingState)
}

export function createMockDiagnosticSession(goal = DEFAULT_GOAL): ProductDiagnosticSession {
  const next = clone(mockDiagnosticSession)
  next.goal = goal
  mockOnboardingState = { status: 'diagnostic_in_progress', currentPlan: null, diagnosticSession: { id: next.id, status: next.status, revision: next.revision, updatedAt: next.updatedAt }, proposal: null }
  return next
}

export function getMockDiagnosticSession(sessionId: string): ProductDiagnosticSession {
  const next = clone(mockDiagnosticSession)
  next.id = sessionId
  return next
}

export function saveMockDiagnosticSession(sessionId: string, input: { revision: number; goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }): ProductDiagnosticSession {
  const next = getMockDiagnosticSession(sessionId)
  next.goal = input.goal
  next.status = 'ready'
  next.revision = input.revision + 1
  next.updatedAt = DEMO_NOW
  next.evidence = [
    { id: 'demo-evidence-goal', learnerId: DEMO_LEARNER_ID, diagnosticSessionId: sessionId, evidenceKey: 'goal', sourceKind: 'user_input', content: input.goal, status: 'active', createdAt: DEMO_NOW, updatedAt: DEMO_NOW },
    { id: 'demo-evidence-experience', learnerId: DEMO_LEARNER_ID, diagnosticSessionId: sessionId, evidenceKey: 'experience', sourceKind: 'user_input', content: input.experience, status: 'active', createdAt: DEMO_NOW, updatedAt: DEMO_NOW },
  ]
  return next
}

export function getMockPlanProposal(proposalId: string): ProductPlanProposal {
  const next = clone(mockPlanProposal)
  next.id = proposalId
  return next
}

export function createMockPlanProposal(sessionId: string): ProductPlanProposal {
  const next = getMockPlanProposal('demo-plan-proposal-001')
  next.diagnosticSessionId = sessionId
  return next
}

export function confirmMockPlanProposal(): ProductPlan {
  const next = clone(mockProductPlan)
  mockOnboardingState = { status: 'has_plan', currentPlan: next, diagnosticSession: null, proposal: { id: mockPlanProposal.id, title: next.title, revision: 1, updatedAt: DEMO_NOW } }
  return next
}

export function getMockAgentPlanningSession(sessionId: string): AgentPlanningSession {
  const next = clone(mockAgentSession)
  next.id = sessionId
  return next
}

export function startMockAgentPlanningSession(goal: string): AgentPlanningSession {
  mockAgentSession = makeAgentSession(goal)
  return clone(mockAgentSession)
}

export function appendMockAgentPlanningMessage(sessionId: string, message: string): AgentPlanningSession {
  mockAgentSession.id = sessionId
  const sequence = mockAgentSession.messages.length + 1
  mockAgentSession.messages.push({ id: `demo-message-${sequence}`, sequence, role: 'user', content: message, metadata: { demo: true }, createdAt: DEMO_NOW })
  mockAgentSession.messages.push({ id: `demo-message-${sequence + 1}`, sequence: sequence + 1, role: 'assistant', content: '这个例子很适合继续拆成“现象—假设—证据—验证”四步。先记录查询条件和当前 EXPLAIN 结果，再决定要不要调整索引。', metadata: { demo: true }, createdAt: DEMO_NOW })
  mockAgentSession.revision += 1
  mockAgentSession.updatedAt = DEMO_NOW
  mockAgentSession.requiredTopics = mockAgentSession.requiredTopics.map((topic) => topic.key === 'responsibility' ? { ...topic, status: 'covered', evidenceRefs: [`demo-message-${sequence}`] } : topic)
  return clone(mockAgentSession)
}

export function createMockRoadmapGeneration(generationId = 'demo-roadmap-generation-001'): AgentRoadmapGeneration {
  return { id: generationId, status: 'succeeded', phase: 'completed', roadmapId: DEMO_ROADMAP_ID }
}

export function getMockPlanningSession(sessionId: string): PlanningSession {
  const next = clone(mockPlanningSession)
  next.id = sessionId
  return next
}

export function createMockPlanningSession(goal = DEFAULT_GOAL): PlanningSession {
  const next = getMockPlanningSession('demo-planning-session')
  next.goal = goal
  return next
}

export function getMockRoadmapDraft(roadmapId: string): RoadmapDraft {
  const next = clone(mockRoadmapDraft)
  next.id = roadmapId
  next.nodes = next.nodes.map((node) => ({ ...node, roadmapId }))
  return next
}

export function getMockCurrentRoadmap(): CurrentRoadmapResponse {
  const next = clone(mockCurrentRoadmap)
  if (next.roadmap) next.roadmap = { ...next.roadmap, progress: { ...mockRoadmapProgress } }
  next.currentPlan = clone(mockProductPlan)
  next.roots = mockRoadmapNodes.filter((node) => node.parentId === null).map((node) => ({ ...node }))
  return next
}

export function getMockRoadmapNodes(roadmapId: string, parentId: string | null): { roadmapId: string; parentId: string | null; depth: number; nodes: RoadmapNode[] } {
  return { roadmapId, parentId, depth: parentId ? 1 : 0, nodes: mockRoadmapNodes.filter((node) => node.parentId === parentId).map((node) => ({ ...node, roadmapId })) }
}

export function completeMockRoadmapNode(roadmapId: string, nodeId: string, status: 'completed' | 'self_reported' = 'completed'): RoadmapNode {
  const source = mockRoadmapNodes.find((node) => node.id === nodeId) ?? mockRoadmapNodes[0]
  const next = { ...source, roadmapId, status, progressRevision: source.progressRevision + 1, completedAt: DEMO_NOW, verifiedAt: status === 'completed' ? DEMO_NOW : null }
  return clone(next)
}

export function getMockKnowledgeRoute(roadmapNodeId: string): KnowledgeRoute {
  const next = clone(mockKnowledgeRoute)
  next.roadmapNodeId = roadmapNodeId
  return next
}

export function createMockResume(sessionId: string, file: { name: string; size: number; type: string }): ProductResumeAttachment {
  return { id: `demo-resume-${sessionId}`, learnerId: DEMO_LEARNER_ID, planningSessionId: sessionId, originalFilename: file.name, mimeType: 'application/pdf', sizeBytes: file.size, sha256: 'demo-sha256', parseStatus: 'ready', pageCount: 1, textLength: 680, parseError: null, createdAt: DEMO_NOW, updatedAt: DEMO_NOW }
}

export async function streamMockPlanning(goal: string, sessionId: string, message: string, onEvent: (event: import('@/types/product').PlanningStreamEvent) => void): Promise<void> {
  const invocationId = `demo-invocation-${Date.now()}`
  onEvent({ type: 'accepted', invocationId, sessionId })
  const session = message ? appendMockAgentPlanningMessage(sessionId, message) : startMockAgentPlanningSession(goal || DEFAULT_GOAL)
  const assistant = session.messages.at(-1)?.role === 'assistant' ? session.messages.at(-1)?.content ?? '' : '我已经记录这个方向。'
  onEvent({ type: 'assistant_delta', invocationId, delta: assistant })
  onEvent({ type: 'profile_updated', invocationId, profileSnapshotId: session.profile?.id ?? 'demo-profile-001', coveredTopics: session.requiredTopics.filter((topic) => topic.status === 'covered').map((topic) => topic.key), pendingTopics: session.requiredTopics.filter((topic) => topic.status !== 'covered').map((topic) => topic.key), dimensions: session.profile?.dimensions ?? [] })
  onEvent({ type: 'next_question', invocationId, question: '你可以补充一个最近遇到的慢查询例子，也可以直接生成路线。', topicKey: 'projects', canGenerateRoadmap: true })
  onEvent({ type: 'completed', invocationId, session })
}

export { DEFAULT_GOAL, DEMO_ROADMAP_ID }
