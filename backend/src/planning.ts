import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import type { Readable } from 'node:stream'
import type Database from 'better-sqlite3'
import { LabError } from './errors.js'
import { parseResumePdf, ResumeParseError } from './resume-parser.js'
import type { LearningPlan, ResumeAttachment } from './product-types.js'
import type {
  PlanningSession, PlanningTemplateKey, PlanningTurn, Roadmap, RoadmapDraft, RoadmapNode, RoadmapNodePage, RoadmapNodeStatus,
} from './planning-types.js'
import { ProductRepository } from './product-repository.js'

type Row = Record<string, unknown>

const TEMPLATE_KEY: PlanningTemplateKey = 'senior-backend-ai-v1'
const STEPS = [
  { key: 'goal', prompt: '你希望通过这条路线获得什么能力？', options: [] },
  { key: 'experience', prompt: '你目前在哪些后端或 AI 应用工作上有过实际经验？', options: ['做过后端服务', '做过业务系统但经验不完整', '刚开始接触'] },
  { key: 'priority_domain', prompt: '接下来最想优先加强哪个能力域？', options: ['后端系统能力', 'AI 应用工程', '综合交付能力'] },
  { key: 'weekly_minutes', prompt: '你每周大约可以投入多少时间？', options: ['少于 2 小时', '2 到 4 小时', '4 小时以上'] },
  { key: 'outcome', prompt: '完成这条路线后，你希望留下什么可回看的产出？', options: ['一组真实问题复盘', '一个可运行项目', '能独立设计并交付系统'] },
  { key: 'summary', prompt: '请确认：这条路线会从你选择的优先方向开始，逐步连接后端、AI 和交付能力。', options: ['确认路线草案'] },
] as const

interface TemplateNode {
  key: string
  parentKey: string | null
  type: RoadmapNode['nodeType']
  title: string
  summary: string
  points: string[]
  standard: string
  minutes: number
  priority: number
  mode: RoadmapNode['learningMode']
  caseId?: string
}

const TEMPLATE_NODES: TemplateNode[] = [
  { key: 'backend-system', parentKey: null, type: 'domain', title: '后端系统能力', summary: '把业务问题转成可运行、可观测、可演进的服务。', points: ['服务边界', '数据流', '运行反馈'], standard: '能解释一个服务的边界、关键数据流和主要运行风险。', minutes: 120, priority: 1, mode: 'knowledge' },
  { key: 'service-design', parentKey: 'backend-system', type: 'capability', title: '服务设计', summary: '从接口、边界和数据流开始组织服务。', points: ['接口契约', '领域边界', '演进方式'], standard: '能为一个真实需求写出服务边界和接口契约。', minutes: 180, priority: 1, mode: 'knowledge' },
  { key: 'api-boundaries', parentKey: 'service-design', type: 'concept', title: '接口与服务边界', summary: '理解接口设计如何影响协作、演进和故障定位。', points: ['输入输出', '兼容性', '错误边界'], standard: '能用一个具体接口说明输入、输出、错误和兼容策略。', minutes: 90, priority: 1, mode: 'knowledge' },
  { key: 'data-performance', parentKey: 'backend-system', type: 'capability', title: '数据与性能', summary: '从现象、证据和验证中理解数据访问的真实代价。', points: ['执行计划', '索引设计', '数据分布'], standard: '能说明一次数据访问变慢的现象、原因、尝试和验证。', minutes: 240, priority: 1, mode: 'knowledge' },
  { key: 'mysql-slow-query', parentKey: 'data-performance', type: 'lab', title: 'MySQL 慢查询与索引', summary: '在真实 Lab 中从慢日志定位 SQL，并用 EXPLAIN 和索引验证判断。', points: ['慢日志', 'EXPLAIN', '联合索引'], standard: '完成一次 MySQL 慢查询排查，并用前后执行计划或结果验证结论。', minutes: 120, priority: 1, mode: 'lab', caseId: 'mysql-order-list-index-001' },
  { key: 'index-fundamentals', parentKey: 'data-performance', type: 'concept', title: '索引与数据分布', summary: '理解什么时候建立索引、联合索引如何匹配以及索引为什么失效。', points: ['选择性', '最左匹配', '隐式转换'], standard: '能根据查询条件解释索引选择和常见失效原因。', minutes: 120, priority: 2, mode: 'knowledge' },
  { key: 'cache-async', parentKey: 'backend-system', type: 'capability', title: '缓存与异步', summary: '处理缓存一致性、消息传递和异步流程的边界。', points: ['一致性', '重试', '幂等'], standard: '能画出一次缓存或异步链路，并指出一致性和重复执行风险。', minutes: 180, priority: 2, mode: 'knowledge' },
  { key: 'cache-consistency', parentKey: 'cache-async', type: 'concept', title: '缓存一致性与幂等', summary: '理解缓存更新、失效和重复消息之间的关系。', points: ['失效策略', '幂等键', '补偿'], standard: '能为一次缓存更新设计可重试且可验证的流程。', minutes: 120, priority: 2, mode: 'knowledge' },
  { key: 'stability-observability', parentKey: 'backend-system', type: 'capability', title: '稳定性与可观测性', summary: '让系统的异常可以被发现、解释和复盘。', points: ['指标', '日志', '追踪'], standard: '能为关键链路选择信号，并说明异常发生后的定位路径。', minutes: 180, priority: 3, mode: 'knowledge' },
  { key: 'ai-application', parentKey: null, type: 'domain', title: 'AI 应用工程', summary: '把模型能力组织成可调用、可评估、可交付的应用。', points: ['模型接入', '工具工作流', '可靠性'], standard: '能说明一个 AI 功能的输入、模型行为、工具边界和评估方式。', minutes: 120, priority: 2, mode: 'knowledge' },
  { key: 'model-structured', parentKey: 'ai-application', type: 'capability', title: '模型接入与结构化输出', summary: '处理模型调用、上下文和稳定输出。', points: ['Prompt', 'Schema', '流式响应'], standard: '能设计一个结构化模型接口并处理失败与重试。', minutes: 180, priority: 1, mode: 'knowledge' },
  { key: 'structured-output', parentKey: 'model-structured', type: 'concept', title: '结构化输出与上下文', summary: '理解上下文组织、结构化结果和模型失败的处理边界。', points: ['上下文', 'Schema', '错误处理'], standard: '能把自然语言需求转成可校验的结构化模型输出。', minutes: 120, priority: 1, mode: 'knowledge' },
  { key: 'rag', parentKey: 'ai-application', type: 'capability', title: 'RAG 与知识检索', summary: '让模型按需读取资料并保持来源关系。', points: ['切分', '检索', '引用'], standard: '能解释一次检索增强回答的数据流和来源边界。', minutes: 180, priority: 2, mode: 'knowledge' },
  { key: 'retrieval-context', parentKey: 'rag', type: 'concept', title: '检索上下文组织', summary: '理解什么资料应该被召回、如何组织和回查。', points: ['召回范围', '上下文预算', '来源回查'], standard: '能为一个问题定义检索范围、上下文格式和回查方式。', minutes: 120, priority: 2, mode: 'knowledge' },
  { key: 'tools-workflows', parentKey: 'ai-application', type: 'capability', title: '工具调用与工作流', summary: '把模型决定和真实系统动作连接起来。', points: ['工具契约', '状态机', '权限'], standard: '能定义工具参数、执行状态和用户可见的过程。', minutes: 180, priority: 3, mode: 'knowledge' },
  { key: 'tool-boundaries', parentKey: 'tools-workflows', type: 'concept', title: '工具边界与流程状态', summary: '区分模型建议、系统执行和用户确认。', points: ['权限', '状态', '审计'], standard: '能为一次工具调用明确权限、状态和审计记录。', minutes: 120, priority: 3, mode: 'knowledge' },
  { key: 'evaluation-reliability', parentKey: 'ai-application', type: 'capability', title: '评测与可靠性', summary: '用可重复的标准观察 AI 功能是否真的有效。', points: ['样本', '指标', '回归'], standard: '能为一个 AI 功能设计最小评测集和回归检查。', minutes: 180, priority: 4, mode: 'knowledge' },
  { key: 'delivery', parentKey: null, type: 'domain', title: '综合交付能力', summary: '把服务和 AI 能力放进真实的系统约束中交付。', points: ['集成', '部署', '安全'], standard: '能从需求到运行完成一次可回看的系统交付。', minutes: 120, priority: 3, mode: 'knowledge' },
  { key: 'system-integration', parentKey: 'delivery', type: 'capability', title: '系统集成', summary: '连接业务系统、数据服务和 AI 能力。', points: ['边界', '依赖', '回滚'], standard: '能说明集成链路的依赖、失败和回滚策略。', minutes: 180, priority: 1, mode: 'knowledge' },
  { key: 'deployment-cost', parentKey: 'delivery', type: 'capability', title: '部署与成本', summary: '理解部署方式、资源使用和成本约束。', points: ['环境', '容量', '成本'], standard: '能为一个系统选择部署方式并解释主要成本。', minutes: 180, priority: 2, mode: 'knowledge' },
  { key: 'security', parentKey: 'delivery', type: 'capability', title: '安全', summary: '建立输入、权限、数据和审计的边界。', points: ['身份', '权限', '数据'], standard: '能指出系统中的敏感数据、权限边界和审计点。', minutes: 180, priority: 3, mode: 'knowledge' },
  { key: 'capstone', parentKey: 'delivery', type: 'project', title: '后端 + AI 综合项目', summary: '把一个真实需求做成可解释、可运行、可复盘的项目。', points: ['设计', '实现', '交付'], standard: '完成一个包含后端服务和 AI 能力的可回看项目。', minutes: 480, priority: 4, mode: 'knowledge' },
]

function str(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function num(row: Row, key: string): number { return Number(row[key]) }
function parsed<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function hash(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex') }

function nodeFrom(row: Row): RoadmapNode {
  return {
    id: str(row, 'id'), roadmapId: str(row, 'roadmap_id'), parentId: nullable(row, 'parent_id'), nodeKey: str(row, 'node_key'), nodeType: str(row, 'node_type') as RoadmapNode['nodeType'], title: str(row, 'title'), summary: str(row, 'summary'),
    knowledgeCard: parsed(row.knowledge_card_json, {}), completionStandard: str(row, 'completion_standard'), estimatedMinutes: num(row, 'estimated_minutes'), priority: num(row, 'priority'), position: num(row, 'position'), learningMode: str(row, 'learning_mode') as RoadmapNode['learningMode'], caseId: nullable(row, 'case_id'),
    status: str(row, 'progress_status') as RoadmapNodeStatus, progressSource: str(row, 'progress_source'), completedAt: nullable(row, 'completed_at'), verifiedAt: nullable(row, 'verified_at'), progressRevision: num(row, 'progress_revision'), childCount: num(row, 'child_count'),
  }
}

function roadmapFrom(row: Row, progress: Roadmap['progress']): Roadmap {
  return { id: str(row, 'id'), learnerId: str(row, 'learner_id'), templateKey: str(row, 'template_key') as PlanningTemplateKey, goal: str(row, 'goal'), status: str(row, 'status') as Roadmap['status'], revision: num(row, 'revision'), inputSnapshot: parsed(row.input_snapshot_json, {}), createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at'), progress }
}

export class PlanningService {
  private readonly resumeStoragePath: string
  private readonly resumeMaxBytes: number

  constructor(private readonly repository: ProductRepository, options: { resumeStoragePath?: string; resumeMaxBytes?: number } = {}) {
    this.resumeStoragePath = options.resumeStoragePath ?? path.resolve(process.cwd(), 'data/resumes')
    this.resumeMaxBytes = options.resumeMaxBytes ?? 10 * 1024 * 1024
  }

  private get db(): Database.Database { return this.repository.db }

  private assertLearner(learnerId: string): void { this.repository.ensureLearner(learnerId) }

  async uploadResume(learnerId: string, sessionId: string, input: { filename: string; mimetype: string; file: Readable }): Promise<ResumeAttachment> {
    this.sessionRow(sessionId, learnerId)
    const filename = path.basename(input.filename).trim()
    if (!filename.toLowerCase().endsWith('.pdf')) throw new LabError('resume_pdf_only', '简历只支持 PDF 文件', 422)
    if (input.mimetype && input.mimetype !== 'application/pdf') throw new LabError('resume_pdf_only', '简历只支持 PDF 文件', 422)

    await mkdir(this.resumeStoragePath, { recursive: true })
    const id = randomUUID()
    const temporaryPath = path.join(this.resumeStoragePath, `${id}.uploading`)
    const storedFilename = `${id}.pdf`
    const storedPath = path.join(this.resumeStoragePath, storedFilename)
    const output = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
    const hash = createHash('sha256')
    let header = Buffer.alloc(0)
    let sizeBytes = 0

    try {
      for await (const chunk of input.file) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        sizeBytes += buffer.byteLength
        if (sizeBytes > this.resumeMaxBytes) throw new LabError('resume_too_large', `简历不能超过 ${Math.floor(this.resumeMaxBytes / 1024 / 1024)} MB`, 422)
        if (header.length < 5) header = Buffer.concat([header, buffer]).subarray(0, 5)
        hash.update(buffer)
        if (!output.write(buffer)) await once(output, 'drain')
      }
      await new Promise<void>((resolve, reject) => {
        output.once('error', reject)
        output.once('finish', resolve)
        output.end()
      })
      if (header.toString('ascii') !== '%PDF-') throw new LabError('resume_pdf_only', '文件内容不是有效的 PDF', 422)
      let parsed: Awaited<ReturnType<typeof parseResumePdf>>
      try {
        parsed = await parseResumePdf(await readFile(temporaryPath))
      } catch (error) {
        if (error instanceof ResumeParseError) throw new LabError('resume_parse_failed', error.message, 422)
        throw error
      }
      await rename(temporaryPath, storedPath)
      const saved = this.repository.replacePlanningResumeAttachment({ id, learnerId, planningSessionId: sessionId, originalFilename: filename, storedFilename, sizeBytes, sha256: hash.digest('hex'), pageCount: parsed.pageCount, extractedText: parsed.text })
      if (saved.previousStoredFilename) await unlink(path.join(this.resumeStoragePath, saved.previousStoredFilename)).catch(() => undefined)
      return saved.attachment
    } catch (error) {
      output.destroy()
      await Promise.all([rm(temporaryPath, { force: true }), rm(storedPath, { force: true })])
      throw error
    }
  }

  private sessionRow(id: string, learnerId: string): Row {
    const row = this.db.prepare('SELECT * FROM planning_sessions WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('planning_not_found', '规划对话不存在', 404)
    return row
  }

  private roadmapRow(id: string, learnerId: string): Row {
    const row = this.db.prepare('SELECT * FROM learning_roadmaps WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('roadmap_not_found', '路线图不存在', 404)
    return row
  }

  private progress(roadmapId: string): Roadmap['progress'] {
    const row = this.db.prepare("SELECT COUNT(*) AS total, SUM(status IN ('completed','verified')) AS completed, SUM(status = 'verified') AS verified, SUM(status = 'available') AS available FROM roadmap_node_progress WHERE roadmap_id = ?").get(roadmapId) as Row
    return { total: num(row, 'total'), completed: num(row, 'completed'), verified: num(row, 'verified'), available: num(row, 'available') }
  }

  private sessionFrom(row: Row): PlanningSession {
    const id = str(row, 'id'); const turns = (this.db.prepare('SELECT * FROM planning_session_turns WHERE session_id = ? ORDER BY sequence ASC').all(id) as Row[]).map((turn) => ({ id: str(turn, 'id'), sequence: num(turn, 'sequence'), stepKey: str(turn, 'step_key'), prompt: str(turn, 'prompt'), answer: str(turn, 'answer'), structuredValue: parsed(turn.structured_json, null), createdAt: str(turn, 'created_at') } as PlanningTurn))
    const next = num(row, 'current_step') < STEPS.length ? STEPS[num(row, 'current_step')] : null
    const draft = this.db.prepare("SELECT id FROM learning_roadmaps WHERE learner_id = ? AND status = 'draft' AND json_extract(input_snapshot_json, '$.sessionId') = ? ORDER BY updated_at DESC LIMIT 1").get(str(row, 'learner_id'), id) as Row | undefined
    const learnerId = str(row, 'learner_id')
    return { id, learnerId, templateKey: str(row, 'template_key') as PlanningTemplateKey, goal: str(row, 'goal'), status: str(row, 'status') as PlanningSession['status'], currentStep: num(row, 'current_step'), revision: num(row, 'revision'), answers: parsed(row.answers_json, {}), turns, nextQuestion: next ? { key: next.key, prompt: next.prompt, options: [...next.options] } : null, draftRoadmapId: draft ? str(draft, 'id') : null, resume: this.repository.getPlanningResumeAttachment(id, learnerId), createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') }
  }

  createSession(learnerId: string, input: { goal?: string; clientRequestId?: string | null }): PlanningSession {
    this.assertLearner(learnerId); const goal = input.goal?.trim() || '成为高级后端 + AI 应用工程师'; const now = new Date().toISOString(); const id = randomUUID()
    if (input.clientRequestId) {
      const existing = this.db.prepare('SELECT * FROM planning_sessions WHERE learner_id = ? AND client_request_id = ?').get(learnerId, input.clientRequestId) as Row | undefined
      if (existing) return this.sessionFrom(existing)
    }
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO planning_sessions(id, learner_id, template_key, goal, status, current_step, answers_json, revision, client_request_id, created_at, updated_at) VALUES (?, ?, ?, ?, \'draft\', 1, ?, 1, ?, ?, ?)').run(id, learnerId, TEMPLATE_KEY, goal, JSON.stringify({ goal }), input.clientRequestId ?? null, now, now)
      this.db.prepare('INSERT INTO planning_session_turns(id, session_id, sequence, step_key, prompt, answer, structured_json, created_at) VALUES (?, ?, 1, \'goal\', ?, ?, ?, ?)').run(randomUUID(), id, STEPS[0].prompt, goal, JSON.stringify({ goal }), now)
    })
    try { tx() } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE') && input.clientRequestId) { const existing = this.db.prepare('SELECT * FROM planning_sessions WHERE learner_id = ? AND client_request_id = ?').get(learnerId, input.clientRequestId) as Row; return this.sessionFrom(existing) }
      throw error
    }
    return this.sessionFrom(this.sessionRow(id, learnerId))
  }

  getSession(learnerId: string, id: string): PlanningSession { return this.sessionFrom(this.sessionRow(id, learnerId)) }

  addTurn(learnerId: string, id: string, input: { revision: number; stepKey: string; answer: string; structuredValue?: unknown }): PlanningSession & { roadmapDraftId: string | null } {
    const current = this.sessionRow(id, learnerId); const step = STEPS[num(current, 'current_step')]
    if (!step || step.key !== input.stepKey) throw new LabError('planning_step_conflict', '请按当前问题继续规划', 409)
    if (num(current, 'revision') !== input.revision) throw new LabError('planning_revision_conflict', '规划内容已更新，请刷新后继续', 409)
    if (!input.answer.trim()) throw new LabError('invalid_request', '回答不能为空', 400)
    const answers = parsed<Record<string, unknown>>(current.answers_json, {}); answers[step.key] = input.structuredValue ?? input.answer.trim(); const now = new Date().toISOString(); const nextStep = num(current, 'current_step') + 1; const status = nextStep >= STEPS.length ? 'ready' : 'draft'
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO planning_session_turns(id, session_id, sequence, step_key, prompt, answer, structured_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), id, nextStep, step.key, step.prompt, input.answer.trim(), JSON.stringify(input.structuredValue ?? input.answer.trim()), now)
      this.db.prepare('UPDATE planning_sessions SET status = ?, current_step = ?, answers_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND revision = ?').run(status, nextStep, JSON.stringify(answers), now, id, learnerId, input.revision)
      if (status === 'ready') {
        const activeRoadmap = this.db.prepare("SELECT id FROM learning_roadmaps WHERE learner_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1").get(learnerId) as Row | undefined
        this.createRoadmapDraftInTransaction({ learnerId, sessionId: id, goal: str(current, 'goal'), answers, basedOnRoadmapId: activeRoadmap ? str(activeRoadmap, 'id') : null })
      }
    })
    tx()
    const session = this.sessionFrom(this.sessionRow(id, learnerId)); return { ...session, roadmapDraftId: session.draftRoadmapId }
  }

  private createRoadmapDraftInTransaction(input: { learnerId: string; sessionId: string; goal: string; answers: Record<string, unknown>; basedOnRoadmapId: string | null }): RoadmapDraft {
    const snapshot = { sessionId: input.sessionId, ...input.answers }; const inputHash = hash(snapshot); const existing = this.db.prepare("SELECT * FROM learning_roadmaps WHERE learner_id = ? AND status = 'draft' AND input_snapshot_json = ?").get(input.learnerId, JSON.stringify(snapshot)) as Row | undefined
    if (existing) return this.getDraft(input.learnerId, str(existing, 'id'))
    const roadmapId = randomUUID(); const now = new Date().toISOString()
    this.db.prepare('INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, based_on_roadmap_id, created_at, updated_at) VALUES (?, ?, ?, ?, \'draft\', 1, ?, ?, ?, ?)').run(roadmapId, input.learnerId, TEMPLATE_KEY, input.goal, JSON.stringify(snapshot), input.basedOnRoadmapId, now, now)
    const ids = new Map<string, string>(); const insert = this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const ordered = [...TEMPLATE_NODES].sort((a, b) => (a.parentKey ? 1 : 0) - (b.parentKey ? 1 : 0))
    ordered.forEach((node) => { const nodeId = randomUUID(); ids.set(node.key, nodeId); insert.run(nodeId, roadmapId, node.parentKey ? ids.get(node.parentKey) ?? null : null, node.key, node.type, node.title, node.summary, JSON.stringify({ keyPoints: node.points }), node.standard, node.minutes, node.priority, TEMPLATE_NODES.indexOf(node) + 1, node.mode, node.caseId ?? null, now) })
    const preferred = String(input.answers.priority_domain ?? '后端系统能力'); const preferredRoot = preferred.includes('AI') ? 'ai-application' : preferred.includes('交付') ? 'delivery' : 'backend-system'; const preferredCapability = preferredRoot === 'backend-system' ? 'data-performance' : preferredRoot === 'ai-application' ? 'model-structured' : 'system-integration';
    const progress = this.db.prepare('INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?)')
    const mastered = Array.isArray(input.answers.mastered_node_keys) ? input.answers.mastered_node_keys.filter((key): key is string => typeof key === 'string') : []
    for (const node of TEMPLATE_NODES) {
      const available: RoadmapNodeStatus = node.parentKey === null || node.key === preferredCapability || node.parentKey === preferredCapability ? 'available' : 'locked'
      const status: RoadmapNodeStatus = mastered.includes(node.key) && available !== 'locked' ? 'self_reported' : available
      progress.run(roadmapId, ids.get(node.key), status, status === 'self_reported' ? 'user' : 'rule', status === 'self_reported' ? now : null, now)
    }
    this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, \'roadmap_generated\', ?, ?)').run(randomUUID(), input.learnerId, roadmapId, JSON.stringify({ inputHash, sessionId: input.sessionId }), now)
    return this.getDraft(input.learnerId, roadmapId)
  }

  private getDraft(learnerId: string, id: string): RoadmapDraft {
    const row = this.roadmapRow(id, learnerId); if (str(row, 'status') !== 'draft') throw new LabError('roadmap_not_draft', '当前路线图已经确认或失效', 409)
    const snapshot = parsed<Record<string, unknown>>(row.input_snapshot_json, {}); const sessionId = String(snapshot.sessionId ?? ''); const session = sessionId ? this.sessionRow(sessionId, learnerId) : null
    return { ...this.getRoadmap(learnerId, id), planningSessionId: sessionId, planningSessionRevision: session ? num(session, 'revision') : 1, diff: [], nodes: this.listNodes(learnerId, id, null, 99).nodes }
  }

  getDraftBySession(learnerId: string, sessionId: string): RoadmapDraft | null {
    const row = this.db.prepare("SELECT id FROM learning_roadmaps WHERE learner_id = ? AND status = 'draft' AND json_extract(input_snapshot_json, '$.sessionId') = ? ORDER BY updated_at DESC LIMIT 1").get(learnerId, sessionId) as Row | undefined
    return row ? this.getDraft(learnerId, str(row, 'id')) : null
  }

  getDraftForLearner(learnerId: string, id: string): RoadmapDraft {
    const draft = this.getDraft(learnerId, id); const row = this.roadmapRow(id, learnerId); const baseId = nullable(row, 'based_on_roadmap_id'); const current = parsed<Record<string, unknown>>(row.input_snapshot_json, {}); const base = baseId ? this.roadmapRow(baseId, learnerId) : null; const before = base ? parsed<Record<string, unknown>>(base.input_snapshot_json, {}) : {}
    const keys = ['weekly_minutes', 'priority_domain', 'mastered_node_keys']; const labels: Record<string, string> = { weekly_minutes: '每周投入', priority_domain: '优先能力域', mastered_node_keys: '已掌握节点' }
    draft.diff = keys.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(current[key] ?? null)).map((key) => ({ key, label: labels[key], before: before[key] == null ? null : String(before[key]), after: String(current[key] ?? '') }))
    return draft
  }

  adjust(learnerId: string, sessionId: string, input: { revision: number; weeklyMinutes?: number; priorityDomain?: string; masteredNodeKeys?: string[] }): RoadmapDraft {
    const session = this.sessionRow(sessionId, learnerId); if (num(session, 'revision') !== input.revision) throw new LabError('planning_revision_conflict', '规划内容已更新，请刷新后继续', 409)
    const existing = this.getDraftBySession(learnerId, sessionId); if (!existing) throw new LabError('roadmap_not_found', '请先完成规划对话', 409)
    const answers = parsed<Record<string, unknown>>(session.answers_json, {}); if (input.weeklyMinutes != null) answers.weekly_minutes = input.weeklyMinutes; if (input.priorityDomain) answers.priority_domain = input.priorityDomain; if (input.masteredNodeKeys) answers.mastered_node_keys = input.masteredNodeKeys
    const now = new Date().toISOString(); const tx = this.db.transaction(() => { this.db.prepare("UPDATE learning_roadmaps SET status = 'superseded', updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'draft'").run(now, existing.id, learnerId); const changed = this.db.prepare('UPDATE planning_sessions SET answers_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND revision = ?').run(JSON.stringify(answers), now, sessionId, learnerId, input.revision); if (changed.changes === 0) throw new LabError('planning_revision_conflict', '规划内容已更新，请刷新后继续', 409); this.createRoadmapDraftInTransaction({ learnerId, sessionId, goal: str(session, 'goal'), answers, basedOnRoadmapId: existing.id }) }); tx()
    const next = this.getDraftBySession(learnerId, sessionId); if (!next) throw new LabError('roadmap_not_found', '路线草案生成失败', 500); return this.getDraftForLearner(learnerId, next.id)
  }

  confirm(learnerId: string, id: string, revision: number): LearningPlan {
    const draft = this.roadmapRow(id, learnerId); if (str(draft, 'status') === 'active') return this.repository.getActivePlan(learnerId) as LearningPlan; if (str(draft, 'status') !== 'draft') throw new LabError('roadmap_not_draft', '路线草案已经失效', 409); if (num(draft, 'revision') !== revision) throw new LabError('roadmap_revision_conflict', '路线草案已更新，请刷新后确认', 409)
    const sessionId = String(parsed<Record<string, unknown>>(draft.input_snapshot_json, {}).sessionId ?? ''); const session = this.sessionRow(sessionId, learnerId); const answers = parsed<Record<string, unknown>>(draft.input_snapshot_json, {}); const planId = randomUUID(); const intakeId = randomUUID(); const now = new Date().toISOString()
    let idempotentPlanId: string | null = null
    const tx = this.db.transaction(() => {
      const latestDraft = this.db.prepare('SELECT status, revision FROM learning_roadmaps WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
      if (!latestDraft) throw new LabError('roadmap_not_found', '路线图不存在', 404)
      if (str(latestDraft, 'status') !== 'draft') {
        const confirmed = this.db.prepare("SELECT id FROM learning_plans WHERE roadmap_id = ? AND learner_id = ? AND status IN ('confirmed', 'active', 'pending_content') LIMIT 1").get(id, learnerId) as Row | undefined
        if (confirmed) { idempotentPlanId = str(confirmed, 'id'); return }
        throw new LabError('roadmap_not_draft', '路线草案已经失效', 409)
      }
      if (num(latestDraft, 'revision') !== revision) throw new LabError('roadmap_revision_conflict', '路线草案已更新，请刷新后确认', 409)
      const current = this.db.prepare("SELECT id, roadmap_id FROM learning_plans WHERE learner_id = ? AND status IN ('confirmed', 'active', 'pending_content') ORDER BY updated_at DESC LIMIT 1").get(learnerId) as Row | undefined
      if (current) { this.db.prepare("UPDATE learning_plans SET status = 'superseded', updated_at = ? WHERE id = ?").run(now, str(current, 'id')); this.db.prepare("INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, 'plan_superseded', ?, ?)").run(randomUUID(), learnerId, str(current, 'id'), JSON.stringify({ reason: 'roadmap_confirmed', roadmapId: id }), now); if (current.roadmap_id) this.db.prepare("UPDATE learning_roadmaps SET status = 'archived', updated_at = ? WHERE id = ?").run(now, str(current, 'roadmap_id')) }
      const activated = this.db.prepare("UPDATE learning_roadmaps SET status = 'active', revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'draft' AND revision = ?").run(now, id, learnerId, revision); if (activated.changes === 0) throw new LabError('roadmap_revision_conflict', '路线草案已更新，请刷新后确认', 409)
      this.db.prepare('INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'planned\', ?, ?)').run(intakeId, learnerId, str(draft, 'goal'), '后端 + AI 应用工程', typeof answers.outcome === 'string' ? answers.outcome : null, typeof answers.weekly_minutes === 'number' ? answers.weekly_minutes : null, now, now)
      this.db.prepare("INSERT INTO learning_plans(id, learner_id, intake_id, roadmap_id, title, goal, source_status, status, plan_state, template_key, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'local_catalog', 'active', 'active', ?, 1, ?, ?)").run(planId, learnerId, intakeId, id, '高级后端 + AI 应用工程师路线', str(draft, 'goal'), TEMPLATE_KEY, now, now)
      const leafRows = this.db.prepare("SELECT n.*, p.status AS progress_status FROM roadmap_nodes n INNER JOIN roadmap_node_progress p ON p.node_id = n.id AND p.roadmap_id = n.roadmap_id WHERE n.roadmap_id = ? AND n.node_type IN ('concept', 'lab', 'project') ORDER BY CASE WHEN n.case_id IS NOT NULL THEN 0 ELSE 1 END, n.priority, n.position LIMIT 4").all(id) as Row[]
      const insertUnit = this.db.prepare('INSERT INTO plan_units(id, plan_id, roadmap_node_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, \'[]\')')
      leafRows.forEach((node, index) => insertUnit.run(randomUUID(), planId, str(node, 'id'), index + 1, str(node, 'title'), str(node, 'summary'), nullable(node, 'case_id'), index === 0 ? 'current' : 'upcoming', nullable(node, 'case_id') ? 'available' : 'available', nullable(node, 'case_id') ? 'lab' : 'unavailable', num(node, 'estimated_minutes'), '从路线图中按优先级切出当前学习单元。'))
      this.db.prepare("UPDATE planning_sessions SET status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ?").run(now, sessionId, learnerId)
      this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, \'roadmap_confirmed\', ?, ?)').run(randomUUID(), learnerId, id, JSON.stringify({ planId, previousPlan: current?.id ?? null }), now)
      this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, \'plan_created\', ?, ?)').run(randomUUID(), learnerId, planId, JSON.stringify({ templateKey: TEMPLATE_KEY, roadmapId: id }), now)
    })
    try { tx() } catch (error) { if (error instanceof Error && error.message.includes('UNIQUE')) { const active = this.repository.getActivePlan(learnerId); if (active) return active }; throw error }
    if (idempotentPlanId) return this.repository.getPlanForLearner(idempotentPlanId, learnerId)
    return this.repository.getPlanForLearner(planId, learnerId)
  }

  getRoadmap(learnerId: string, id: string): Roadmap {
    const row = this.roadmapRow(id, learnerId); return roadmapFrom(row, this.progress(id))
  }

  private ensureLegacyRoadmap(learnerId: string, plan: LearningPlan): void {
    const roadmapId = randomUUID(); const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, based_on_roadmap_id, created_at, updated_at) VALUES (?, ?, ?, ?, \'active\', 1, ?, NULL, ?, ?)').run(roadmapId, learnerId, TEMPLATE_KEY, plan.goal, JSON.stringify({ legacyPlanId: plan.id, goal: plan.goal }), now, now)
      const ids = new Map<string, string>(); const insert = this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const ordered = [...TEMPLATE_NODES].sort((a, b) => (a.parentKey ? 1 : 0) - (b.parentKey ? 1 : 0))
      ordered.forEach((node) => { const nodeId = randomUUID(); ids.set(node.key, nodeId); insert.run(nodeId, roadmapId, node.parentKey ? ids.get(node.parentKey) ?? null : null, node.key, node.type, node.title, node.summary, JSON.stringify({ keyPoints: node.points }), node.standard, node.minutes, node.priority, TEMPLATE_NODES.indexOf(node) + 1, node.mode, node.caseId ?? null, now) })
      const progress = this.db.prepare('INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      for (const node of TEMPLATE_NODES) {
        const linked = plan.units.find((unit) => unit.caseId === node.caseId); const status: RoadmapNodeStatus = linked?.status === 'completed' ? 'verified' : node.parentKey === null || node.key === 'data-performance' || node.parentKey === 'data-performance' ? 'available' : 'locked'
        progress.run(roadmapId, ids.get(node.key), status, linked?.status === 'completed' ? 'legacy_lab' : 'rule', linked?.status === 'completed' ? now : null, linked?.status === 'completed' ? now : null, now)
      }
      this.db.prepare('UPDATE learning_plans SET roadmap_id = ?, updated_at = ? WHERE id = ? AND learner_id = ? AND roadmap_id IS NULL').run(roadmapId, now, plan.id, learnerId)
      const updateUnit = this.db.prepare('UPDATE plan_units SET roadmap_node_id = ? WHERE id = ? AND plan_id = ?')
      for (const unit of plan.units) { const linked = TEMPLATE_NODES.find((node) => node.caseId === unit.caseId); if (linked) updateUnit.run(ids.get(linked.key), unit.id, plan.id) }
      this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, \'roadmap_migrated\', ?, ?)').run(randomUUID(), learnerId, roadmapId, JSON.stringify({ legacyPlanId: plan.id }), now)
    })
    try { tx() } catch (error) { if (!(error instanceof Error) || !error.message.includes('UNIQUE')) throw error }
  }

  current(learnerId: string): { roadmap: Roadmap | null; roots: RoadmapNode[]; currentPlan: LearningPlan | null } {
    const plan = this.repository.getActivePlan(learnerId); let row = this.db.prepare("SELECT * FROM learning_roadmaps WHERE learner_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1").get(learnerId) as Row | undefined
    if (!row && plan) {
      const roadmapRef = this.db.prepare('SELECT roadmap_id FROM learning_plans WHERE id = ?').get(plan.id) as Row | undefined
      const roadmapId = roadmapRef ? nullable(roadmapRef, 'roadmap_id') : null
      if (roadmapId) row = this.db.prepare("SELECT * FROM learning_roadmaps WHERE id = ? AND learner_id = ?").get(roadmapId, learnerId) as Row | undefined
      else { this.ensureLegacyRoadmap(learnerId, plan); row = this.db.prepare("SELECT * FROM learning_roadmaps WHERE learner_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1").get(learnerId) as Row | undefined }
    }
    if (!row) return { roadmap: null, roots: [], currentPlan: plan }
    const roadmap = roadmapFrom(row, this.progress(str(row, 'id'))); return { roadmap, roots: this.listNodes(learnerId, roadmap.id, null, 1).nodes, currentPlan: plan }
  }

  listNodes(learnerId: string, roadmapId: string, parentId: string | null, depth = 1): RoadmapNodePage {
    this.roadmapRow(roadmapId, learnerId); const allNodes = depth >= 99; const parentClause = allNodes ? '' : parentId == null ? 'AND n.parent_id IS NULL' : 'AND n.parent_id = ?'; const params = allNodes || parentId == null ? [roadmapId] : [roadmapId, parentId]; const rows = (this.db.prepare(`SELECT n.*, COALESCE(p.status, 'locked') AS progress_status, COALESCE(p.source, 'rule') AS progress_source, COALESCE(p.revision, 1) AS progress_revision, p.completed_at, p.verified_at, (SELECT COUNT(*) FROM roadmap_nodes c WHERE c.roadmap_id = n.roadmap_id AND c.parent_id = n.id) AS child_count FROM roadmap_nodes n LEFT JOIN roadmap_node_progress p ON p.node_id = n.id AND p.roadmap_id = n.roadmap_id WHERE n.roadmap_id = ? ${parentClause} ORDER BY n.position ASC`).all(...params) as Row[]).map(nodeFrom)
    return { roadmapId, parentId, depth, nodes: rows }
  }

  completeNode(learnerId: string, roadmapId: string, nodeId: string, input: { revision: number; status?: 'completed' | 'self_reported' }): RoadmapNode {
    if (str(this.roadmapRow(roadmapId, learnerId), 'status') !== 'active') throw new LabError('roadmap_not_active', '只能更新当前正式路线图', 409)
    const row = this.db.prepare('SELECT n.*, p.status AS progress_status, p.revision AS progress_revision FROM roadmap_nodes n INNER JOIN roadmap_node_progress p ON p.node_id = n.id AND p.roadmap_id = n.roadmap_id WHERE n.id = ? AND n.roadmap_id = ?').get(nodeId, roadmapId) as Row | undefined
    if (!row) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404); if (str(row, 'node_type') === 'lab') throw new LabError('node_requires_lab', '实验节点需要完成关联实践后验证', 409); if (!['concept', 'project'].includes(str(row, 'node_type'))) throw new LabError('node_not_completable', '当前节点需要展开子节点后完成', 409); if (str(row, 'progress_status') === 'locked') throw new LabError('node_locked', '请先完成前置节点', 409); if (num(row, 'progress_revision') !== input.revision) throw new LabError('roadmap_revision_conflict', '节点状态已更新，请刷新后重试', 409)
    const status = input.status ?? 'completed'; const now = new Date().toISOString(); const result = this.db.prepare('UPDATE roadmap_node_progress SET status = ?, source = ?, completed_at = ?, revision = revision + 1, updated_at = ? WHERE roadmap_id = ? AND node_id = ? AND revision = ?').run(status, status === 'self_reported' ? 'user' : 'manual', status === 'completed' ? now : null, now, roadmapId, nodeId, input.revision)
    if (result.changes === 0) throw new LabError('roadmap_revision_conflict', '节点状态已更新，请刷新后重试', 409)
    this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, roadmapId, nodeId, status === 'completed' ? 'node_completed' : 'node_self_reported', JSON.stringify({ status }), now)
    return this.listNodes(learnerId, roadmapId, nullable(row, 'parent_id'), 1).nodes.find((node) => node.id === nodeId) as RoadmapNode
  }

  markLabVerified(practiceRunId: string): void {
    const row = this.db.prepare("SELECT r.learner_id, p.roadmap_id, u.roadmap_node_id FROM practice_runs r INNER JOIN plan_units u ON u.id = r.plan_unit_id INNER JOIN learning_plans p ON p.id = u.plan_id WHERE r.id = ? AND r.status = 'resolved' AND u.roadmap_node_id IS NOT NULL").get(practiceRunId) as Row | undefined
    if (!row) return
    const now = new Date().toISOString(); this.db.prepare("UPDATE roadmap_node_progress SET status = 'verified', source = 'lab', verified_at = ?, completed_at = COALESCE(completed_at, ?), revision = revision + 1, updated_at = ? WHERE roadmap_id = ? AND node_id = ? AND status <> 'verified'").run(now, now, now, str(row, 'roadmap_id'), str(row, 'roadmap_node_id'))
    this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, \'lab_verified\', ?, ?)').run(randomUUID(), str(row, 'learner_id'), str(row, 'roadmap_id'), str(row, 'roadmap_node_id'), JSON.stringify({ practiceRunId }), now)
  }
}
