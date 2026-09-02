import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import type { LabConfig } from '../src/config.js'
import type { LabScheduler } from '../src/scheduler.js'
import type { WritingClusterKey } from '../src/product-types.js'
import { TutorEngine } from '../src/tutor.js'
import { PracticeService } from '../src/practice-service.js'
import { CurationService } from '../src/curation-service.js'
import { WritingConflictError, WritingNotFoundError, WritingService } from '../src/writing-service.js'
import { WritingAgentError, type WritingAgentDraft, type WritingAgentProvider } from '../src/writing-agent.js'

function withRepository<T>(callback: (repository: ProductRepository) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-product-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  try { return callback(repository) } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

async function withRepositoryAsync<T>(callback: (repository: ProductRepository) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-product-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  try { return await callback(repository) } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

function agentDraft(evidenceRef: string): WritingAgentDraft {
  const keys = ['context', 'symptom', 'hypothesis', 'evidence', 'attempts', 'solution', 'verification', 'principles', 'boundaries', 'reproduction']
  return { title: 'MySQL 慢查询实践', summary: '基于冻结证据包生成的可编辑写作草稿。', sections: keys.map((sectionKey) => ({ sectionKey, title: sectionKey, content: `基于证据 ${evidenceRef} 的记录。`, required: true, evidenceRefs: [evidenceRef], sourceRefs: [] })), claims: [{ sectionKey: 'evidence', text: '本次实验记录了可回放的执行证据。', kind: 'observed', evidenceRefs: [evidenceRef], sourceRefs: [] }] }
}

describe('product repository', () => {
  it('creates an anonymous learner before reserving a Lab run', () => withRepositoryAsync(async (repository) => {
    const scheduler = {
      createRun: vi.fn(async () => ({ kind: 'started' as const, run: { runId: 'lab-1', caseId: 'mysql-order-list-index-001' as const, revision: 1, status: 'active' as const, fixtureVersion: '2026-08-28.1', expiresAt: new Date(Date.now() + 60_000).toISOString(), idleExpiresAt: new Date(Date.now() + 60_000).toISOString(), sessions: [] }, accessToken: 'token-1' })),
      release: vi.fn(async () => undefined),
      cancelTicket: vi.fn(),
    } as unknown as LabScheduler
    const service = new PracticeService(repository, scheduler, new TutorEngine({} as LabConfig))
    const result = await service.startPractice({ learnerId: 'anonymous-first-visit', caseId: 'mysql-order-list-index-001' })
    expect(result.practice.learnerId).toBe('anonymous-first-visit')
    expect(result.lab?.run.runId).toBe('lab-1')
    expect(scheduler.release).not.toHaveBeenCalled()
  }))

  it('applies a plan and keeps ordered units', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const intake = repository.createIntake({ learnerId: 'learner-1', goal: '学习 MySQL 慢查询', technology: 'MySQL 8' })
    const plan = repository.createPlan({ learnerId: 'learner-1', intakeId: intake.id, title: 'MySQL route', goal: intake.goal, sourceStatus: 'local_catalog', units: [
      { position: 1, title: '观察', objective: '建立证据意识', caseId: null, status: 'current', sourceRefs: [] },
      { position: 2, title: '慢查询', objective: '验证索引', caseId: 'mysql-order-list-index-001', status: 'upcoming', sourceRefs: [] },
    ] })
    expect(plan.units.map((unit) => unit.position)).toEqual([1, 2])
    expect(repository.getIntake(intake.id).status).toBe('planned')
  }))

  it('deduplicates events inside the transactional write', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const input = { learnerId: run.learnerId, practiceRunId: run.id, actor: 'user' as const, type: 'user_message' as const, stage: 'observe' as const, payload: { message: 'same' }, clientRequestId: 'request-1' }
    const first = repository.appendEvent(input)
    const second = repository.appendEvent(input)
    expect(second.id).toBe(first.id)
    expect(repository.listEvents(run.id)).toHaveLength(1)
    expect(repository.listEvents(run.id)[0]?.sequence).toBe(1)
  }))

  it('persists practice pins, resolves source content server-side, and keeps them scoped', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const tutorReply = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'tutor_reply', sourceKind: 'tutor', verificationStatus: 'model_generated', content: '先观察 EXPLAIN 的扫描类型。', metadata: {} })
    const source = repository.saveSource({ provider: 'zhihu', externalId: 'pin-source-1', title: 'EXPLAIN 参考', author: '作者', url: 'https://www.zhihu.com/question/1', excerpt: '用于理解扫描类型。', query: 'MySQL EXPLAIN', retrievedAt: new Date().toISOString(), metadata: {} })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'tutor_reply', sourceKind: 'tutor', verificationStatus: 'model_generated', content: '来源说明。', metadata: { sourceRefs: [{ sourceId: source.id }] } })

    const service = new PracticeService(repository, {} as LabScheduler, new TutorEngine({} as LabConfig))
    const artifactPin = service.createPin('learner-1', run.id, { targetType: 'artifact', targetId: tutorReply.id })
    const duplicatePin = service.createPin('learner-1', run.id, { targetType: 'artifact', targetId: tutorReply.id })
    const sourcePin = service.createPin('learner-1', run.id, { targetType: 'source', targetId: source.id })

    expect(duplicatePin.id).toBe(artifactPin.id)
    expect(sourcePin.body).toBe(source.excerpt)
    expect(sourcePin.url).toBe(source.url)
    expect(repository.snapshot(run.id).pins.map((pin) => pin.id)).toEqual([sourcePin.id, artifactPin.id])
    expect(() => service.createPin('learner-2', run.id, { targetType: 'artifact', targetId: tutorReply.id })).toThrow('无权访问该实践')

    const plan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM practice_pins WHERE practice_run_id = ? ORDER BY created_at DESC').all(run.id) as Array<{ detail: string }>
    expect(plan.some((row) => row.detail.includes('idx_practice_pins_run_created'))).toBe(true)
    const timestampPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT MAX(created_at) AS created_at FROM practice_pins WHERE practice_run_id = ?').all(run.id) as Array<{ detail: string }>
    expect(timestampPlan.some((row) => row.detail.includes('idx_practice_pins_run_created'))).toBe(true)
    service.deletePin('learner-1', run.id, artifactPin.id)
    expect(repository.snapshot(run.id).pins.map((pin) => pin.id)).toEqual([sourcePin.id])
  }))

  it('keeps current stage memory separate from long-term memory', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    repository.upsertStageMemory({ practiceRunId: run.id, stage: 'observe', memory: { currentGap: 'EXPLAIN' }, sourceEventRefs: [] })
    const memory = repository.upsertMemory({ learnerId: 'learner-1', category: 'gap', topic: 'explain', status: 'active', statement: '还不能稳定解释执行计划', scope: run.caseId, confidence: 0.8, evidenceRefs: [], userNote: null })
    expect(repository.listStageMemories(run.id)[0]?.memory.currentGap).toBe('EXPLAIN')
    expect(repository.listMemories('learner-1')[0]?.id).toBe(memory.id)
  }))

  it('builds an evidence-backed writing project and protects document revisions', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const userMessage = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: '我认为应该先看 EXPLAIN，再判断是不是索引问题。' })
    const explain = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'id | type | key | rows\n1 | ALL | NULL | 100000' })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'user_message', stage: 'observe', payload: { message: userMessage.content }, artifactRefs: [userMessage.id] })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'lab', type: 'evidence_captured', stage: 'inspect', payload: { artifactKind: 'explain' }, artifactRefs: [explain.id] })
    const source = repository.saveSource({ provider: 'zhihu', externalId: 'zhihu-1', title: 'EXPLAIN 参考', author: '作者', url: 'https://www.zhihu.com/question/1', excerpt: '用于理解执行计划字段。', query: 'MySQL EXPLAIN', retrievedAt: new Date().toISOString(), metadata: {} })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'tutor_reply', sourceKind: 'tutor', verificationStatus: 'model_generated', content: '参考这张卡片理解 EXPLAIN。', metadata: { sourceRefs: [{ sourceId: source.id }] } })

    const service = new WritingService(repository)
    const initialized = service.initialize(run.id)
    expect(initialized.materials.some((material) => material.refId === explain.id)).toBe(true)
    expect(initialized.materials.some((material) => material.refId === source.id)).toBe(true)
    const curation = service.curationOverview(run.id)
    expect(curation.clusters).toHaveLength(6)
    expect(curation.clusters.every((cluster) => cluster.status === 'pending')).toBe(true)
    expect(curation.clusters.every((cluster) => cluster.summaryStatus === 'model_failed')).toBe(true)
    for (const key of ['problem', 'evidence', 'solution'] as const) {
      const cluster = curation.clusters.find((item) => item.clusterKey === key)!
      service.updateCuration(run.id, cluster.id, cluster.revision, 'accepted')
    }

    const outlined = service.generateOutline(run.id)
    const outline = outlined.documents.find((document) => document.kind === 'outline')
    expect(outline?.sections).toHaveLength(11)
    expect(outlined.status).toBe('outline_review')
    const drafted = service.generateArticle(run.id)
    const article = drafted.documents.find((document) => document.kind === 'article')
    expect(article?.status).toBe('needs_review')
    expect(drafted.reviewItems.some((item) => item.code === 'practice_not_resolved')).toBe(true)

    repository.updatePracticeRun(run.id, { stage: 'resolved', status: 'resolved' })
    const reviewed = service.review(run.id)
    expect(reviewed.status).toBe('ready_for_preview')
    const section = reviewed.documents.find((document) => document.kind === 'article')?.sections[0]
    const document = reviewed.documents.find((item) => item.kind === 'article')
    expect(section && document).toBeTruthy()
    const updated = service.editSection(run.id, document!.id, section!.id, document!.revision, '用户确认后的背景。')
    expect(updated.documents.find((item) => item.kind === 'article')?.revision).toBe(document!.revision + 1)
    expect(() => service.editSection(run.id, document!.id, section!.id, document!.revision, '旧版本覆盖')).toThrow(WritingConflictError)
  }))

  it('folds duplicate evidence and keeps the default inspector focused', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'sql', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'EXPLAIN SELECT * FROM orders WHERE user_id = 4242', metadata: {} })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'sql', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'EXPLAIN SELECT * FROM orders WHERE user_id = 4242', metadata: {} })
    const service = new WritingService(repository)
    service.initialize(run.id)
    const overview = service.curationOverview(run.id)
    const attempts = overview.clusters.find((cluster) => cluster.clusterKey === 'attempts')!
    expect(attempts.duplicateCount).toBe(1)
    const detail = service.curationDetail(run.id, attempts.id, 'key')
    expect(detail.members).toHaveLength(1)
    expect(detail.members.every((member) => member.role !== 'duplicate')).toBe(true)
  }))

  it('refreshes stale curation when a practice gains new artifacts', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const service = new WritingService(repository)
    expect(service.curationOverview(run.id).clusters.find((cluster) => cluster.clusterKey === 'problem')?.memberCount).toBe(0)
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: '我想定位这条慢查询为什么走全表扫描。' })
    expect(service.curationOverview(run.id).clusters.find((cluster) => cluster.clusterKey === 'problem')?.memberCount).toBe(1)
  }))

  it('replays missing chat and SQL artifacts idempotently from practice events', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'system', type: 'case_presented', stage: 'observe', payload: { caseId: run.caseId, fixtureVersion: '2026-08-28.1' }, artifactRefs: [] })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'user_message', stage: 'observe', payload: { message: '我先看执行计划。' }, artifactRefs: [] })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'attempt_submitted', stage: 'attempt', payload: { statement: 'EXPLAIN SELECT * FROM orders WHERE user_id = 4242' }, artifactRefs: [] })
    repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'tutor', type: 'tutor_reply', stage: 'observe', payload: { response: '先观察 type、key 和 rows。', sourceRefs: [] }, artifactRefs: [] })

    const service = new WritingService(repository)
    service.replayCuration(run.id)
    const first = repository.snapshot(run.id)
    expect(first.artifacts.map((artifact) => artifact.kind).sort()).toEqual(['external_text', 'sql', 'tutor_reply', 'user_message'])
    service.replayCuration(run.id)
    expect(repository.snapshot(run.id).artifacts).toHaveLength(4)
    expect(service.curationOverview(run.id).clusters.find((cluster) => cluster.clusterKey === 'attempts')?.memberCount).toBe(1)
  }))

  it('keeps the representative SQL beside its matching EXPLAIN evidence', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const executionId = 'execution-1'
    const sql = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'sql', sourceKind: 'lab', verificationStatus: 'not_applicable', content: 'EXPLAIN SELECT * FROM orders WHERE user_id = 4242', metadata: { executionId } })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL key=NULL rows=100000', metadata: { executionId } })
    const service = new WritingService(repository)
    const overview = service.curationOverview(run.id)
    const evidence = overview.clusters.find((cluster) => cluster.clusterKey === 'evidence')!
    const detail = service.curationDetail(run.id, evidence.id, 'evidence')
    expect(detail.members.some((member) => member.refId === sql.id && member.kind === 'sql')).toBe(true)
  }))

  it('summarizes all six clusters and falls back when the model fails', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: '我想理解这个慢查询。' })
    const project = repository.createWritingProject({ learnerId: run.learnerId, practiceRunId: run.id })
    const summarizer = { summarize: vi.fn(async (input: Array<{ clusterKey: WritingClusterKey; ruleSummary: string; evidence: string[] }>) => input.map((item) => ({ clusterKey: item.clusterKey, title: item.clusterKey, summary: item.ruleSummary, relevance: '由模型压缩的相关性' }))) }
    const curation = new CurationService(repository, summarizer)
    curation.ensure(project)
    await vi.waitFor(() => expect(summarizer.summarize).toHaveBeenCalledOnce())
    const inputKeys = repository.listWritingClusterModelInputs(project.id).map((item) => item.clusterKey)
    expect(inputKeys).toHaveLength(6)
    await vi.waitFor(() => expect(curation.overview(project.id, run.id).curation.status).toBe('succeeded'))
    expect(curation.overview(project.id, run.id).clusters.every((cluster) => cluster.summaryStatus === 'model_ready')).toBe(true)

    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'error', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'Unknown column', metadata: {} })
    const failed = new CurationService(repository, { summarize: vi.fn(async () => { throw new Error('provider_timeout') }) })
    failed.refresh(repository.getWritingProject(project.id))
    await vi.waitFor(() => expect(failed.overview(project.id, run.id).curation.status).toBe('failed'))
    expect(failed.overview(project.id, run.id).clusters.every((cluster) => cluster.summaryStatus === 'model_failed')).toBe(true)
    expect(repository.listCurrentWritingCapsules(project.id).every((capsule) => capsule.status === 'model_failed')).toBe(true)
  }))

  it('keeps writing resources scoped to their project and scans full artifact content for secrets', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const firstRun = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const secondRun = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-deep-pagination-001' })
    const secretArtifact = repository.createArtifact({ learnerId: 'learner-1', practiceRunId: firstRun.id, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: `${'safe '.repeat(100)} password=do-not-publish`, metadata: {} })
    const service = new WritingService(repository)
    const first = service.initialize(firstRun.id)
    const second = service.initialize(secondRun.id)
    const firstCuration = service.curationOverview(firstRun.id)
    for (const key of ['problem', 'evidence', 'solution'] as const) {
      const cluster = firstCuration.clusters.find((item) => item.clusterKey === key)!
      service.updateCuration(firstRun.id, cluster.id, cluster.revision, 'accepted')
    }
    const outlined = service.generateOutline(firstRun.id)
    const articleProject = service.generateArticle(firstRun.id)
    const outline = outlined.documents.find((document) => document.kind === 'outline')!
    expect(() => service.editSection(secondRun.id, outline.id, outline.sections[0]!.id, outline.revision, 'cross project')).toThrow(WritingNotFoundError)
    expect(secretArtifact.id).toBeTruthy()
    expect(second.materials.some((material) => material.refId === secretArtifact.id)).toBe(false)
    expect(articleProject.reviewItems.some((item) => item.code.startsWith('privacy_'))).toBe(true)
    expect(first.materials.some((material) => material.refId === secretArtifact.id)).toBe(true)
  }))

  it('builds versioned capsules, deduplicates the evidence pack, and runs idempotent Agent generations', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL key=NULL rows=100000', metadata: {} })
    const agent: WritingAgentProvider = { providerName: 'test', modelName: 'test-model', generate: vi.fn(async () => agentDraft(artifact.id)) }
    const service = new WritingService(repository, new CurationService(repository), agent)
    const project = service.initialize(run.id)
    const overview = service.curationOverview(run.id)
    expect(overview.capsules).toHaveLength(6)
    expect(overview.capsules.every((capsule) => capsule.representativeCount <= 6)).toBe(true)
    for (const key of ['problem', 'evidence', 'solution'] as const) {
      const cluster = overview.clusters.find((item) => item.clusterKey === key)!
      service.updateCuration(run.id, cluster.id, cluster.revision, 'accepted')
    }
    const first = service.startGeneration(run.id, 'outline', 'outline-request')
    const duplicate = service.startGeneration(run.id, 'outline', 'outline-request')
    expect(duplicate.id).toBe(first.id)
    await vi.waitFor(() => { const current = repository.getWritingGenerationJob(first.id); expect(current.status, current.failureMessage ?? '').toBe('succeeded') })
    const outlined = repository.getWritingProject(project.id)
    const outline = outlined.documents.find((document) => document.kind === 'outline')!
    expect(outline.evidencePackId).toBeTruthy()
    expect(repository.getCurrentWritingEvidencePack(project.id)?.nodeCount).toBe(1)
    expect(() => service.startGeneration(run.id, 'article', 'article-request')).toThrow(WritingConflictError)
    service.confirmOutline(run.id, outline.id)
    const articleJob = service.startGeneration(run.id, 'article', 'article-request')
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(articleJob.id).status).toBe('succeeded'))
    expect(repository.getWritingProject(project.id).documents.some((document) => document.kind === 'article')).toBe(true)
    expect(agent.generate).toHaveBeenCalledTimes(2)
  }))

  it('rejects invalid Agent references without creating a document', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL', metadata: {} })
    const agent: WritingAgentProvider = { providerName: 'test', modelName: 'test-model', generate: vi.fn(async () => agentDraft(`${artifact.id}-unknown`)) }
    const service = new WritingService(repository, new CurationService(repository), agent)
    service.initialize(run.id); const overview = service.curationOverview(run.id)
    for (const key of ['problem', 'evidence', 'solution'] as const) { const cluster = overview.clusters.find((item) => item.clusterKey === key)!; service.updateCuration(run.id, cluster.id, cluster.revision, 'accepted') }
    const job = service.startGeneration(run.id, 'outline', 'invalid-request')
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(job.id).status).toBe('failed'))
    expect(repository.getWritingProjectByRun(run.id)?.documents).toHaveLength(0)
  }))

  it('retries a failed generation and does not leave partial writing state', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL', metadata: {} })
    let calls = 0
    const agent: WritingAgentProvider = { providerName: 'test', modelName: 'test-model', generate: vi.fn(async () => { calls += 1; if (calls === 1) throw new WritingAgentError('model_timeout', '测试超时'); return agentDraft(artifact.id) }) }
    const service = new WritingService(repository, new CurationService(repository), agent)
    service.initialize(run.id); const overview = service.curationOverview(run.id)
    for (const key of ['problem', 'evidence', 'solution'] as const) { const cluster = overview.clusters.find((item) => item.clusterKey === key)!; service.updateCuration(run.id, cluster.id, cluster.revision, 'accepted') }
    const failed = service.startGeneration(run.id, 'outline', 'retryable-request')
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(failed.id).status).toBe('failed'))
    expect(repository.getWritingProjectByRun(run.id)?.documents).toHaveLength(0)
    const retried = service.startGeneration(run.id, 'outline', 'retry-request', true)
    expect(retried.id).toBe(failed.id)
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(failed.id).status).toBe('succeeded'))
    expect(repository.getWritingProjectByRun(run.id)?.documents).toHaveLength(1)
    expect(agent.generate).toHaveBeenCalledTimes(2)
  }))

  it('recovers stale generation workers with an attempt fence', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const project = repository.createWritingProject({ learnerId: run.learnerId, practiceRunId: run.id })
    const queued = repository.queueWritingGenerationJob({ projectId: project.id, kind: 'outline', inputFingerprint: 'stale-fingerprint' })
    expect(repository.claimWritingGenerationJob(queued.id)).toBe(true)
    repository.recoverWritingGenerationJobs(-1)
    const recovered = repository.getWritingGenerationJob(queued.id)
    expect(recovered.status).toBe('queued')
    expect(recovered.attemptCount).toBe(1)
    expect(repository.claimWritingGenerationJob(queued.id)).toBe(true)
    expect(repository.getWritingGenerationJob(queued.id).attemptCount).toBe(2)
  }))

  it('supersedes evidence packs without changing documents generated from an older pack', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const firstArtifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL', metadata: {} })
    const agent: WritingAgentProvider = { providerName: 'test', modelName: 'test-model', generate: vi.fn(async () => agentDraft(firstArtifact.id)) }
    const service = new WritingService(repository, new CurationService(repository), agent)
    service.initialize(run.id); const overview = service.curationOverview(run.id)
    for (const key of ['problem', 'evidence', 'solution'] as const) { const cluster = overview.clusters.find((item) => item.clusterKey === key)!; service.updateCuration(run.id, cluster.id, cluster.revision, 'accepted') }
    const firstJob = service.startGeneration(run.id, 'outline', 'pack-one')
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(firstJob.id).status).toBe('succeeded'))
    const firstDocument = repository.getWritingProjectByRun(run.id)!.documents.find((document) => document.kind === 'outline')!
    const firstPackId = firstDocument.evidencePackId!
    repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'error', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'new evidence', metadata: {} })
    service.curationOverview(run.id)
    const secondJob = service.startGeneration(run.id, 'outline', 'pack-two')
    await vi.waitFor(() => expect(repository.getWritingGenerationJob(secondJob.id).status).toBe('succeeded'))
    const documents = repository.getWritingProjectByRun(run.id)!.documents.filter((document) => document.kind === 'outline')
    expect(documents).toHaveLength(1)
    expect(repository.getWritingDocument(firstDocument.id).evidencePackId).toBe(firstPackId)
    expect(repository.getWritingEvidencePack(firstPackId, repository.getWritingProjectByRun(run.id)!.id).status).toBe('superseded')
    expect(documents[0]!.evidencePackId).not.toBe(firstPackId)
  }))

  it('automatically chains indexing, outline, article, and checking after resolution', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'explain', sourceKind: 'lab', verificationStatus: 'verified_lab', content: 'type=ALL key=NULL rows=100000', metadata: {} })
    repository.updatePracticeRun(run.id, { stage: 'resolved', status: 'resolved' })
    const agent: WritingAgentProvider = { providerName: 'test', modelName: 'test-model', generate: vi.fn(async () => agentDraft(artifact.id)) }
    const service = new WritingService(repository, new CurationService(repository), agent)
    const first = service.enqueueAutoDraft(run.id)
    const second = service.enqueueAutoDraft(run.id)
    expect(first?.id).toBe(second?.id)
    await vi.waitFor(() => expect(service.workspace(run.id).draftRun?.phase).toBe('ready'))
    const workspace = service.workspace(run.id)
    expect(workspace.project?.documents.some((document) => document.kind === 'article')).toBe(true)
    expect(agent.generate).toHaveBeenCalledTimes(2)
    const article = workspace.project!.documents.find((document) => document.kind === 'article')!
    const block = article.sections[0]!.blocks[0]!
    expect(service.blockEvidence(run.id, article.id, block.id).references[0]?.refId).toBe(artifact.id)

    const edited = service.editBlock(run.id, article.id, block.id, block.revision, '用户保留的手工修改。')
    const editedBlock = edited.sections[0]!.blocks[0]!
    expect(editedBlock.content).toBe('用户保留的手工修改。')
    expect(() => service.editBlock(run.id, article.id, block.id, block.revision, '过期版本不应覆盖。')).toThrow(WritingConflictError)

    const regenerated = service.regenerate(run.id, 'regenerate-request')
    await vi.waitFor(() => expect(service.workspace(run.id).draftRun?.id).toBe(regenerated.id))
    await vi.waitFor(() => expect(repository.getWritingDraftRun(regenerated.id).phase).toBe('ready'))
    expect(repository.getWritingDocument(article.id).sections[0]!.blocks[0]!.content).toBe('用户保留的手工修改。')
    const articleCount = repository.db.prepare("SELECT COUNT(*) AS count FROM writing_documents WHERE project_id = ? AND kind = 'article'").get(workspace.project!.id) as { count: number }
    expect(articleCount.count).toBe(2)
    const draftPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM writing_draft_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').all(workspace.project!.id) as Array<{ detail: string }>
    expect(draftPlan.some((row) => row.detail.includes('idx_writing_draft_runs_project_created'))).toBe(true)
  }))

  it('starts automatic writing from verify and fails transparently without a model', async () => withRepositoryAsync(async (repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const startedAt = (offset: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString()
    const executions = [
      { kind: 'explain' as const, statement: 'EXPLAIN SELECT * FROM orders', result: { kind: 'result_set' as const, columns: ['type', 'key', 'rows', 'Extra'], rows: [['ALL', null, 100000, 'Using where']], truncated: false, rawOutput: 'type=ALL key=NULL rows=100000 Extra=Using where' } },
      { kind: 'result_set' as const, statement: 'SELECT * FROM orders', result: { kind: 'result_set' as const, columns: ['id'], rows: [[1]], truncated: false, rawOutput: '1' } },
      { kind: 'sql' as const, statement: 'CREATE INDEX idx_orders_user ON orders(user_id)', result: { kind: 'command' as const, affectedRows: 0, truncated: false, rawOutput: 'Query OK' } },
      { kind: 'explain' as const, statement: 'EXPLAIN SELECT * FROM orders', result: { kind: 'result_set' as const, columns: ['type', 'key', 'rows', 'Extra'], rows: [['ref', 'idx_orders_user', 1, 'Using index']], truncated: false, rawOutput: 'type=ref key=idx_orders_user rows=1 Extra=Using index' } },
      { kind: 'result_set' as const, statement: 'SELECT * FROM orders', result: { kind: 'result_set' as const, columns: ['id'], rows: [[1]], truncated: false, rawOutput: '1' } },
    ]
    for (const [index, execution] of executions.entries()) {
      const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: execution.kind, sourceKind: 'lab', verificationStatus: 'verified_lab', content: execution.result.rawOutput, metadata: { execution: { executionId: `execution-${index}`, runId: 'lab-1', caseId: run.caseId, revision: 1, clientRequestId: `request-${index}`, session: 'default', statement: execution.statement, status: 'succeeded', startedAt: startedAt(index), durationMs: 1, result: execution.result } } })
      repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'lab', type: 'evidence_captured', stage: 'verify', payload: { artifactKind: execution.kind }, artifactRefs: [artifact.id] })
    }
    const writing = new WritingService(repository)
    const onResolved = vi.fn((runId: string) => writing.enqueueAutoDraft(runId))
    const practice = new PracticeService(repository, {} as LabScheduler, new TutorEngine({} as LabConfig), undefined, undefined, onResolved)

    const result = practice.verify(run.id)
    expect(result.run.status).toBe('resolved')
    expect(onResolved).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(writing.workspace(run.id).draftRun?.phase).toBe('failed'))
    expect(writing.workspace(run.id).draftRun?.failureCode).toBe('model_not_configured')
  }))
})
