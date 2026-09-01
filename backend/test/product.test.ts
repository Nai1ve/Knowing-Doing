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
})
