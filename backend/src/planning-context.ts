import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

type Row = Record<string, unknown>

export type ContextItemStatus = 'explicit' | 'confirmed' | 'inferred' | 'open' | 'superseded'
export type ContextItemKind = 'goal' | 'experience' | 'responsibility' | 'skill' | 'weakness' | 'constraint' | 'outcome' | 'preference' | 'evidence' | 'conversation' | 'open_question'

export interface ContextItem {
  id: string
  key: string
  kind: ContextItemKind
  content: string
  status: ContextItemStatus
  confidence: number
  importance: number
  sourceRefs: string[]
}

export interface PlanningContextPacket {
  snapshotId: string | null
  version: number
  goal: string
  currentFocus: string
  explicitFacts: ContextItem[]
  hypotheses: ContextItem[]
  constraints: ContextItem[]
  openQuestions: ContextItem[]
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  resumeExcerpt: string | null
}

interface ProfileDeltaLike {
  coveredTopics?: string[]
  dimensions?: Array<{ key: string; level: string; confidence: number; summary: string; nextValidation: string }>
  evidence?: Array<{ topicKey?: string | null; sourceType: string; sourceId: string; excerpt: string }>
  followUpTopic?: string | null
}

function text(row: Row, key: string): string { return String(row[key] ?? '') }
function number(row: Row, key: string): number { return Number(row[key] ?? 0) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLowerCase() }

function itemFrom(row: Row): ContextItem {
  return { id: text(row, 'id'), key: text(row, 'item_key'), kind: text(row, 'kind') as ContextItemKind, content: text(row, 'content'), status: text(row, 'status') as ContextItemStatus, confidence: number(row, 'confidence'), importance: number(row, 'importance'), sourceRefs: json<string[]>(row.source_refs_json, []) }
}

function topicKind(topic: string | null | undefined): ContextItemKind {
  if (topic === 'projects') return 'experience'
  if (topic === 'responsibility') return 'responsibility'
  if (topic === 'strengths_gaps') return 'skill'
  if (topic === 'time_constraints') return 'constraint'
  if (topic === 'outcome') return 'outcome'
  return 'evidence'
}

export class PlanningContextCompiler {
  constructor(private readonly db: Database.Database) {}

  update(input: { learnerId: string; sessionId: string; goal: string; messageId: string | null; clientRequestId: string; delta: ProfileDeltaLike; resumeText: string | null }): PlanningContextPacket {
    const previous = this.latestRow(input.learnerId, input.sessionId)
    const previousItems = previous ? this.items(text(previous, 'id')) : []
    const merged = new Map(previousItems.map((item) => [item.key, item]))
    const now = new Date().toISOString()
    const goalItem: ContextItem = { id: randomUUID(), key: 'goal', kind: 'goal', content: input.goal.trim(), status: 'explicit', confidence: 1, importance: 5, sourceRefs: input.messageId ? [`planning_message:${input.messageId}`] : [] }
    merged.set(goalItem.key, goalItem)

    for (const evidence of input.delta.evidence ?? []) {
      const content = evidence.excerpt.trim().slice(0, 2000); if (!content) continue
      const sourceKey = `${evidence.sourceType}:${evidence.sourceId || hash(content)}`
      const existing = merged.get(sourceKey)
      merged.set(sourceKey, {
        id: existing?.id ?? randomUUID(), key: sourceKey, kind: topicKind(evidence.topicKey), content,
        status: evidence.sourceType === 'user_message' || evidence.sourceType === 'resume' ? 'explicit' : 'inferred',
        confidence: existing?.confidence ?? (evidence.sourceType === 'user_message' || evidence.sourceType === 'resume' ? 1 : 0.5),
        importance: evidence.topicKey ? 4 : 2,
        sourceRefs: [evidence.sourceId ? `${evidence.sourceType}:${evidence.sourceId}` : `planning_message:${input.messageId ?? input.clientRequestId}`],
      })
    }
    for (const dimension of input.delta.dimensions ?? []) {
      const key = `dimension:${normalize(dimension.key)}`; const existing = merged.get(key)
      merged.set(key, { id: existing?.id ?? randomUUID(), key, kind: dimension.level === 'unknown' ? 'weakness' : 'skill', content: `${dimension.summary} 下一步验证：${dimension.nextValidation}`, status: 'inferred', confidence: dimension.confidence, importance: 3, sourceRefs: input.messageId ? [`planning_message:${input.messageId}`] : [] })
    }
    for (const item of merged.values()) if (item.kind === 'open_question' && (input.delta.coveredTopics ?? []).some((topic) => item.key === `question:${topic}`)) item.status = 'superseded'
    if (input.delta.followUpTopic) {
      const key = `question:${input.delta.followUpTopic}`; const existing = merged.get(key)
      merged.set(key, { id: existing?.id ?? randomUUID(), key, kind: 'open_question', content: this.questionFor(input.delta.followUpTopic), status: 'open', confidence: 1, importance: 5, sourceRefs: input.messageId ? [`planning_message:${input.messageId}`] : [] })
    }
    if ((input.delta.evidence ?? []).length === 0 && input.messageId) {
      const key = `conversation:${input.messageId}`
      merged.set(key, { id: randomUUID(), key, kind: 'conversation', content: '用户补充了一轮规划信息。', status: 'explicit', confidence: 1, importance: 1, sourceRefs: [`planning_message:${input.messageId}`] })
    }

    const activeItems = [...merged.values()].filter((item) => item.content.trim() && item.status !== 'superseded').map((item) => ({ ...item, id: randomUUID() }))
    const currentFocus = this.focus(input.delta.followUpTopic ?? null, activeItems)
    const version = previous ? number(previous, 'version') + 1 : 1; const snapshotId = randomUUID()
    const packet = this.packet(snapshotId, version, input.goal, currentFocus, activeItems, input.sessionId, input.resumeText)
    const fingerprint = hash({ goal: input.goal, focus: currentFocus, items: activeItems.map((item) => [item.key, item.content, item.status, item.confidence]) })
    const tx = this.db.transaction(() => {
      if (previous) this.db.prepare("UPDATE planning_context_snapshots SET status = 'superseded' WHERE id = ?").run(text(previous, 'id'))
      this.db.prepare('INSERT INTO planning_context_snapshots(id, learner_id, session_id, version, status, input_fingerprint, goal, current_focus, packet_json, created_at) VALUES (?, ?, ?, ?, \'current\', ?, ?, ?, ?, ?)').run(snapshotId, input.learnerId, input.sessionId, version, fingerprint, input.goal, currentFocus, JSON.stringify(packet), now)
      const insert = this.db.prepare('INSERT INTO planning_context_items(id, snapshot_id, item_key, kind, content, status, confidence, importance, source_refs_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const item of activeItems) insert.run(item.id, snapshotId, item.key, item.kind, item.content, item.status, item.confidence, item.importance, JSON.stringify(item.sourceRefs), now, now)
    })
    tx(); return packet
  }

  current(learnerId: string, sessionId: string): PlanningContextPacket | null {
    const row = this.latestRow(learnerId, sessionId); if (!row) return null
    const packet = json<PlanningContextPacket | null>(row.packet_json, null); if (packet) return packet
    return this.packet(text(row, 'id'), number(row, 'version'), text(row, 'goal'), text(row, 'current_focus'), this.items(text(row, 'id')), sessionId, null)
  }

  latestForLearner(learnerId: string): PlanningContextPacket | null {
    const row = this.db.prepare("SELECT * FROM planning_context_snapshots WHERE learner_id = ? AND status = 'current' ORDER BY created_at DESC LIMIT 1").get(learnerId) as Row | undefined
    if (!row) return null
    return json<PlanningContextPacket | null>(row.packet_json, null) ?? this.packet(text(row, 'id'), number(row, 'version'), text(row, 'goal'), text(row, 'current_focus'), this.items(text(row, 'id')), text(row, 'session_id'), null)
  }

  private latestRow(learnerId: string, sessionId: string): Row | undefined { return this.db.prepare("SELECT * FROM planning_context_snapshots WHERE learner_id = ? AND session_id = ? AND status = 'current' ORDER BY version DESC LIMIT 1").get(learnerId, sessionId) as Row | undefined }
  private items(snapshotId: string): ContextItem[] { return (this.db.prepare('SELECT * FROM planning_context_items WHERE snapshot_id = ? ORDER BY importance DESC, updated_at DESC').all(snapshotId) as Row[]).map(itemFrom) }
  private focus(topic: string | null, items: ContextItem[]): string { const open = topic ? items.find((item) => item.key === `question:${topic}`) : items.find((item) => item.kind === 'open_question'); return open?.content ?? items.find((item) => item.kind === 'goal')?.content ?? '继续澄清学习目标和当前基础' }
  private questionFor(topic: string): string { const questions: Record<string, string> = { goal_deadline: '目标与期限还需要更具体的结果或时间边界。', projects: '需要一个真实项目例子来判断实践经验。', responsibility: '需要了解你在项目中的独立决策范围。', strengths_gaps: '需要进一步确认当前优势和卡点。', time_constraints: '需要确认每周投入和现实约束。', outcome: '需要确认希望留下的可展示产出。' }; return questions[topic] ?? '还有一项信息需要进一步确认。' }
  private packet(snapshotId: string, version: number, goal: string, currentFocus: string, items: ContextItem[], sessionId: string, resumeText: string | null): PlanningContextPacket {
    const recentMessages = (this.db.prepare('SELECT role, content FROM planning_messages WHERE session_id = ? ORDER BY sequence DESC LIMIT 8').all(sessionId) as Row[]).reverse().map((row) => ({ role: text(row, 'role') as 'user' | 'assistant' | 'system', content: text(row, 'content') }))
    return { snapshotId, version, goal, currentFocus, explicitFacts: items.filter((item) => item.status === 'explicit' || item.status === 'confirmed'), hypotheses: items.filter((item) => item.status === 'inferred'), constraints: items.filter((item) => item.kind === 'constraint'), openQuestions: items.filter((item) => item.status === 'open'), recentMessages, resumeExcerpt: resumeText?.slice(0, 6000) ?? null }
  }
}
