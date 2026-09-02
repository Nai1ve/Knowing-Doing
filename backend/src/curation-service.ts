import { createHash } from 'node:crypto'
import type { LabConfig } from './config.js'
import type { Artifact, PracticeSnapshot, WritingClusterKey, WritingMaterial, WritingProject } from './product-types.js'
import { ProductRepository, type WritingCapsuleDefinition, type WritingClusterDefinition } from './product-repository.js'

const clusterMeta: Array<{ key: WritingClusterKey; title: string; relevance: string }> = [
  { key: 'problem', title: '问题与目标', relevance: '确认文章是否准确描述了现象、影响和本次实践要解决的问题。' },
  { key: 'hypothesis', title: '初始判断', relevance: '保留你最初的判断，方便说明哪些假设被支持、削弱或修正。' },
  { key: 'evidence', title: '关键证据', relevance: '只纳入能直接支持或推翻判断的 SQL、EXPLAIN、结果和错误证据。' },
  { key: 'attempts', title: '尝试与转折', relevance: '展示排查顺序、失败尝试和判断发生变化的节点。' },
  { key: 'solution', title: '候选方案与验证', relevance: '集中呈现候选修复、前后对比和仍需确认的结论边界。' },
  { key: 'principles', title: '原理与参考', relevance: '补充可迁移原理和知乎来源，但不把外部观点当成本次实验结果。' },
]

export interface CurationSummary {
  clusterKey: WritingClusterKey
  title: string
  summary: string
  relevance: string
}

export interface CurationSummarizer {
  summarize(input: Array<{ clusterKey: WritingClusterKey; ruleSummary: string; evidence: string[] }>): Promise<CurationSummary[]>
}

function caseLabel(caseId: string): string {
  if (caseId === 'mysql-order-list-index-001') return 'MySQL 慢查询与联合索引'
  if (caseId === 'mysql-deadlock-lock-order-001') return 'MySQL 死锁与锁等待'
  return 'MySQL 深分页优化'
}

function materialCategory(artifact: Artifact): WritingMaterial['category'] {
  if (artifact.kind === 'user_message') return 'hypothesis'
  if (artifact.kind === 'tutor_reply') return 'reflection'
  if (artifact.kind === 'sql') return 'attempt'
  if (['explain', 'benchmark', 'result_set', 'error'].includes(artifact.kind)) return 'evidence'
  if (artifact.sourceKind === 'zhihu' || artifact.kind === 'source_excerpt') return 'source'
  return 'context'
}

function materialTitle(artifact: Artifact): string {
  const labels: Record<string, string> = { user_message: '用户判断', tutor_reply: 'Tutor 回复', sql: 'SQL 尝试', explain: 'EXPLAIN 证据', benchmark: '基准证据', result_set: '结果集证据', error: '错误证据', external_text: '外部素材', source_excerpt: '来源摘录' }
  return labels[artifact.kind] ?? artifact.kind
}

function sourceIds(snapshot: PracticeSnapshot): string[] {
  const ids = new Set<string>()
  for (const artifact of snapshot.artifacts) {
    const refs = artifact.metadata.sourceRefs
    if (!Array.isArray(refs)) continue
    for (const ref of refs) {
      if (typeof ref === 'string') ids.add(ref)
      else if (ref && typeof ref === 'object' && typeof (ref as { sourceId?: unknown }).sourceId === 'string') ids.add(String((ref as { sourceId: string }).sourceId))
    }
  }
  return [...ids]
}

function excerpt(value: string, max = 180): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

function uniqueArtifacts(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>()
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.checksum)) return false
    seen.add(artifact.checksum)
    return true
  })
}

function artifactMembers(artifacts: Artifact[], predicate: (artifact: Artifact) => boolean): WritingClusterDefinition['members'] {
  const matched = artifacts.filter(predicate)
  const firstByChecksum = new Set<string>()
  return matched.map((artifact) => {
    const duplicate = firstByChecksum.has(artifact.checksum)
    firstByChecksum.add(artifact.checksum)
    return { refType: 'artifact' as const, refId: artifact.id, role: duplicate ? 'duplicate' as const : 'supporting' as const }
  })
}

function pathMembers(snapshot: PracticeSnapshot, stages: string[]): WritingClusterDefinition['members'] {
  return snapshot.pathNodes.filter((node) => stages.includes(node.stage)).map((node) => ({ refType: 'path_node' as const, refId: node.id, role: 'context' as const }))
}

function executionId(artifact: Artifact): string | null {
  const direct = artifact.metadata.executionId
  if (typeof direct === 'string' && direct) return direct
  const execution = artifact.metadata.execution
  if (execution && typeof execution === 'object' && typeof (execution as { executionId?: unknown }).executionId === 'string') return String((execution as { executionId: string }).executionId)
  return null
}

function dedupeMembers(members: WritingClusterDefinition['members']): WritingClusterDefinition['members'] {
  const seen = new Set<string>()
  return members.filter((member) => {
    const key = `${member.refType}:${member.refId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildDefinitions(project: WritingProject, snapshot: PracticeSnapshot): { definitions: WritingClusterDefinition[]; fingerprint: string } {
  const artifacts = snapshot.artifacts
  const unique = uniqueArtifacts(artifacts)
  const userMessages = artifacts.filter((artifact) => artifact.kind === 'user_message')
  const tutorReplies = artifacts.filter((artifact) => artifact.kind === 'tutor_reply')
  const sql = artifacts.filter((artifact) => artifact.kind === 'sql')
  const evidence = artifacts.filter((artifact) => ['explain', 'benchmark', 'result_set', 'error'].includes(artifact.kind))
  const evidenceExecutionIds = new Set(evidence.map(executionId).filter((value): value is string => Boolean(value)))
  const evidenceSql = sql.filter((artifact) => {
    const id = executionId(artifact)
    return id ? evidenceExecutionIds.has(id) : false
  })
  const sources = project.materials.filter((material) => material.refType === 'source')
  const lastSuccessful = [...artifacts].reverse().find((artifact) => artifact.verificationStatus === 'verified_lab' && ['sql', 'explain', 'result_set', 'benchmark'].includes(artifact.kind))
  const membersByKey: Record<WritingClusterKey, WritingClusterDefinition['members']> = {
    problem: artifactMembers(unique, (artifact) => artifact.kind === 'external_text' || artifact.kind === 'user_message').slice(0, 8),
    hypothesis: [...artifactMembers(userMessages, () => true).slice(0, 12), ...pathMembers(snapshot, ['hypothesize'])],
    evidence: [...artifactMembers(evidence, () => true), ...artifactMembers(evidenceSql, () => true), ...pathMembers(snapshot, ['inspect', 'verify'])],
    attempts: [...artifactMembers(sql, () => true), ...artifactMembers(artifacts, (artifact) => artifact.kind === 'error'), ...pathMembers(snapshot, ['attempt', 'inspect', 'verify'])],
    solution: [...(lastSuccessful ? [{ refType: 'artifact' as const, refId: lastSuccessful.id, role: 'primary' as const }] : []), ...artifactMembers(evidence, (artifact) => artifact.kind === 'explain' || artifact.kind === 'result_set').slice(-8), ...pathMembers(snapshot, ['verify', 'resolved'])],
    principles: [...sources.map((source) => ({ refType: 'source' as const, refId: source.refId, role: 'supporting' as const })), ...artifactMembers(tutorReplies, () => true).slice(-8)],
  }
  const counts = { artifacts: artifacts.length, unique: unique.length, sql: sql.length, evidence: evidence.length, sources: sources.length }
  const summaries: Record<WritingClusterKey, string> = {
    problem: `本次实践围绕${caseLabel(snapshot.run.caseId)}展开，先从用户描述和案例现象中确认待解决的问题。当前簇包含 ${membersByKey.problem.length} 条关键背景记录。`,
    hypothesis: `保留实践开始阶段的用户判断和 Tutor 引导，共整理 ${membersByKey.hypothesis.length} 条相关记录；需要你确认哪些判断值得写入复盘。`,
    evidence: `当前收集了 ${evidence.length} 条实验证据，并关联 ${evidenceSql.length} 条对应 SQL；按内容折叠重复项后用于比较 EXPLAIN、结果集和错误。`,
    attempts: `实践中记录了 ${sql.length} 条 SQL 尝试，原始数据共 ${artifacts.length} 条、去重后 ${unique.length} 条；重复执行将在详情中折叠。`,
    solution: lastSuccessful ? '已找到候选修复和验证证据，但结果是否足以支持最终结论仍由你确认。' : '已收集候选尝试，尚未找到可以作为最终方案的实验结果。',
    principles: `整理了 ${sources.length} 条知乎参考和相关 Tutor 解释；它们只用于补充原理，不替代本次 Lab 证据。`,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ runId: snapshot.run.id, artifacts: artifacts.map((a) => [a.id, a.checksum]), paths: snapshot.pathNodes.map((node) => [node.id, node.createdAt]), sources: sources.map((source) => source.refId) })).digest('hex')
  return { fingerprint, definitions: clusterMeta.map((meta, index) => ({ clusterKey: meta.key, position: index + 1, title: meta.title, ruleSummary: `${summaries[meta.key]}（${counts.artifacts} 条原始记录已保留）`, relevance: meta.relevance, members: dedupeMembers(membersByKey[meta.key]) })) }
}

export class ModelCurationSummarizer implements CurationSummarizer {
  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {}

  async summarize(input: Array<{ clusterKey: WritingClusterKey; ruleSummary: string; evidence: string[] }>): Promise<CurationSummary[]> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new Error('model_not_configured')
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.1, stream: false, thinking: { type: 'disabled' }, messages: [
          { role: 'system', content: '你是知行写作整理器。只能改写给定的规则摘要，不得添加新的事实、证据或来源。返回 JSON 数组，每项包含 clusterKey、title、summary、relevance；summary 不超过120字，使用中文。' },
          { role: 'user', content: JSON.stringify(input) },
        ] }),
      })
      if (!response.ok) throw new Error(`model_http_${response.status}`)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('model_empty_summary')
      const normalized = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(normalized) as unknown
      if (!Array.isArray(parsed)) throw new Error('model_invalid_summary')
      const allowed = new Set(input.map((item) => item.clusterKey))
      const summaries = parsed.filter((item): item is CurationSummary => Boolean(item) && typeof item === 'object' && allowed.has((item as { clusterKey?: unknown }).clusterKey as WritingClusterKey) && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { summary?: unknown }).summary === 'string' && typeof (item as { relevance?: unknown }).relevance === 'string')
      const returnedKeys = new Set(summaries.map((item) => item.clusterKey))
      if (summaries.length !== input.length || returnedKeys.size !== input.length || input.some((item) => !returnedKeys.has(item.clusterKey))) throw new Error('model_incomplete_summary')
      return summaries.map((item) => ({ clusterKey: item.clusterKey, title: item.title.trim().slice(0, 80), summary: item.summary.trim().slice(0, 120), relevance: item.relevance.trim().slice(0, 180) }))
    } finally { clearTimeout(timeout) }
  }
}

export class CurationService {
  private readonly processing = new Set<string>()

  constructor(private readonly repository: ProductRepository, private readonly summarizer?: CurationSummarizer) {}

  prepareRun(runId: string): void {
    const run = this.repository.getPracticeRun(runId)
    const snapshot = this.repository.snapshot(runId)
    const project = this.repository.getWritingProjectByRun(runId) ?? this.repository.createWritingProject({ learnerId: run.learnerId, practiceRunId: runId })
    for (const artifact of snapshot.artifacts) this.repository.upsertWritingMaterial({ projectId: project.id, category: materialCategory(artifact), refType: 'artifact', refId: artifact.id, title: materialTitle(artifact), excerpt: excerpt(artifact.content, 420), selected: false, verificationStatus: artifact.verificationStatus, metadata: { artifactKind: artifact.kind, sourceKind: artifact.sourceKind } })
    for (const source of this.repository.listSources(sourceIds(snapshot))) this.repository.upsertWritingMaterial({ projectId: project.id, category: 'source', refType: 'source', refId: source.id, title: source.title, excerpt: source.excerpt, selected: false, verificationStatus: 'source_verified', metadata: { provider: source.provider, url: source.url, author: source.author, query: source.query } })
    this.ensure(this.repository.getWritingProject(project.id))
  }

  buildCandidates(project: WritingProject): { definitions: WritingClusterDefinition[]; fingerprint: string } {
    return buildDefinitions(project, this.repository.snapshot(project.practiceRunId))
  }

  ensure(project: WritingProject, retryFailed = false): void {
    const { definitions, fingerprint } = this.buildCandidates(project)
    this.repository.replaceWritingClusters(project.id, fingerprint, definitions)
    this.ensureCapsules(project, definitions, fingerprint)
    const job = this.repository.queueWritingCurationJob(project.id, fingerprint, this.summarizer ? 'deepseek' : 'unavailable', this.summarizer ? 'configured' : 'unavailable', retryFailed)
    if (this.summarizer) void this.process(job.id)
    else {
      this.repository.markWritingClusterSummaryFailed(project.id, fingerprint)
      this.repository.markWritingCapsuleSummaryFailed(project.id, fingerprint, 'model_not_configured', '模型未配置，当前使用规则摘要')
      this.repository.finishWritingCurationJob(job.id, 'failed', 'model_not_configured', '模型未配置，当前使用规则摘要')
    }
  }

  private ensureCapsules(project: WritingProject, definitions: WritingClusterDefinition[], fingerprint: string): void {
    const overview = this.repository.getWritingClusterOverview(project.id, project.practiceRunId)
    const clusterIds = new Map(overview.clusters.map((cluster) => [cluster.clusterKey, cluster.id]))
    const capsuleDefinitions: WritingCapsuleDefinition[] = definitions.flatMap((definition) => {
      const clusterId = clusterIds.get(definition.clusterKey)
      if (!clusterId) return []
      const candidates = definition.members.filter((member) => member.role !== 'duplicate')
      const representative = [...candidates.filter((member) => member.role === 'primary'), ...candidates.filter((member) => member.role !== 'primary')].slice(0, 6)
      return [{ clusterId, inputFingerprint: fingerprint, ruleSummary: definition.ruleSummary, keyFindings: [definition.ruleSummary], turningPoints: [], unresolvedQuestions: ['哪些证据足以支持这组结论？'], rawCount: definition.members.length, members: representative }]
    })
    this.repository.replaceWritingCapsules(project.id, capsuleDefinitions)
  }

  refresh(project: WritingProject): void { this.ensure(project, true) }

  resume(): void { for (const job of this.repository.listPendingWritingCurationJobs()) if (this.summarizer) void this.process(job.id) }

  overview(projectId: string, practiceRunId: string) { return this.repository.getWritingClusterOverview(projectId, practiceRunId) }

  detail(projectId: string, clusterId: string, filter: string | undefined, cursor: string | undefined, limit = 30) {
    this.repository.getWritingCluster(clusterId, projectId)
    return this.repository.listWritingClusterMembers(clusterId, filter, cursor, Math.min(Math.max(limit, 1), 50))
  }

  update(projectId: string, clusterId: string, revision: number, status: 'pending' | 'accepted' | 'rejected', userNote?: string | null) {
    return this.repository.updateWritingCluster(clusterId, projectId, revision, status, userNote)
  }

  private async process(jobId: string): Promise<void> {
    if (!this.summarizer || this.processing.has(jobId)) return
    this.processing.add(jobId)
    try {
      if (!this.repository.markWritingCurationJobRunning(jobId)) return
      const job = this.repository.getWritingCurationJob(jobId)
      const input = this.repository.listWritingClusterModelInputs(job.projectId)
      const summaries = await this.summarizer.summarize(input)
      this.repository.applyWritingClusterSummaries(job.projectId, job.inputFingerprint, summaries)
      this.repository.applyWritingCapsuleSummaries(job.projectId, job.inputFingerprint, summaries)
      this.repository.finishWritingCurationJob(jobId, 'succeeded', undefined, undefined, job.attemptCount)
    } catch (error) {
      const job = this.repository.getWritingCurationJob(jobId)
      this.repository.markWritingClusterSummaryFailed(job.projectId, job.inputFingerprint)
      this.repository.markWritingCapsuleSummaryFailed(job.projectId, job.inputFingerprint, 'summary_failed', error instanceof Error ? error.message : '摘要润色失败')
      this.repository.finishWritingCurationJob(jobId, 'failed', 'summary_failed', error instanceof Error ? error.message : '摘要润色失败', job.attemptCount)
    } finally { this.processing.delete(jobId) }
  }
}
