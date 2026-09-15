import { createHash, randomUUID } from 'node:crypto'
import type { ProductRepository } from './product-repository.js'
import type { EnvironmentBuildOrchestrator } from './gym-build-service.js'
import { LabError } from './errors.js'
import type { GeneratedPracticeCard, PracticeCardGenerationInput, PracticeCardGenerator } from './practice-card-generator.js'
import type { AdoptedResearchSource, ResearchService } from './research-service.js'

type Row = Record<string, unknown>
type ActivityType = 'concept' | 'knowledge_check' | 'scenario_reasoning' | 'runtime_practice' | 'reflection'
type Activity = { id: string; type: ActivityType; title: string; prompt: string; options?: Array<{ value: string; label: string }>; required: boolean; core?: boolean }
type ActivityState = { answer: unknown; status: 'unanswered' | 'saved' | 'correct' | 'incorrect' | 'completed'; attempts: number; feedback?: string }
type StateDocument = { activities: Record<string, ActivityState>; runtimePracticeRunId?: string }
type SourceDigest = PracticeCardGenerationInput['sources'][number] & { sourceItemId: string; fetchedAt: string }
type PublicCardDocument = {
  title: string
  objective: string
  summary: string
  mode: 'knowledge_only' | 'mixed'
  activities: Activity[]
  sourceReferences: Array<{ id: string; title: string; author: string | null; canonicalUrl: string }>
  completionPolicy: { requiredActivityTypes: ActivityType[]; maxAttemptsPerActivity: number }
}

const now = () => new Date().toISOString()

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[\s,，。；;：:、/|()（）]+/).map((item) => item.trim()).filter((item) => item.length >= 2))]
}

export class MixedGymService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly builds: EnvironmentBuildOrchestrator,
    private readonly generator?: PracticeCardGenerator,
    private readonly sourceContent?: { fetchArticle(source: { externalId: string | null; url: string }): Promise<string> },
    private readonly research?: ResearchService,
  ) {}

  async createCard(learnerId: string, planUnitId: string, clientRequestId: string) {
    const byRequest = this.repository.db.prepare(
      'SELECT * FROM practice_cards WHERE learner_id=? AND plan_unit_id=? AND client_request_id=?',
    ).get(learnerId, planUnitId, clientRequestId) as Row | undefined
    if (byRequest) return this.publicCard(byRequest)

    const unit = this.planUnit(learnerId, planUnitId)
    const intent = this.cardIntent(learnerId, unit)
    const sourceSet: Array<{ id: string; title: string; author: string | null; canonicalUrl: string; relevance: number }> = []
    let digests: SourceDigest[] = []
    if (this.research) {
      // Completion plan P4.2: the server-driven research pipeline builds a
      // bounded candidate set and hands at most two de-identified source
      // digests to the generator. No adopted sources -> a pure route card.
      const outcome = await this.research.researchForCard(learnerId, {
        planUnitId: intent.planUnitId,
        objective: intent.objective,
        capabilityIds: intent.capabilityIds,
        learnerLevel: intent.learnerLevel,
        learnerGaps: intent.learnerGaps,
        roadmapNodeId: nullable(unit, 'roadmap_node_id'),
        sourceQuery: intent.sourceQuery,
      })
      digests = outcome.adopted.map((adopted) => this.digestFromResearch(adopted))
      sourceSet.push(...outcome.adopted.map((adopted) => ({
        id: adopted.sourceItemId ?? adopted.candidate.id,
        title: adopted.candidate.title,
        author: adopted.candidate.author,
        canonicalUrl: adopted.candidate.canonicalUrl,
        relevance: adopted.candidate.relevance,
      })))
    } else {
      const selectedSources = this.rankSources(learnerId, intent.sourceQuery.concepts).slice(0, 2)
      digests = await Promise.all(selectedSources.map((source) => this.digestFor(learnerId, source)))
      sourceSet.push(...selectedSources.map((source) => ({
        id: text(source, 'id'), title: text(source, 'title'), author: nullable(source, 'author'),
        canonicalUrl: text(source, 'url'), relevance: Number(source.relevance),
      })))
    }
    let generated: GeneratedPracticeCard | null = null
    if (this.generator) {
      try { generated = await this.generator.generate({ intent, sources: digests }) }
      catch { generated = null }
    }
    const activities = generated?.activities ?? this.activitiesFor(intent.preferredRuntime as 'mysql_lab' | 'docker_workspace' | 'none', intent.objective)
    const sourceReferences = sourceSet.map((source) => ({
      id: source.id, title: source.title, author: source.author, canonicalUrl: source.canonicalUrl,
    }))
    const publicDocument = {
      title: generated?.title ?? text(unit, 'title'), objective: intent.objective,
      summary: generated?.summary ?? (sourceReferences.length > 0 ? '结合路线目标与已筛选来源完成一次知行闭环。' : '未找到达到相关度阈值的来源，本卡按路线目标安全降级生成。'),
      mode: intent.preferredRuntime === 'none' ? 'knowledge_only' : 'mixed',
      activities,
      completionPolicy: { requiredActivityTypes: [...new Set(activities.filter((activity) => activity.required).map((activity) => activity.type))], maxAttemptsPerActivity: 2 },
      sourceReferences,
    }
    const privateDocument = generated ? {
      answerKey: generated.answerKey, hints: generated.hints, explanations: generated.explanations, references: generated.references,
    } : {
      answerKey: { 'knowledge-1': 'evidence-first', 'knowledge-2': 'boundary-first' },
      hints: {
        'knowledge-1': '先区分可观察证据与未经验证的推测。',
        'knowledge-2': '检查成立条件、失效边界和验证动作。',
      },
      explanations: {
        'knowledge-1': '可靠判断应先记录可复现证据，再选择改动。',
        'knowledge-2': '能说明边界条件的方案才具备迁移价值。',
      },
      references: { 'knowledge-1': 'evidence-first', 'knowledge-2': 'boundary-first' },
    }
    const sourceQuality = sourceSet.length > 0 ? Math.max(...sourceSet.map((source) => source.relevance)) : 0
    const version = Number((this.repository.db.prepare(
      'SELECT COALESCE(MAX(version),0)+1 AS value FROM practice_cards WHERE learner_id=? AND plan_unit_id=?',
    ).get(learnerId, planUnitId) as { value: number }).value)
    const id = randomUUID()
    const createdAt = now()

    this.repository.db.transaction(() => {
      this.repository.db.prepare(`
        INSERT INTO practice_cards(
          id,learner_id,plan_unit_id,intent_json,public_json,private_json,source_quality,status,version,
          client_request_id,created_at,ready_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,'ready',?,?,?,?,?)
      `).run(id, learnerId, planUnitId, JSON.stringify(intent), JSON.stringify(publicDocument), JSON.stringify(privateDocument), sourceQuality, version, clientRequestId, createdAt, createdAt, createdAt)
      // The new card row must exist before its id can be referenced as the
      // superseded_by of an older ready card (FK on practice_cards.superseded_by).
      this.repository.db.prepare(
        "UPDATE practice_cards SET status='superseded', superseded_by=?, updated_at=? WHERE learner_id=? AND plan_unit_id=? AND status='ready' AND id<>?",
      ).run(id, createdAt, learnerId, planUnitId, id)
      this.repository.db.prepare('UPDATE plan_units SET practice_card_id=? WHERE id=?').run(id, planUnitId)
      sourceSet.forEach((source, index) => {
        if (source.id) this.repository.db.prepare(
          'INSERT INTO practice_card_sources(practice_card_id,source_item_id,relevance,position,created_at) VALUES(?,?,?,?,?)',
        ).run(id, source.id, source.relevance, index + 1, createdAt)
      })
      this.appendCardEvent(id, learnerId, 'ready', { sourceCount: sourceSet.length, mode: publicDocument.mode, generatedBy: generated ? 'model' : 'safe_template' }, clientRequestId)
    })()
    return this.getCard(learnerId, id)
  }

  cardForUnit(learnerId: string, planUnitId: string) {
    const row = this.repository.db.prepare(
      "SELECT * FROM practice_cards WHERE learner_id=? AND plan_unit_id=? AND status IN ('generating','ready','failed') ORDER BY version DESC LIMIT 1",
    ).get(learnerId, planUnitId) as Row | undefined
    if (!row) throw new LabError('practice_card_not_found', 'Practice Card 尚未生成', 404)
    return this.publicCard(row)
  }

  getCard(learnerId: string, id: string) { return this.publicCard(this.card(learnerId, id)) }

  async retryCard(learnerId: string, id: string, clientRequestId: string) {
    const row = this.card(learnerId, id)
    if (row.status !== 'failed') return this.publicCard(row)
    return this.createCard(learnerId, text(row, 'plan_unit_id'), clientRequestId)
  }

  cardEvents(learnerId: string, id: string, afterSequence = 0) {
    this.card(learnerId, id)
    const rows = this.repository.db.prepare(
      'SELECT id,sequence,type,payload_json,created_at FROM practice_card_events WHERE practice_card_id=? AND sequence>? ORDER BY sequence LIMIT 100',
    ).all(id, afterSequence) as Row[]
    const events = rows.map((row) => ({ id: text(row, 'id'), sequence: Number(row.sequence), type: text(row, 'type'), summary: this.eventSummary(text(row, 'type'), json(row.payload_json, {})), createdAt: text(row, 'created_at') }))
    return { events, nextSequence: events.at(-1)?.sequence ?? afterSequence }
  }

  startSession(learnerId: string, practiceCardId: string, clientRequestId: string) {
    const card = this.card(learnerId, practiceCardId)
    if (card.status !== 'ready') throw new LabError('practice_card_unavailable', 'Practice Card 不可用', 409)
    const active = this.repository.db.prepare(
      "SELECT id FROM gym_sessions WHERE learner_id=? AND practice_card_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",
    ).get(learnerId, practiceCardId) as { id: string } | undefined
    if (active) return this.session(learnerId, active.id)
    const replay = this.repository.db.prepare(
      'SELECT id FROM gym_sessions WHERE learner_id=? AND practice_card_id=? AND client_request_id=?',
    ).get(learnerId, practiceCardId, clientRequestId) as { id: string } | undefined
    if (replay) return this.session(learnerId, replay.id)

    const activities = json<{ activities: Activity[] }>(card.public_json, { activities: [] }).activities
    const state: StateDocument = { activities: Object.fromEntries(activities.map((activity) => [activity.id, { answer: null, status: activity.type === 'concept' ? 'completed' : 'unanswered', attempts: 0 }])) }
    const id = randomUUID()
    const createdAt = now()
    this.repository.db.prepare(`
      INSERT INTO gym_sessions(id,learner_id,practice_card_id,status,stage,activity_state_json,client_request_id,created_at,updated_at)
      VALUES(?,?,?,'active','orienting',?,?,?,?)
    `).run(id, learnerId, practiceCardId, JSON.stringify(state), clientRequestId, createdAt, createdAt)
    this.appendSessionEvent(id, 'stage', { stage: 'orienting' }, clientRequestId)
    return this.session(learnerId, id)
  }

  session(learnerId: string, id: string) {
    const row = this.sessionRow(learnerId, id)
    const card = json<{ activities: Activity[] }>(row.public_json, { activities: [] })
    const state = json<StateDocument>(row.activity_state_json, { activities: {} })
    const activities = card.activities
    const activityStates = activities.map((activity) => ({ activityId: activity.id, ...(state.activities[activity.id] ?? { answer: null, status: 'unanswered', attempts: 0 }) }))
    const runtime = this.runtimeState(learnerId, row, activities)
    const reflectionActivity = activities.find((activity) => activity.type === 'reflection')
    const completed = activityStates.filter((activity) => ['correct', 'completed'].includes(activity.status)).length
    const current = activities.find((activity) => !['correct', 'completed'].includes(state.activities[activity.id]?.status ?? 'unanswered'))
    return {
      id: text(row, 'id'), practiceCardId: text(row, 'practice_card_id'), stage: text(row, 'stage'), outcome: nullable(row, 'outcome'),
      activities, activityStates, currentActivityId: current?.id ?? null,
      attemptsRemaining: current ? Math.max(0, 2 - (state.activities[current.id]?.attempts ?? 0)) : 0,
      runtime, reflection: !reflectionActivity || state.activities[reflectionActivity.id]?.answer == null ? null : String(state.activities[reflectionActivity.id].answer),
      progress: { completed, total: activities.length }, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  sessionEvents(learnerId: string, id: string, afterSequence = 0) {
    this.sessionRow(learnerId, id)
    const rows = this.repository.db.prepare(
      'SELECT id,sequence,type,payload_json,created_at FROM gym_session_events WHERE gym_session_id=? AND sequence>? ORDER BY sequence LIMIT 100',
    ).all(id, afterSequence) as Row[]
    const events = rows.map((row) => ({ id: text(row, 'id'), sequence: Number(row.sequence), type: text(row, 'type'), summary: this.eventSummary(text(row, 'type'), json(row.payload_json, {})), createdAt: text(row, 'created_at') }))
    return { events, nextSequence: events.at(-1)?.sequence ?? afterSequence }
  }

  draft(learnerId: string, sessionId: string, activityId: string, answer: unknown, clientRequestId: string) {
    const row = this.sessionRow(learnerId, sessionId)
    const answerHash = createHash('sha256').update(JSON.stringify(answer) ?? 'undefined').digest('hex')
    const replay = this.repository.db.prepare(
      "SELECT payload_json FROM gym_session_events WHERE gym_session_id=? AND client_request_id=? AND type='answer_saved'",
    ).get(sessionId, clientRequestId) as { payload_json: string } | undefined
    if (replay) {
      const payload = json<{ activityId?: string; answerHash?: string }>(replay.payload_json, {})
      if (payload.activityId !== activityId || payload.answerHash !== answerHash) throw new LabError('idempotency_conflict', '同一幂等键不能用于不同答案', 409)
      return this.session(learnerId, sessionId)
    }
    if (row.status !== 'active') throw new LabError('gym_session_closed', 'Gym Session 已结束', 409)
    const activity = this.activity(row, activityId)
    if (!['knowledge_check', 'scenario_reasoning'].includes(activity.type)) throw new LabError('activity_not_answerable', '该活动不接受答案保存', 409)
    const state = json<StateDocument>(row.activity_state_json, { activities: {} })
    state.activities[activityId] = { ...(state.activities[activityId] ?? { status: 'unanswered', attempts: 0 }), answer, status: 'saved' }
    this.repository.db.prepare("UPDATE gym_sessions SET activity_state_json=?,stage='checking',updated_at=? WHERE id=?").run(JSON.stringify(state), now(), sessionId)
    this.appendSessionEvent(sessionId, 'answer_saved', { activityId, answerHash }, clientRequestId)
    return this.session(learnerId, sessionId)
  }

  submitActivity(learnerId: string, sessionId: string, activityId: string, clientRequestId: string) {
    const row = this.activeSession(learnerId, sessionId)
    const replay = this.repository.db.prepare(
      'SELECT result_json FROM gym_activity_attempts WHERE gym_session_id=? AND client_request_id=?',
    ).get(sessionId, clientRequestId) as { result_json: string } | undefined
    if (replay) return { ...json(replay.result_json, {}), session: this.session(learnerId, sessionId) }
    const activity = this.activity(row, activityId)
    if (!['knowledge_check', 'scenario_reasoning'].includes(activity.type)) throw new LabError('activity_not_submittable', '该活动不能正式提交', 409)
    const state = json<StateDocument>(row.activity_state_json, { activities: {} })
    const activityState = state.activities[activityId]
    if (!activityState || activityState.answer == null || String(activityState.answer).trim() === '') throw new LabError('answer_required', '请先保存答案', 400)
    if (activityState.attempts >= 2) throw new LabError('attempt_limit', '每道核心题最多两次正式提交', 409)

    const privateCard = json<{ answerKey: Record<string, unknown>; hints: Record<string, string>; explanations: Record<string, string>; references: Record<string, unknown> }>(row.private_json, { answerKey: {}, hints: {}, explanations: {}, references: {} })
    const correct = activity.type === 'scenario_reasoning' ? true : String(activityState.answer) === String(privateCard.answerKey[activityId])
    const attemptNo = activityState.attempts + 1
    const feedback = correct ? '回答已通过，可以继续。' : attemptNo === 1 ? privateCard.hints[activityId] ?? '请检查条件与证据。' : privateCard.explanations[activityId] ?? '请重新梳理条件、证据与结论。'
    const result = {
      activityId, result: correct ? 'correct' : 'incorrect', feedback,
      attemptsRemaining: Math.max(0, 2 - attemptNo), nextActivityId: null as string | null,
      ...(correct || attemptNo < 2 ? {} : { referenceAnswer: privateCard.references[activityId] }),
    }
    activityState.attempts = attemptNo
    activityState.status = correct ? (activity.type === 'scenario_reasoning' ? 'completed' : 'correct') : 'incorrect'
    activityState.feedback = feedback
    const createdAt = now()
    this.repository.db.transaction(() => {
      this.repository.db.prepare(`
        INSERT INTO gym_activity_attempts(id,gym_session_id,activity_key,attempt_no,answer_json,result_json,status,client_request_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(randomUUID(), sessionId, activityId, attemptNo, JSON.stringify(activityState.answer), JSON.stringify(result), correct ? 'passed' : 'needs_review', clientRequestId, createdAt, createdAt)
      this.repository.db.prepare("UPDATE gym_sessions SET activity_state_json=?,stage='checking',updated_at=? WHERE id=?").run(JSON.stringify(state), createdAt, sessionId)
      this.appendSessionEvent(sessionId, 'answer_submitted', { activityId, attemptNo, result: result.result }, clientRequestId)
    })()
    const session = this.session(learnerId, sessionId)
    result.nextActivityId = session.currentActivityId
    return { ...result, session }
  }

  async startRuntime(learnerId: string, sessionId: string, clientRequestId: string) {
    const row = this.activeSession(learnerId, sessionId)
    const activities = json<{ activities: Activity[] }>(row.public_json, { activities: [] }).activities
    if (!activities.some((activity) => activity.type === 'runtime_practice')) throw new LabError('runtime_not_required', '该卡片不需要运行时环境', 409)
    let buildId = nullable(row, 'gym_build_job_id')
    if (!buildId) {
      const build = this.builds.create(learnerId, text(row, 'plan_id'), text(row, 'plan_unit_id'), `mixed-gym:${sessionId}`)
      buildId = build.job.id
      this.repository.db.prepare(
        "UPDATE gym_sessions SET gym_build_job_id=?,learning_case_id=?,stage='preparing_runtime',updated_at=? WHERE id=?",
      ).run(buildId, build.job.learningCaseId, now(), sessionId)
    }
    const build = this.builds.get(learnerId, buildId)
    if (build.job.status === 'ready') {
      await this.builds.start(learnerId, buildId)
      const current = this.latestPracticeRun(learnerId, text(row, 'plan_unit_id'))
      const state = json<StateDocument>(row.activity_state_json, { activities: {} })
      if (current) state.runtimePracticeRunId = text(current, 'id')
      this.repository.db.prepare("UPDATE gym_sessions SET activity_state_json=?,stage='practicing',updated_at=? WHERE id=?").run(JSON.stringify(state), now(), sessionId)
    }
    this.appendSessionEvent(sessionId, 'runtime', { status: build.job.status }, clientRequestId)
    return this.session(learnerId, sessionId)
  }

  complete(learnerId: string, sessionId: string, reflection: unknown, clientRequestId: string) {
    const row = this.sessionRow(learnerId, sessionId)
    const existingEvent = this.repository.db.prepare(
      "SELECT 1 FROM gym_session_events WHERE gym_session_id=? AND client_request_id=? AND type='completed'",
    ).get(sessionId, clientRequestId)
    if (existingEvent) return { session: this.session(learnerId, sessionId), outcome: nullable(row, 'outcome') }
    if (row.status !== 'active') throw new LabError('gym_session_closed', 'Gym Session 已结束', 409)
    const activities = json<{ activities: Activity[] }>(row.public_json, { activities: [] }).activities
    const state = json<StateDocument>(row.activity_state_json, { activities: {} })
    const reflectionText = typeof reflection === 'string' ? reflection.trim() : ''
    const reflectionComplete = reflectionText.length >= 12
    const reflectionActivity = activities.find((activity) => activity.type === 'reflection')
    if (!reflectionActivity) throw new LabError('practice_card_contract_invalid', 'Practice Card 缺少反思活动', 409)
    state.activities[reflectionActivity.id] = { answer: reflectionText, attempts: reflectionComplete ? 1 : 0, status: reflectionComplete ? 'completed' : 'unanswered', feedback: reflectionComplete ? '反思已记录。' : '请补充具体判断与下一步验证。' }
    const knowledge = activities.filter((activity) => activity.type === 'knowledge_check' && activity.core !== false)
    const allKnowledgeAttempted = knowledge.every((activity) => (state.activities[activity.id]?.attempts ?? 0) > 0)
    const knowledgePassed = knowledge.every((activity) => state.activities[activity.id]?.status === 'correct')
    const scenariosComplete = activities.filter((activity) => activity.type === 'scenario_reasoning' && activity.required).every((activity) => state.activities[activity.id]?.status === 'completed')
    const runtimeRequired = activities.some((activity) => activity.type === 'runtime_practice' && activity.required)
    const runtimePractice = state.runtimePracticeRunId ? this.practiceRun(learnerId, state.runtimePracticeRunId, text(row, 'plan_unit_id')) : null
    const runtimeVerified = !runtimeRequired || runtimePractice?.status === 'resolved'
    const allActivitiesComplete = allKnowledgeAttempted && scenariosComplete && reflectionComplete && (!runtimeRequired || Boolean(runtimePractice))
    const outcome = allActivitiesComplete ? (knowledgePassed && runtimeVerified && reflectionComplete ? 'verified' : 'completed_with_gaps') : 'incomplete'
    const completedAt = now()
    this.repository.db.transaction(() => {
      this.repository.db.prepare(
        "UPDATE gym_sessions SET status='completed',stage='completed',outcome=?,activity_state_json=?,completed_at=?,updated_at=? WHERE id=?",
      ).run(outcome, JSON.stringify(state), completedAt, completedAt, sessionId)
      if (outcome !== 'incomplete') {
        this.repository.db.prepare("UPDATE plan_units SET status='completed',completed_at=? WHERE id=?").run(completedAt, row.plan_unit_id)
        if (row.roadmap_id && row.roadmap_node_id) this.repository.db.prepare(`
          UPDATE roadmap_node_progress SET status=?,source='mixed_gym',completed_at=COALESCE(completed_at,?),verified_at=?,revision=revision+1,updated_at=?
          WHERE roadmap_id=? AND node_id=?
        `).run(outcome === 'verified' ? 'verified' : 'completed', completedAt, outcome === 'verified' ? completedAt : null, completedAt, row.roadmap_id, row.roadmap_node_id)
      }
      this.writeProfileEvidence(learnerId, sessionId, text(row, 'title'), knowledgePassed, runtimeVerified, reflectionComplete, outcome)
      this.appendSessionEvent(sessionId, 'completed', { outcome }, clientRequestId)
    })()
    return { session: this.session(learnerId, sessionId), outcome }
  }

  private cardIntent(learnerId: string, unit: Row) {
    const summary = this.repository.db.prepare(
      "SELECT summary_json FROM learner_profile_snapshots WHERE learner_id=? AND status='current' ORDER BY version DESC LIMIT 1",
    ).get(learnerId) as { summary_json: string } | undefined
    const profile = json<Record<string, unknown>>(summary?.summary_json, {})
    const preferredRuntime: 'mysql_lab' | 'docker_workspace' | 'none' = unit.learning_mode === 'lab' ? 'mysql_lab' : unit.learning_mode === 'workspace' ? 'docker_workspace' : 'none'
    return {
      planUnitId: text(unit, 'id'), objective: text(unit, 'objective'),
      capabilityIds: [nullable(unit, 'capability_key') ?? text(unit, 'title')],
      learnerLevel: typeof profile.level === 'string' ? profile.level : 'unknown',
      learnerGaps: Array.isArray(profile.gaps) ? profile.gaps.filter((item): item is string => typeof item === 'string').slice(0, 8) : [],
      completionStandard: nullable(unit, 'completion_standard') ?? text(unit, 'objective'),
      preferredRuntime, estimatedMinutes: Number(unit.estimated_minutes ?? 60),
      sourceQuery: { concepts: terms(`${unit.title} ${unit.objective}`).slice(0, 8), scenarios: [], exclusions: [] },
    }
  }

  private activitiesFor(runtime: 'mysql_lab' | 'docker_workspace' | 'none', objective: string): Activity[] {
    return [
      { id: 'concept', type: 'concept', title: '建立判断框架', prompt: `围绕“${objective}”，先明确要观察的现象、证据与边界。`, required: true },
      { id: 'knowledge-1', type: 'knowledge_check', title: '证据优先', prompt: '面对异常时，哪种做法更可靠？', options: [{ value: 'evidence-first', label: '先收集可复现证据，再决定改动' }, { value: 'change-first', label: '先修改配置，再寻找解释' }], required: true, core: true },
      { id: 'knowledge-2', type: 'knowledge_check', title: '边界意识', prompt: '一个可迁移的结论首先需要什么？', options: [{ value: 'boundary-first', label: '明确成立条件、失效边界与验证方法' }, { value: 'memorize', label: '记住一次成功操作即可' }], required: true, core: true },
      { id: 'scenario', type: 'scenario_reasoning', title: '实践前预测', prompt: '写下你预计会观察到的证据，以及什么结果会推翻当前判断。', required: true },
      ...(runtime === 'none' ? [] : [{ id: 'runtime', type: 'runtime_practice' as const, title: runtime === 'mysql_lab' ? 'MySQL 实践' : 'Python 实践', prompt: '在服务端受控环境完成任务，并由 Verifier 独立判定。', required: true }]),
      { id: 'reflection', type: 'reflection', title: '反思与迁移', prompt: '说明判断发生了什么变化，以及下一次你会先验证什么。', required: true },
    ]
  }

  private rankSources(learnerId: string, concepts: string[]) {
    const rows = this.repository.db.prepare(`
      SELECT i.*, GROUP_CONCAT(DISTINCT c.kind) AS collection_kinds
      FROM learner_source_items i
      LEFT JOIN external_source_collection_items ci ON ci.source_item_id=i.id
      LEFT JOIN external_source_collections c ON c.id=ci.collection_id
      WHERE i.learner_id=? AND i.status='active'
      GROUP BY i.id ORDER BY i.updated_at DESC LIMIT 80
    `).all(learnerId) as Row[]
    return rows.map((row) => {
      const haystack = `${row.title ?? ''} ${row.excerpt ?? ''}`.toLowerCase()
      const overlap = concepts.length === 0 ? 0 : concepts.filter((term) => haystack.includes(term)).length / concepts.length
      const kinds = String(row.collection_kinds ?? '')
      const sourceWeight = kinds.includes('favorites') ? 0.18 : kinds.includes('own') ? 0.12 : kinds.includes('activities') ? 0.08 : 0.04
      const quality = Math.min(0.14, String(row.excerpt ?? '').length / 4000)
      return { ...row, relevance: Math.min(1, overlap * 0.8 + sourceWeight + quality) }
    }).filter((row) => Number(row.relevance) >= 0.65).sort((a, b) => Number(b.relevance) - Number(a.relevance))
  }

  private digestFromResearch(adopted: AdoptedResearchSource): SourceDigest {
    const digest = adopted.digest
    return {
      sourceItemId: adopted.sourceItemId ?? adopted.candidate.id,
      title: digest.title, author: digest.author, canonicalUrl: digest.url,
      summary: digest.excerpt,
      usefulClaims: digest.summary ? [{ claim: digest.summary.slice(0, 240), sourceAnchor: digest.url }] : [],
      practicalPatterns: [],
      cautions: ['该来源仅作为参考证据，需要通过知识题或运行时实践验证。'],
      fetchedAt: digest.fetchedAt,
    }
  }

  private async digestFor(learnerId: string, source: Row): Promise<SourceDigest> {
    let material = text(source, 'excerpt')
    if (this.sourceContent) {
      try { material = await this.sourceContent.fetchArticle({ externalId: nullable(source, 'external_id'), url: text(source, 'url') }) }
      catch { /* A source fetch failure must not block a route-derived card. */ }
    }
    const excerpt = material
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200)
    const digest: SourceDigest = {
      sourceItemId: text(source, 'id'), title: text(source, 'title'), author: nullable(source, 'author'), canonicalUrl: text(source, 'url'),
      summary: excerpt, usefulClaims: excerpt ? [{ claim: excerpt.slice(0, 240), sourceAnchor: 'synced_excerpt' }] : [],
      practicalPatterns: [], cautions: ['知乎内容仅作为参考证据，需要通过知识题或运行时实践验证。'], fetchedAt: now(),
    }
    this.repository.db.prepare(`
      INSERT INTO source_digests(id,learner_id,source_item_id,digest_json,quality,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(learner_id,source_item_id) DO UPDATE SET digest_json=excluded.digest_json,quality=excluded.quality,updated_at=excluded.updated_at
    `).run(randomUUID(), learnerId, source.id, JSON.stringify(digest), source.relevance, now(), now())
    return digest
  }

  private runtimeState(learnerId: string, row: Row, activities: Activity[]) {
    if (!activities.some((activity) => activity.type === 'runtime_practice')) return null
    const state = json<StateDocument>(row.activity_state_json, { activities: {} })
    const practice = state.runtimePracticeRunId ? this.practiceRun(learnerId, state.runtimePracticeRunId, text(row, 'plan_unit_id')) : null
    if (practice) {
      const kind = text(practice, 'practice_kind') === 'code_workspace' ? 'docker_workspace' as const : 'mysql_lab' as const
      const workspace = kind === 'docker_workspace' ? this.repository.db.prepare(
        "SELECT id FROM workspace_runs WHERE learner_id=? AND practice_run_id=? AND status IN ('provisioning','active','executing') ORDER BY updated_at DESC LIMIT 1",
      ).get(learnerId, practice.id) as { id: string } | undefined : undefined
      return {
        status: practice.status === 'resolved' ? 'completed' as const : 'active' as const,
        label: practice.status === 'resolved' ? 'Verifier 已通过' : '实践环境运行中',
        kind, practiceRunId: text(practice, 'id'), workspaceRunId: workspace?.id ?? null,
      }
    }
    const buildId = nullable(row, 'gym_build_job_id')
    if (!buildId) return { status: 'not_started' }
    const build = this.builds.get(learnerId, buildId)
    if (build.job.status === 'ready') return { status: 'ready', label: '环境已就绪，可以启动实践实例' }
    return { status: 'starting', label: build.failure?.message ?? build.job.currentPhase ?? build.job.status }
  }

  private latestPracticeRun(learnerId: string, planUnitId: string, resolvedOnly = false): Row | null {
    const suffix = resolvedOnly ? "AND status='resolved'" : "AND status IN ('active','ready_to_close','resolved')"
    return this.repository.db.prepare(`
      SELECT * FROM practice_runs WHERE learner_id=? AND plan_unit_id=? ${suffix} ORDER BY updated_at DESC LIMIT 1
    `).get(learnerId, planUnitId) as Row | undefined ?? null
  }

  private practiceRun(learnerId: string, id: string, planUnitId: string): Row | null {
    return this.repository.db.prepare(
      'SELECT * FROM practice_runs WHERE id=? AND learner_id=? AND plan_unit_id=?',
    ).get(id, learnerId, planUnitId) as Row | undefined ?? null
  }

  private writeProfileEvidence(learnerId: string, sessionId: string, topic: string, knowledge: boolean, runtime: boolean, reflection: boolean, outcome: string): void {
    const snapshot = this.repository.db.prepare(
      "SELECT id FROM learner_profile_snapshots WHERE learner_id=? AND status='current' ORDER BY version DESC LIMIT 1",
    ).get(learnerId) as { id: string } | undefined
    const evidence = [
      ['gym_knowledge', knowledge ? '核心知识题已通过。' : '核心知识仍有缺口，需要后续复习卡验证。'],
      ['gym_runtime', runtime ? '运行时任务已经服务端 Verifier 验证。' : '运行时能力尚未得到独立验证。'],
      ['gym_reflection', reflection ? '已记录包含判断变化和下一步验证的反思。' : '反思证据不足。'],
    ] as const
    for (const [sourceType, content] of evidence) {
      this.repository.db.prepare('INSERT INTO gym_profile_evidence(id,learner_id,gym_session_id,evidence_key,content,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), learnerId, sessionId, sourceType, content, now())
      if (snapshot) this.repository.db.prepare('INSERT INTO learner_profile_evidence(id,snapshot_id,topic_key,source_type,source_id,excerpt,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), snapshot.id, topic, sourceType, sessionId, `${content} 结果：${outcome}`, now())
    }
  }

  private publicCard(row: Row) {
    const document = json<PublicCardDocument>(row.public_json, {
      title: '', objective: '', summary: '', mode: 'knowledge_only', activities: [], sourceReferences: [],
      completionPolicy: { requiredActivityTypes: [], maxAttemptsPerActivity: 2 },
    })
    return {
      id: text(row, 'id'), planUnitId: text(row, 'plan_unit_id'), title: document.title, objective: document.objective,
      summary: document.summary, mode: document.mode, activities: document.activities,
      sourceReferences: document.sourceReferences ?? [], completionPolicy: document.completionPolicy,
      status: row.status, version: Number(row.version), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  private planUnit(learnerId: string, id: string): Row {
    const row = this.repository.db.prepare(`
      SELECT u.*,p.learner_id,p.id plan_id,p.roadmap_id,n.capability_key,n.completion_standard
      FROM plan_units u JOIN learning_plans p ON p.id=u.plan_id
      LEFT JOIN roadmap_nodes n ON n.id=u.roadmap_node_id
      WHERE u.id=? AND p.learner_id=?
    `).get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('plan_unit_not_found', '学习单元不存在', 404)
    return row
  }

  private card(learnerId: string, id: string): Row {
    const row = this.repository.db.prepare('SELECT * FROM practice_cards WHERE id=? AND learner_id=?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('practice_card_not_found', 'Practice Card 不存在', 404)
    return row
  }

  private sessionRow(learnerId: string, id: string): Row {
    const row = this.repository.db.prepare(`
      SELECT s.*,c.public_json,c.private_json,c.plan_unit_id,u.plan_id,u.roadmap_node_id,p.roadmap_id,u.title
      FROM gym_sessions s JOIN practice_cards c ON c.id=s.practice_card_id
      JOIN plan_units u ON u.id=c.plan_unit_id JOIN learning_plans p ON p.id=u.plan_id
      WHERE s.id=? AND s.learner_id=?
    `).get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('gym_session_not_found', 'Gym Session 不存在', 404)
    return row
  }

  private activeSession(learnerId: string, id: string): Row {
    const row = this.sessionRow(learnerId, id)
    if (row.status !== 'active') throw new LabError('gym_session_closed', 'Gym Session 已结束', 409)
    return row
  }

  private activity(row: Row, id: string): Activity {
    const activity = json<{ activities: Activity[] }>(row.public_json, { activities: [] }).activities.find((item) => item.id === id)
    if (!activity) throw new LabError('activity_not_found', '活动不存在', 404)
    return activity
  }

  private appendCardEvent(cardId: string, learnerId: string, type: string, payload: Record<string, unknown>, clientRequestId: string): void {
    const sequence = Number((this.repository.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 value FROM practice_card_events WHERE practice_card_id=?').get(cardId) as { value: number }).value)
    this.repository.db.prepare('INSERT OR IGNORE INTO practice_card_events(id,practice_card_id,learner_id,sequence,type,payload_json,client_request_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), cardId, learnerId, sequence, type, JSON.stringify(payload), clientRequestId, now())
  }

  private appendSessionEvent(sessionId: string, type: string, payload: Record<string, unknown>, clientRequestId: string): void {
    const sequence = Number((this.repository.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 value FROM gym_session_events WHERE gym_session_id=?').get(sessionId) as { value: number }).value)
    this.repository.db.prepare('INSERT OR IGNORE INTO gym_session_events(id,gym_session_id,sequence,type,payload_json,client_request_id,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), sessionId, sequence, type, JSON.stringify(payload), clientRequestId, now())
  }

  private eventSummary(type: string, payload: Record<string, unknown>): string {
    if (type === 'ready') return `Practice Card 已生成，采用 ${Number(payload.sourceCount ?? 0)} 个来源。`
    if (type === 'answer_saved') return '答案草稿已保存。'
    if (type === 'answer_submitted') return `第 ${Number(payload.attemptNo ?? 1)} 次正式提交已完成。`
    if (type === 'runtime') return '运行时状态已更新。'
    if (type === 'completed') return `Gym 已完成：${String(payload.outcome ?? 'incomplete')}`
    return '学习状态已更新。'
  }
}
