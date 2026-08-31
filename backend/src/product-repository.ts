import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { assertProductMigrations, openProductDatabase } from './product-migrate.js'
import type {
  Artifact, ArtifactKind, ArtifactSourceKind, CaseStage, EventActor, EventType, Intake, LearningPlan,
  LabSegment, Learner, MemoryItem, PathNode, PlanUnit, PracticeEvent, PracticeRun, PracticeSnapshot, SourceItem,
  StageMemory, TutorInvocation, TutorInvocationStatus, VerificationStatus, WritingClaim, WritingDocument, WritingMaterial, WritingProject, WritingReviewItem, WritingSection,
} from './product-types.js'

type Row = Record<string, unknown>

function text(row: Row, key: string): string {
  return String(row[key])
}

function nullableText(row: Row, key: string): string | null {
  return row[key] == null ? null : String(row[key])
}

function number(row: Row, key: string): number {
  return Number(row[key])
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function learnerFrom(row: Row): Learner {
  return { id: text(row, 'id'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function intakeFrom(row: Row): Intake {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), goal: text(row, 'goal'), technology: text(row, 'technology'),
    outcome: nullableText(row, 'outcome'), weeklyMinutes: row.weekly_minutes == null ? null : number(row, 'weekly_minutes'),
    status: text(row, 'status') as Intake['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function unitFrom(row: Row): PlanUnit {
  return {
    id: text(row, 'id'), planId: text(row, 'plan_id'), position: number(row, 'position'), title: text(row, 'title'),
    objective: text(row, 'objective'), caseId: nullableText(row, 'case_id') as PlanUnit['caseId'],
    status: text(row, 'status') as PlanUnit['status'], sourceRefs: json<string[]>(row.source_refs_json, []),
  }
}

function planFrom(row: Row, units: PlanUnit[]): LearningPlan {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), intakeId: text(row, 'intake_id'), title: text(row, 'title'),
    goal: text(row, 'goal'), sourceStatus: text(row, 'source_status') as LearningPlan['sourceStatus'],
    status: text(row, 'status') as LearningPlan['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), units,
  }
}

function runFrom(row: Row): PracticeRun {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), planUnitId: nullableText(row, 'plan_unit_id'),
    caseId: text(row, 'case_id') as PracticeRun['caseId'], labRunId: nullableText(row, 'lab_run_id'),
    stage: text(row, 'stage') as CaseStage, hintLevel: number(row, 'hint_level'), noProgressCount: number(row, 'no_progress_count'),
    status: text(row, 'status') as PracticeRun['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function eventFrom(row: Row): PracticeEvent {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), sequence: number(row, 'sequence'),
    actor: text(row, 'actor') as EventActor, type: text(row, 'type') as EventType, stage: text(row, 'stage') as CaseStage,
    payload: json<Record<string, unknown>>(row.payload_json, {}), artifactRefs: json<string[]>(row.artifact_refs_json, []),
    clientRequestId: nullableText(row, 'client_request_id'), createdAt: text(row, 'created_at'),
  }
}

function artifactFrom(row: Row): Artifact {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: nullableText(row, 'practice_run_id'),
    kind: text(row, 'kind') as ArtifactKind, sourceKind: text(row, 'source_kind') as ArtifactSourceKind,
    verificationStatus: text(row, 'verification_status') as VerificationStatus, content: text(row, 'content'),
    metadata: json<Record<string, unknown>>(row.metadata_json, {}), checksum: text(row, 'checksum'), createdAt: text(row, 'created_at'),
  }
}

function pathNodeFrom(row: Row): PathNode {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), stage: text(row, 'stage') as CaseStage,
    title: text(row, 'title'), judgment: text(row, 'judgment'), outcome: text(row, 'outcome'), judgmentChange: nullableText(row, 'judgment_change'),
    nextGap: nullableText(row, 'next_gap'), importance: text(row, 'importance') as PathNode['importance'],
    eventRefs: json<string[]>(row.event_refs_json, []), artifactRefs: json<string[]>(row.artifact_refs_json, []), createdAt: text(row, 'created_at'),
  }
}

function stageMemoryFrom(row: Row): StageMemory {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), stage: text(row, 'stage') as CaseStage,
    memory: json<Record<string, unknown>>(row.memory_json, {}), sourceEventRefs: json<string[]>(row.source_event_refs_json, []),
    version: number(row, 'version'), updatedAt: text(row, 'updated_at'),
  }
}

function memoryFrom(row: Row): MemoryItem {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), category: text(row, 'category') as MemoryItem['category'],
    topic: text(row, 'topic'), status: text(row, 'status') as MemoryItem['status'], statement: text(row, 'statement'), scope: text(row, 'scope'),
    confidence: Number(row.confidence), evidenceRefs: json<string[]>(row.evidence_refs_json, []), userNote: nullableText(row, 'user_note'), updatedAt: text(row, 'updated_at'),
  }
}

function sourceFrom(row: Row): SourceItem {
  return {
    id: text(row, 'id'), provider: text(row, 'provider') as SourceItem['provider'], externalId: nullableText(row, 'external_id'),
    title: text(row, 'title'), author: nullableText(row, 'author'), url: text(row, 'url'), excerpt: text(row, 'excerpt'),
    query: nullableText(row, 'query'), retrievedAt: text(row, 'retrieved_at'), metadata: json<Record<string, unknown>>(row.metadata_json, {}),
  }
}

function labSegmentFrom(row: Row): LabSegment {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), labRunId: text(row, 'lab_run_id'),
    fixtureVersion: text(row, 'fixture_version'), status: text(row, 'status') as LabSegment['status'],
    startedAt: text(row, 'started_at'), endedAt: nullableText(row, 'ended_at'), endedReason: nullableText(row, 'ended_reason'),
  }
}

function tutorInvocationFrom(row: Row): TutorInvocation {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), userArtifactId: text(row, 'user_artifact_id'),
    clientRequestId: text(row, 'client_request_id'), provider: text(row, 'provider'), model: text(row, 'model'),
    status: text(row, 'status') as TutorInvocationStatus, retrievalStatus: text(row, 'retrieval_status'),
    sourceIds: json<string[]>(row.source_ids_json, []), failureCode: nullableText(row, 'failure_code'),
    failureMessage: nullableText(row, 'failure_message'), latencyMs: row.latency_ms == null ? null : number(row, 'latency_ms'),
    createdAt: text(row, 'created_at'), completedAt: nullableText(row, 'completed_at'),
  }
}

function writingMaterialFrom(row: Row): WritingMaterial {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), category: text(row, 'category') as WritingMaterial['category'],
    refType: text(row, 'ref_type') as WritingMaterial['refType'], refId: text(row, 'ref_id'), title: text(row, 'title'),
    excerpt: text(row, 'excerpt'), selected: Number(row.selected) === 1,
    verificationStatus: text(row, 'verification_status') as WritingMaterial['verificationStatus'], metadata: json<Record<string, unknown>>(row.metadata_json, {}), createdAt: text(row, 'created_at'),
  }
}

function writingSectionFrom(row: Row): WritingSection {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), sectionKey: text(row, 'section_key'), position: number(row, 'position'),
    title: text(row, 'title'), content: text(row, 'content'), required: Number(row.required) === 1,
    status: text(row, 'status') as WritingSection['status'], evidenceRefs: json<string[]>(row.evidence_refs_json, []), sourceRefs: json<string[]>(row.source_refs_json, []), updatedAt: text(row, 'updated_at'),
  }
}

function writingClaimFrom(row: Row): WritingClaim {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), sectionId: text(row, 'section_id'), text: text(row, 'text'),
    kind: text(row, 'kind') as WritingClaim['kind'], status: text(row, 'status') as WritingClaim['status'],
    evidenceRefs: json<string[]>(row.evidence_refs_json, []), sourceRefs: json<string[]>(row.source_refs_json, []), createdAt: text(row, 'created_at'),
  }
}

function writingDocumentFrom(row: Row, sections: WritingSection[], claims: WritingClaim[]): WritingDocument {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), kind: text(row, 'kind') as WritingDocument['kind'], revision: number(row, 'revision'), status: text(row, 'status') as WritingDocument['status'], title: text(row, 'title'), summary: text(row, 'summary'), sections, claims, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function writingReviewItemFrom(row: Row): WritingReviewItem {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), code: text(row, 'code'), severity: text(row, 'severity') as WritingReviewItem['severity'],
    status: text(row, 'status') as WritingReviewItem['status'], message: text(row, 'message'), sectionId: nullableText(row, 'section_id'), createdAt: text(row, 'created_at'),
  }
}

export interface CreateArtifactInput {
  learnerId: string
  practiceRunId?: string | null
  kind: ArtifactKind
  sourceKind: ArtifactSourceKind
  verificationStatus: VerificationStatus
  content: string
  metadata?: Record<string, unknown>
}

export interface AppendEventInput {
  learnerId: string
  practiceRunId: string
  actor: EventActor
  type: EventType
  stage: CaseStage
  payload: Record<string, unknown>
  artifactRefs?: string[]
  clientRequestId?: string | null
}

export interface PracticeHistoryRecord {
  run: PracticeRun
  lastActivityAt: string
  lastTutorProvider: string | null
  lastTutorSourceStatus: string | null
}

export class ProductRepository {
  readonly db: Database.Database

  constructor(dbPath: string, database?: Database.Database) {
    this.db = database ?? openProductDatabase(dbPath)
    assertProductMigrations(this.db)
  }

  close(): void { if (this.db.open) this.db.close() }

  ensureLearner(learnerId: string): Learner {
    const now = new Date().toISOString()
    this.db.prepare('INSERT OR IGNORE INTO learners(id, created_at, updated_at) VALUES (?, ?, ?)').run(learnerId, now, now)
    this.db.prepare('UPDATE learners SET updated_at = ? WHERE id = ?').run(now, learnerId)
    return learnerFrom(this.db.prepare('SELECT * FROM learners WHERE id = ?').get(learnerId) as Row)
  }

  createIntake(input: { learnerId: string; goal: string; technology: string; outcome?: string | null; weeklyMinutes?: number | null }): Intake {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(id, input.learnerId, input.goal, input.technology, input.outcome ?? null, input.weeklyMinutes ?? null, now, now)
    return this.getIntake(id)
  }

  getIntake(id: string): Intake {
    const row = this.db.prepare('SELECT * FROM intakes WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Intake not found: ${id}`)
    return intakeFrom(row)
  }

  createPlan(input: { learnerId: string; intakeId: string; title: string; goal: string; sourceStatus: LearningPlan['sourceStatus']; units: Array<Omit<PlanUnit, 'id' | 'planId'> > }): LearningPlan {
    const planId = randomUUID(); const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(planId, input.learnerId, input.intakeId, input.title, input.goal, input.sourceStatus, now, now)
      const insert = this.db.prepare(`INSERT INTO plan_units(id, plan_id, position, title, objective, case_id, status, source_refs_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const unit of input.units) insert.run(randomUUID(), planId, unit.position, unit.title, unit.objective, unit.caseId, unit.status, JSON.stringify(unit.sourceRefs))
      this.db.prepare("UPDATE intakes SET status = 'planned', updated_at = ? WHERE id = ?").run(now, input.intakeId)
    })
    transaction()
    return this.getPlan(planId)
  }

  getPlan(id: string): LearningPlan {
    const row = this.db.prepare('SELECT * FROM learning_plans WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Plan not found: ${id}`)
    const units = (this.db.prepare('SELECT * FROM plan_units WHERE plan_id = ? ORDER BY position ASC').all(id) as Row[]).map(unitFrom)
    return planFrom(row, units)
  }

  confirmPlan(id: string): LearningPlan {
    const now = new Date().toISOString()
    this.db.prepare("UPDATE learning_plans SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now, id)
    return this.getPlan(id)
  }

  createPracticeRun(input: { learnerId: string; planUnitId?: string | null; caseId: PracticeRun['caseId']; labRunId?: string | null }): PracticeRun {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO practice_runs(id, learner_id, plan_unit_id, case_id, lab_run_id, stage, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'observe', 'active', ?, ?)`).run(id, input.learnerId, input.planUnitId ?? null, input.caseId, input.labRunId ?? null, now, now)
    return this.getPracticeRun(id)
  }

  getPracticeRun(id: string): PracticeRun {
    const row = this.db.prepare('SELECT * FROM practice_runs WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Practice run not found: ${id}`)
    return runFrom(row)
  }

  listPracticeHistory(learnerId: string, options: { cursor?: { updatedAt: string; id: string }; limit: number }): PracticeHistoryRecord[] {
    const cursorClause = options.cursor ? 'AND (r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))' : ''
    const values = options.cursor ? [learnerId, options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id, options.limit] : [learnerId, options.limit]
    const rows = this.db.prepare(`SELECT r.*,
        COALESCE((SELECT MAX(e.created_at) FROM practice_events e WHERE e.practice_run_id = r.id), r.updated_at) AS last_activity_at,
        (SELECT t.provider FROM tutor_turns t WHERE t.practice_run_id = r.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS last_tutor_provider,
        (SELECT t.source_status FROM tutor_turns t WHERE t.practice_run_id = r.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS last_tutor_source_status
      FROM practice_runs r
      WHERE r.learner_id = ? ${cursorClause}
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ?`).all(...values) as Row[]
    return rows.map((row) => ({ run: runFrom(row), lastActivityAt: text(row, 'last_activity_at'), lastTutorProvider: nullableText(row, 'last_tutor_provider'), lastTutorSourceStatus: nullableText(row, 'last_tutor_source_status') }))
  }

  updatePracticeRun(id: string, update: Partial<Pick<PracticeRun, 'stage' | 'hintLevel' | 'noProgressCount' | 'status' | 'labRunId'>>): PracticeRun {
    const fields: string[] = []; const values: unknown[] = []
    for (const [key, value] of Object.entries(update)) {
      const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      fields.push(`${column} = ?`); values.push(value)
    }
    if (fields.length === 0) return this.getPracticeRun(id)
    fields.push('updated_at = ?'); values.push(new Date().toISOString(), id)
    this.db.prepare(`UPDATE practice_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getPracticeRun(id)
  }

  createLabSegment(input: { practiceRunId: string; labRunId: string; fixtureVersion: string }): LabSegment {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO practice_lab_segments(id, practice_run_id, lab_run_id, fixture_version, status, started_at)
      VALUES (?, ?, ?, ?, 'active', ?)`).run(id, input.practiceRunId, input.labRunId, input.fixtureVersion, now)
    return labSegmentFrom(this.db.prepare('SELECT * FROM practice_lab_segments WHERE id = ?').get(id) as Row)
  }

  finishLabSegment(labRunId: string, reason: string): void {
    this.db.prepare("UPDATE practice_lab_segments SET status = 'ended', ended_at = ?, ended_reason = ? WHERE lab_run_id = ? AND status = 'active'").run(new Date().toISOString(), reason, labRunId)
  }

  listLabSegments(practiceRunId: string): LabSegment[] {
    return (this.db.prepare('SELECT * FROM practice_lab_segments WHERE practice_run_id = ? ORDER BY started_at ASC').all(practiceRunId) as Row[]).map(labSegmentFrom)
  }

  appendEvent(input: AppendEventInput): PracticeEvent {
    const transaction = this.db.transaction(() => {
      if (input.clientRequestId) {
        const existing = this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?').get(input.practiceRunId, input.clientRequestId) as Row | undefined
        if (existing) return eventFrom(existing)
      }
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM practice_events WHERE practice_run_id = ?').get(input.practiceRunId) as Row
      const id = randomUUID(); const now = new Date().toISOString()
      this.db.prepare(`INSERT INTO practice_events(id, learner_id, practice_run_id, sequence, actor, type, stage, payload_json, artifact_refs_json, client_request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId, number(next, 'sequence'), input.actor, input.type, input.stage, JSON.stringify(input.payload), JSON.stringify(input.artifactRefs ?? []), input.clientRequestId ?? null, now)
      return eventFrom(this.db.prepare('SELECT * FROM practice_events WHERE id = ?').get(id) as Row)
    })
    return transaction() as PracticeEvent
  }

  listEvents(practiceRunId: string): PracticeEvent[] {
    return (this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? ORDER BY sequence ASC').all(practiceRunId) as Row[]).map(eventFrom)
  }

  findEventByClientRequestId(practiceRunId: string, clientRequestId: string): PracticeEvent | null {
    const row = this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?').get(practiceRunId, clientRequestId) as Row | undefined
    return row ? eventFrom(row) : null
  }

  createArtifact(input: CreateArtifactInput): Artifact {
    const id = randomUUID(); const now = new Date().toISOString()
    const checksum = createHash('sha256').update(input.content).digest('hex')
    this.db.prepare(`INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId ?? null, input.kind, input.sourceKind, input.verificationStatus, input.content, JSON.stringify(input.metadata ?? {}), checksum, now)
    return artifactFrom(this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row)
  }

  listArtifacts(practiceRunId: string): Artifact[] {
    return (this.db.prepare('SELECT * FROM artifacts WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map(artifactFrom)
  }

  getArtifact(id: string): Artifact {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Artifact not found: ${id}`)
    return artifactFrom(row)
  }

  createPathNode(input: Omit<PathNode, 'id' | 'createdAt'>): PathNode {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO path_nodes(id, practice_run_id, stage, title, judgment, outcome, judgment_change, next_gap, importance, event_refs_json, artifact_refs_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.practiceRunId, input.stage, input.title, input.judgment, input.outcome, input.judgmentChange, input.nextGap, input.importance, JSON.stringify(input.eventRefs), JSON.stringify(input.artifactRefs), now)
    return pathNodeFrom(this.db.prepare('SELECT * FROM path_nodes WHERE id = ?').get(id) as Row)
  }

  listPathNodes(practiceRunId: string): PathNode[] {
    return (this.db.prepare('SELECT * FROM path_nodes WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map(pathNodeFrom)
  }

  upsertStageMemory(input: { practiceRunId: string; stage: CaseStage; memory: Record<string, unknown>; sourceEventRefs: string[] }): StageMemory {
    const current = this.db.prepare('SELECT * FROM stage_memories WHERE practice_run_id = ? AND stage = ?').get(input.practiceRunId, input.stage) as Row | undefined
    const id = current ? text(current, 'id') : randomUUID(); const version = current ? number(current, 'version') + 1 : 1; const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO stage_memories(id, practice_run_id, stage, memory_json, source_event_refs_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(practice_run_id, stage) DO UPDATE SET memory_json = excluded.memory_json, source_event_refs_json = excluded.source_event_refs_json, version = excluded.version, updated_at = excluded.updated_at`).run(id, input.practiceRunId, input.stage, JSON.stringify(input.memory), JSON.stringify(input.sourceEventRefs), version, now)
    return stageMemoryFrom(this.db.prepare('SELECT * FROM stage_memories WHERE id = ?').get(id) as Row)
  }

  listStageMemories(practiceRunId: string): StageMemory[] {
    return (this.db.prepare('SELECT * FROM stage_memories WHERE practice_run_id = ? ORDER BY updated_at ASC').all(practiceRunId) as Row[]).map(stageMemoryFrom)
  }

  upsertMemory(input: Omit<MemoryItem, 'id' | 'updatedAt'>): MemoryItem {
    const existing = this.db.prepare('SELECT * FROM memory_items WHERE learner_id = ? AND category = ? AND topic = ? AND status != \'deleted\' ORDER BY updated_at DESC LIMIT 1').get(input.learnerId, input.category, input.topic) as Row | undefined
    const id = existing ? text(existing, 'id') : randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO memory_items(id, learner_id, category, topic, status, statement, scope, confidence, evidence_refs_json, user_note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, statement = excluded.statement, scope = excluded.scope, confidence = excluded.confidence, evidence_refs_json = excluded.evidence_refs_json, user_note = excluded.user_note, updated_at = excluded.updated_at`).run(id, input.learnerId, input.category, input.topic, input.status, input.statement, input.scope, input.confidence, JSON.stringify(input.evidenceRefs), input.userNote, now)
    return memoryFrom(this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as Row)
  }

  listMemories(learnerId: string): MemoryItem[] {
    return (this.db.prepare("SELECT * FROM memory_items WHERE learner_id = ? AND status != 'deleted' ORDER BY updated_at DESC").all(learnerId) as Row[]).map(memoryFrom)
  }

  updateMemory(id: string, update: { statement?: string; userNote?: string | null; status?: MemoryItem['status'] }): MemoryItem {
    const fields: string[] = []; const values: unknown[] = []
    for (const [key, value] of Object.entries(update)) { fields.push(`${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)} = ?`); values.push(value) }
    fields.push('updated_at = ?'); values.push(new Date().toISOString(), id)
    this.db.prepare(`UPDATE memory_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return memoryFrom(this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as Row)
  }

  saveSource(input: Omit<SourceItem, 'id'> & { id?: string }): SourceItem {
    const id = input.id ?? randomUUID(); const externalId = input.externalId ?? null
    this.db.prepare(`INSERT INTO source_items(id, provider, external_id, title, author, url, excerpt, query, retrieved_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET title = excluded.title, author = excluded.author, url = excluded.url, excerpt = excluded.excerpt, query = excluded.query, retrieved_at = excluded.retrieved_at, metadata_json = excluded.metadata_json`).run(id, input.provider, externalId, input.title, input.author, input.url, input.excerpt, input.query, input.retrievedAt, JSON.stringify(input.metadata))
    const row = this.db.prepare(externalId ? 'SELECT * FROM source_items WHERE provider = ? AND external_id = ?' : 'SELECT * FROM source_items WHERE id = ?').get(...(externalId ? [input.provider, externalId] : [id])) as Row
    return sourceFrom(row)
  }

  listSources(ids?: string[]): SourceItem[] {
    if (!ids || ids.length === 0) return (this.db.prepare('SELECT * FROM source_items ORDER BY retrieved_at DESC LIMIT 50').all() as Row[]).map(sourceFrom)
    const placeholders = ids.map(() => '?').join(', ')
    return (this.db.prepare(`SELECT * FROM source_items WHERE id IN (${placeholders}) ORDER BY retrieved_at DESC`).all(...ids) as Row[]).map(sourceFrom)
  }

  listSourcesForQuery(provider: SourceItem['provider'], query: string, since: string, limit: number): SourceItem[] {
    return (this.db.prepare('SELECT * FROM source_items WHERE provider = ? AND query = ? AND retrieved_at >= ? ORDER BY retrieved_at DESC LIMIT ?').all(provider, query, since, limit) as Row[]).map(sourceFrom)
  }

  saveTutorTurn(input: { practiceRunId: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string }): void {
    this.db.prepare(`INSERT INTO tutor_turns(id, practice_run_id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.practiceRunId, input.userArtifactId, input.assistantArtifactId, input.mode, input.provider, input.sourceStatus, new Date().toISOString())
  }

  listTutorTurns(practiceRunId: string) {
    return (this.db.prepare('SELECT id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at FROM tutor_turns WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map((row) => ({ id: text(row, 'id'), userArtifactId: nullableText(row, 'user_artifact_id'), assistantArtifactId: nullableText(row, 'assistant_artifact_id'), mode: text(row, 'mode'), provider: text(row, 'provider'), sourceStatus: text(row, 'source_status'), createdAt: text(row, 'created_at') }))
  }

  createTutorInvocation(input: { practiceRunId: string; userArtifactId: string; clientRequestId: string; provider: string; model: string }): TutorInvocation {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO tutor_invocations(id, practice_run_id, user_artifact_id, client_request_id, provider, model, status, retrieval_status, source_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', 'not_requested', '[]', ?)`).run(id, input.practiceRunId, input.userArtifactId, input.clientRequestId, input.provider, input.model, now)
    return tutorInvocationFrom(this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row)
  }

  getTutorInvocationByRequest(practiceRunId: string, clientRequestId: string): TutorInvocation | null {
    const row = this.db.prepare('SELECT * FROM tutor_invocations WHERE practice_run_id = ? AND client_request_id = ?').get(practiceRunId, clientRequestId) as Row | undefined
    return row ? tutorInvocationFrom(row) : null
  }

  getTutorInvocation(id: string): TutorInvocation {
    const row = this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Tutor invocation not found: ${id}`)
    return tutorInvocationFrom(row)
  }

  markRunningTutorInvocationsInterrupted(): number {
    const result = this.db.prepare("UPDATE tutor_invocations SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '服务在本次调用完成前重启', completed_at = ? WHERE status = 'running'").run(new Date().toISOString())
    return result.changes
  }

  updateTutorInvocation(id: string, update: { status: TutorInvocationStatus; retrievalStatus?: string; sourceIds?: string[]; failureCode?: string | null; failureMessage?: string | null; latencyMs?: number | null }): TutorInvocation {
    const now = new Date().toISOString()
    const terminal = update.status === 'succeeded' || update.status === 'failed' || update.status === 'interrupted'
    this.db.prepare(`UPDATE tutor_invocations SET status = ?, retrieval_status = COALESCE(?, retrieval_status), source_ids_json = COALESCE(?, source_ids_json), failure_code = ?, failure_message = ?, latency_ms = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END WHERE id = ?`)
      .run(update.status, update.retrievalStatus ?? null, update.sourceIds ? JSON.stringify(update.sourceIds) : null, update.failureCode ?? null, update.failureMessage ?? null, update.latencyMs ?? null, terminal ? 1 : 0, now, id)
    return tutorInvocationFrom(this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row)
  }

  findTutorTurnByUserArtifact(userArtifactId: string): { id: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string; createdAt: string } | null {
    const row = this.db.prepare('SELECT id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at FROM tutor_turns WHERE user_artifact_id = ? ORDER BY created_at DESC LIMIT 1').get(userArtifactId) as Row | undefined
    return row ? { id: text(row, 'id'), userArtifactId: nullableText(row, 'user_artifact_id'), assistantArtifactId: nullableText(row, 'assistant_artifact_id'), mode: text(row, 'mode'), provider: text(row, 'provider'), sourceStatus: text(row, 'source_status'), createdAt: text(row, 'created_at') } : null
  }

  createWritingProject(input: { learnerId: string; practiceRunId: string }): WritingProject {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT OR IGNORE INTO writing_projects(id, learner_id, practice_run_id, article_type, status, evidence_snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, 'engineering_practice_review', 'materials_ready', ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId, JSON.stringify({ capturedAt: null, materialIds: [] }), now, now)
    const row = this.db.prepare('SELECT id FROM writing_projects WHERE practice_run_id = ?').get(input.practiceRunId) as Row
    return this.getWritingProject(text(row, 'id'))
  }

  getWritingProjectByRun(practiceRunId: string): WritingProject | null {
    const row = this.db.prepare('SELECT id FROM writing_projects WHERE practice_run_id = ?').get(practiceRunId) as Row | undefined
    return row ? this.getWritingProject(text(row, 'id')) : null
  }

  getWritingProject(projectId: string): WritingProject {
    const row = this.db.prepare('SELECT * FROM writing_projects WHERE id = ?').get(projectId) as Row | undefined
    if (!row) throw new Error(`Writing project not found: ${projectId}`)
    const materials = (this.db.prepare('SELECT * FROM writing_materials WHERE project_id = ? ORDER BY selected DESC, created_at ASC').all(projectId) as Row[]).map(writingMaterialFrom)
    const documents = this.listWritingDocuments(projectId)
    const reviewItems = (this.db.prepare('SELECT * FROM writing_review_items WHERE project_id = ? ORDER BY severity DESC, created_at ASC').all(projectId) as Row[]).map(writingReviewItemFrom)
    return {
      id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), articleType: 'engineering_practice_review',
      status: text(row, 'status') as WritingProject['status'], evidenceSnapshot: json<WritingProject['evidenceSnapshot']>(row.evidence_snapshot_json, { capturedAt: null, materialIds: [] }),
      materials, documents, reviewItems, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  upsertWritingMaterial(input: Omit<WritingMaterial, 'id' | 'createdAt' | 'projectId'> & { projectId: string }): WritingMaterial {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO writing_materials(id, project_id, category, ref_type, ref_id, title, excerpt, selected, verification_status, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, ref_type, ref_id) DO UPDATE SET category = excluded.category, title = excluded.title, excerpt = excluded.excerpt, verification_status = excluded.verification_status, metadata_json = excluded.metadata_json`).run(
      id, input.projectId, input.category, input.refType, input.refId, input.title, input.excerpt, input.selected ? 1 : 0, input.verificationStatus, JSON.stringify(input.metadata), now,
    )
    return writingMaterialFrom(this.db.prepare('SELECT * FROM writing_materials WHERE project_id = ? AND ref_type = ? AND ref_id = ?').get(input.projectId, input.refType, input.refId) as Row)
  }

  updateWritingMaterial(projectId: string, materialId: string, update: { selected?: boolean; editorialNote?: string | null }): WritingMaterial {
    const fields: string[] = []; const values: unknown[] = []
    if (update.selected !== undefined) { fields.push('selected = ?'); values.push(update.selected ? 1 : 0) }
    if (update.editorialNote !== undefined) {
      const row = this.db.prepare('SELECT metadata_json FROM writing_materials WHERE id = ? AND project_id = ?').get(materialId, projectId) as Row | undefined
      if (!row) throw new Error(`Writing material not found: ${materialId}`)
      const metadata = json<Record<string, unknown>>(row.metadata_json, {}); metadata.editorialNote = update.editorialNote
      fields.push('metadata_json = ?'); values.push(JSON.stringify(metadata))
    }
    if (fields.length > 0) this.db.prepare(`UPDATE writing_materials SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`).run(...values, materialId, projectId)
    const row = this.db.prepare('SELECT * FROM writing_materials WHERE id = ? AND project_id = ?').get(materialId, projectId) as Row | undefined
    if (!row) throw new Error(`Writing material not found: ${materialId}`)
    return writingMaterialFrom(row)
  }

  updateWritingSnapshot(projectId: string, materialIds: string[], status: WritingProject['status']): void {
    this.db.prepare('UPDATE writing_projects SET evidence_snapshot_json = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ capturedAt: new Date().toISOString(), materialIds }), status, new Date().toISOString(), projectId)
  }

  createWritingDocument(input: {
    projectId: string
    kind: WritingDocument['kind']
    status: WritingDocument['status']
    title: string
    summary: string
    sections: Array<Pick<WritingSection, 'sectionKey' | 'position' | 'title' | 'content' | 'required' | 'status' | 'evidenceRefs' | 'sourceRefs'>>
    claims: Array<{ sectionKey: string; text: string; kind: WritingClaim['kind']; status: WritingClaim['status']; evidenceRefs: string[]; sourceRefs: string[] }>
  }): WritingDocument {
    const documentId = randomUUID(); const now = new Date().toISOString()
    const sectionIds = new Map<string, string>()
    const create = this.db.transaction(() => {
      const current = this.db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM writing_documents WHERE project_id = ? AND kind = ?').get(input.projectId, input.kind) as Row
      const revision = number(current, 'revision') + 1
      this.db.prepare(`INSERT INTO writing_documents(id, project_id, kind, revision, status, title, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(documentId, input.projectId, input.kind, revision, input.status, input.title, input.summary, now, now)
      const insertSection = this.db.prepare(`INSERT INTO writing_sections(id, document_id, section_key, position, title, content, required, status, evidence_refs_json, source_refs_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const section of input.sections) {
        const sectionId = randomUUID(); sectionIds.set(section.sectionKey, sectionId)
        insertSection.run(sectionId, documentId, section.sectionKey, section.position, section.title, section.content, section.required ? 1 : 0, section.status, JSON.stringify(section.evidenceRefs), JSON.stringify(section.sourceRefs), now)
      }
      const insertClaim = this.db.prepare(`INSERT INTO writing_claims(id, document_id, section_id, text, kind, status, evidence_refs_json, source_refs_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const claim of input.claims) {
        const sectionId = sectionIds.get(claim.sectionKey)
        if (!sectionId) continue
        insertClaim.run(randomUUID(), documentId, sectionId, claim.text, claim.kind, claim.status, JSON.stringify(claim.evidenceRefs), JSON.stringify(claim.sourceRefs), now)
      }
    })
    create.immediate()
    return this.getWritingDocument(documentId)
  }

  getWritingDocument(documentId: string): WritingDocument {
    const row = this.db.prepare('SELECT * FROM writing_documents WHERE id = ?').get(documentId) as Row | undefined
    if (!row) throw new Error(`Writing document not found: ${documentId}`)
    const sections = (this.db.prepare('SELECT * FROM writing_sections WHERE document_id = ? ORDER BY position ASC').all(documentId) as Row[]).map(writingSectionFrom)
    const claims = (this.db.prepare('SELECT * FROM writing_claims WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as Row[]).map(writingClaimFrom)
    return writingDocumentFrom(row, sections, claims)
  }

  listWritingDocuments(projectId: string): WritingDocument[] {
    const rows = this.db.prepare(`SELECT document.* FROM writing_documents document
      INNER JOIN (SELECT kind, MAX(revision) AS revision FROM writing_documents WHERE project_id = ? GROUP BY kind) latest
      ON latest.kind = document.kind AND latest.revision = document.revision
      WHERE document.project_id = ? ORDER BY document.kind ASC`).all(projectId, projectId) as Row[]
    if (rows.length === 0) return []
    const ids = rows.map((row) => text(row, 'id')); const placeholders = ids.map(() => '?').join(', ')
    const sectionRows = this.db.prepare(`SELECT * FROM writing_sections WHERE document_id IN (${placeholders}) ORDER BY position ASC`).all(...ids) as Row[]
    const claimRows = this.db.prepare(`SELECT * FROM writing_claims WHERE document_id IN (${placeholders}) ORDER BY created_at ASC`).all(...ids) as Row[]
    return rows.map((row) => {
      const documentId = text(row, 'id')
      const sections = sectionRows.filter((section) => text(section, 'document_id') === documentId).map(writingSectionFrom)
      const claims = claimRows.filter((claim) => text(claim, 'document_id') === documentId).map(writingClaimFrom)
      return writingDocumentFrom(row, sections, claims)
    })
  }

  updateWritingSection(projectId: string, documentId: string, sectionId: string, expectedRevision: number, content: string): WritingDocument {
    const result = this.db.transaction(() => {
      const document = this.db.prepare('SELECT id FROM writing_documents WHERE id = ? AND project_id = ?').get(documentId, projectId) as Row | undefined
      if (!document) throw new Error('WRITING_DOCUMENT_NOT_FOUND')
      const updated = this.db.prepare('UPDATE writing_documents SET revision = revision + 1, status = CASE WHEN kind = \'article\' THEN \'needs_review\' ELSE status END, updated_at = ? WHERE id = ? AND project_id = ? AND revision = ?').run(new Date().toISOString(), documentId, projectId, expectedRevision)
      if (updated.changes === 0) throw new Error('WRITING_REVISION_CONFLICT')
      const section = this.db.prepare('UPDATE writing_sections SET content = ?, status = \'confirmed\', updated_at = ? WHERE id = ? AND document_id = ?').run(content, new Date().toISOString(), sectionId, documentId)
      if (section.changes === 0) throw new Error('WRITING_SECTION_NOT_FOUND')
      this.db.prepare("UPDATE writing_claims SET status = 'needs_review' WHERE document_id = ? AND section_id = ?").run(documentId, sectionId)
    })
    result()
    return this.getWritingDocument(documentId)
  }

  replaceWritingReviewItems(projectId: string, items: Array<Omit<WritingReviewItem, 'id' | 'projectId' | 'createdAt'>>): WritingReviewItem[] {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM writing_review_items WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(`INSERT INTO writing_review_items(id, project_id, code, severity, status, message, section_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const item of items) insert.run(randomUUID(), projectId, item.code, item.severity, item.status, item.message, item.sectionId, now)
    })()
    return (this.db.prepare('SELECT * FROM writing_review_items WHERE project_id = ? ORDER BY severity DESC, created_at ASC').all(projectId) as Row[]).map(writingReviewItemFrom)
  }

  updateWritingStatus(projectId: string, status: WritingProject['status']): void {
    this.db.prepare('UPDATE writing_projects SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), projectId)
  }

  snapshot(practiceRunId: string): PracticeSnapshot {
    const run = this.getPracticeRun(practiceRunId)
    return { run, events: this.listEvents(practiceRunId), artifacts: this.listArtifacts(practiceRunId), pathNodes: this.listPathNodes(practiceRunId), stageMemories: this.listStageMemories(practiceRunId), memories: this.listMemories(run.learnerId), tutorTurns: this.listTutorTurns(practiceRunId) }
  }
}
