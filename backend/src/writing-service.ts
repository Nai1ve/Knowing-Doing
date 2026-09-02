import { createHash } from 'node:crypto'
import type { Artifact, PracticeRun, PracticeSnapshot, SourceItem, WritingClaim, WritingDocument, WritingMaterial, WritingProject, WritingReviewItem, WritingSection, WritingGenerationJob, WritingGenerationKind, WritingEvidencePack } from './product-types.js'
import { ProductRepository } from './product-repository.js'
import { CurationService } from './curation-service.js'
import { WritingAgentError, type WritingAgentDraft, type WritingAgentProvider } from './writing-agent.js'

export class WritingNotFoundError extends Error {}
export class WritingConflictError extends Error {}

type SectionDraft = Pick<WritingSection, 'sectionKey' | 'position' | 'title' | 'content' | 'required' | 'status' | 'evidenceRefs' | 'sourceRefs'>

const sectionTemplate: Array<{ key: string; title: string; required: boolean }> = [
  { key: 'context', title: '问题背景', required: true },
  { key: 'symptom', title: '现象与线索', required: true },
  { key: 'hypothesis', title: '我的初始判断', required: true },
  { key: 'evidence', title: '证据与排查', required: true },
  { key: 'attempts', title: '尝试与判断转折', required: true },
  { key: 'solution', title: '最终方案', required: true },
  { key: 'verification', title: '结果验证', required: true },
  { key: 'principles', title: '原理与可迁移方法', required: true },
  { key: 'boundaries', title: '适用边界与代价', required: true },
  { key: 'reproduction', title: '可复现步骤', required: true },
  { key: 'sources', title: '来源与证据索引', required: false },
]

function excerpt(content: string, max = 420): string {
  const normalized = content.trim().replace(/\s+/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

function materialCategory(artifact: Artifact): WritingMaterial['category'] {
  if (artifact.kind === 'user_message') return 'hypothesis'
  if (artifact.kind === 'tutor_reply') return 'reflection'
  if (artifact.kind === 'sql') return 'attempt'
  if (artifact.kind === 'explain' || artifact.kind === 'benchmark' || artifact.kind === 'result_set' || artifact.kind === 'error') return 'evidence'
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

function sourceMaterial(projectId: string, source: SourceItem): Omit<WritingMaterial, 'id' | 'createdAt' | 'projectId'> & { projectId: string } {
  return { projectId, category: 'source', refType: 'source', refId: source.id, title: source.title, excerpt: source.excerpt, selected: source.provider === 'zhihu', verificationStatus: 'source_verified', metadata: { provider: source.provider, url: source.url, author: source.author, query: source.query } }
}

function caseLabel(run: PracticeRun): string {
  if (run.caseId === 'mysql-order-list-index-001') return 'MySQL 慢查询与联合索引'
  if (run.caseId === 'mysql-deadlock-lock-order-001') return 'MySQL 死锁与锁等待'
  return 'MySQL 深分页优化'
}

function selectedMaterials(project: WritingProject): WritingMaterial[] {
  return project.materials.filter((material) => material.selected)
}

function refs(materials: WritingMaterial[], predicate: (material: WritingMaterial) => boolean): string[] {
  return materials.filter(predicate).map((material) => material.refId)
}

function lines(materials: WritingMaterial[], predicate: (material: WritingMaterial) => boolean, empty: string): string {
  const values = materials.filter(predicate).map((material) => `- ${material.title}：${material.excerpt || '待补充原始内容'}`)
  return values.length > 0 ? values.join('\n') : `- ${empty}`
}

function buildOutline(run: PracticeRun, project: WritingProject, snapshot: PracticeSnapshot): { sections: SectionDraft[]; claims: Array<{ sectionKey: string; text: string; kind: WritingClaim['kind']; status: WritingClaim['status']; evidenceRefs: string[]; sourceRefs: string[] }> } {
  const materials = selectedMaterials(project)
  const lab = materials.filter((material) => material.verificationStatus === 'verified_lab')
  const sources = materials.filter((material) => material.refType === 'source')
  const pathText = snapshot.pathNodes.map((node) => `- ${node.judgment}${node.judgmentChange ? `（变化：${node.judgmentChange}）` : ''}`).join('\n')
  const sections: SectionDraft[] = [
    { sectionKey: 'context', position: 1, title: '问题背景', required: true, status: 'generated', content: `本次实践围绕${caseLabel(run)}展开。\n\n- 学习目标：从一次工程现象出发，完成可验证的排查和修复。\n- 实验环境：知行受控 MySQL Lab。\n- 约束：所有结论以本次实验数据为准，不直接等同于生产环境结论。`, evidenceRefs: refs(materials, (m) => m.category === 'context'), sourceRefs: [] },
    { sectionKey: 'symptom', position: 2, title: '现象与线索', required: true, status: 'generated', content: lines(materials, (m) => m.category === 'context' || m.category === 'evidence', '待补充最初现象、日志和目标 SQL。'), evidenceRefs: refs(materials, (m) => m.category === 'context' || m.category === 'evidence'), sourceRefs: [] },
    { sectionKey: 'hypothesis', position: 3, title: '我的初始判断', required: true, status: 'generated', content: lines(materials, (m) => m.category === 'hypothesis', '待补充你最初认为问题在哪里，以及准备如何验证。'), evidenceRefs: [], sourceRefs: [] },
    { sectionKey: 'evidence', position: 4, title: '证据与排查', required: true, status: 'generated', content: lines(materials, (m) => m.category === 'evidence', '待补充 EXPLAIN、错误、基准或结果集证据。'), evidenceRefs: refs(materials, (m) => m.category === 'evidence'), sourceRefs: [] },
    { sectionKey: 'attempts', position: 5, title: '尝试与判断转折', required: true, status: 'generated', content: `${lines(materials, (m) => m.category === 'attempt', '待补充至少一次 SQL 或索引尝试。')}${pathText ? `\n\n已有判断记录：\n${pathText}` : ''}`, evidenceRefs: refs(materials, (m) => m.category === 'attempt' || m.category === 'evidence'), sourceRefs: [] },
    { sectionKey: 'solution', position: 6, title: '最终方案', required: true, status: 'generated', content: lines(materials, (m) => m.category === 'solution' || (m.category === 'attempt' && m.verificationStatus === 'verified_lab'), '待补充最终 SQL、索引或配置修改，并说明选择理由。'), evidenceRefs: refs(lab, (m) => m.category === 'solution' || m.category === 'attempt'), sourceRefs: [] },
    { sectionKey: 'verification', position: 7, title: '结果验证', required: true, status: 'generated', content: lines(materials, (m) => m.category === 'evidence' && m.verificationStatus === 'verified_lab', '待补充前后 EXPLAIN、性能基准和结果集一致性。'), evidenceRefs: refs(lab, (m) => m.category === 'evidence'), sourceRefs: [] },
    { sectionKey: 'principles', position: 8, title: '原理与可迁移方法', required: true, status: 'empty', content: sources.length > 0 ? `待根据已选来源整理原理，不能把来源观点写成本次实验结果。\n\n参考来源：${sources.map((source) => source.title).join('、')}` : '待补充本次案例背后的原理，以及下一次遇到类似问题时的排查顺序。', evidenceRefs: [], sourceRefs: sources.map((source) => source.refId) },
    { sectionKey: 'boundaries', position: 9, title: '适用边界与代价', required: true, status: 'empty', content: '待补充数据分布、MySQL 版本、索引维护成本、写入影响和生产环境差异。', evidenceRefs: [], sourceRefs: [] },
    { sectionKey: 'reproduction', position: 10, title: '可复现步骤', required: true, status: 'generated', content: lines(materials, (m) => m.refType === 'artifact' && (m.category === 'attempt' || m.category === 'evidence'), '待补充可执行 SQL、执行顺序和验证方法。'), evidenceRefs: refs(materials, (m) => m.refType === 'artifact' && (m.category === 'attempt' || m.category === 'evidence')), sourceRefs: [] },
    { sectionKey: 'sources', position: 11, title: '来源与证据索引', required: false, status: sources.length > 0 || lab.length > 0 ? 'generated' : 'empty', content: [...lab.map((item) => `- 实验：${item.title} · ${item.refId}`), ...sources.map((item) => `- 来源：${item.title} · ${item.refId}`)].join('\n') || '- 暂无已选来源或实验素材。', evidenceRefs: lab.map((item) => item.refId), sourceRefs: sources.map((item) => item.refId) },
  ]
  const claims = lab.slice(0, 8).map((material) => ({ sectionKey: material.category === 'attempt' ? 'attempts' : material.category === 'solution' ? 'solution' : 'evidence', text: `本次实验记录了${material.title}。`, kind: 'observed' as const, status: 'supported' as const, evidenceRefs: [material.refId], sourceRefs: [] }))
  return { sections, claims }
}

function articleSections(outline: WritingDocument, project: WritingProject): SectionDraft[] {
  return outline.sections.map((section) => ({
    sectionKey: section.sectionKey, position: section.position, title: section.title, required: section.required, status: section.status === 'empty' ? 'empty' : 'generated',
    content: section.sectionKey === 'context' ? `这是一篇从一次可复现实验开始的工程问题复盘。\n\n${section.content}` : section.content,
    evidenceRefs: section.evidenceRefs, sourceRefs: section.sourceRefs,
  }))
}

interface PackNode {
  refType: 'artifact' | 'source' | 'path_node'
  refId: string
  title: string
  excerpt: string
  kind: string
  verificationStatus: string
  sourceOnly: boolean
  clusterKeys: string[]
}

function packNodes(pack: WritingEvidencePack): PackNode[] {
  const nodes = pack.snapshot.nodes
  return Array.isArray(nodes) ? nodes.filter((node): node is PackNode => Boolean(node) && typeof node === 'object' && typeof (node as PackNode).refType === 'string' && typeof (node as PackNode).refId === 'string') : []
}

function validateAgentDraft(value: WritingAgentDraft, pack: WritingEvidencePack): WritingAgentDraft {
  if (!value || typeof value !== 'object' || !Array.isArray(value.sections) || !Array.isArray(value.claims)) throw new WritingAgentError('agent_invalid_shape', '写作 Agent 返回的章节结构不完整', false)
  const nodes = packNodes(pack); const allowed = new Set(nodes.map((node) => `${node.refType}:${node.refId}`)); const allowedSources = new Set(nodes.filter((node) => node.sourceOnly).map((node) => node.refId)); const expected = new Map(sectionTemplate.map((section) => [section.key, section]))
  const sections = value.sections.filter((section) => section && typeof section === 'object')
    const sectionKeys = new Set(sections.map((section) => section.sectionKey))
    if (sections.length !== sectionKeys.size || sections.some((section) => !expected.has(section.sectionKey)) || sectionTemplate.some((template) => template.required && !sectionKeys.has(template.key))) throw new WritingAgentError('agent_incomplete_sections', '写作 Agent 没有覆盖完整必需章节', false)
  for (const section of sections) {
      if (typeof section.title !== 'string' || typeof section.content !== 'string' || section.content.length > 6000 || !Array.isArray(section.evidenceRefs) || !Array.isArray(section.sourceRefs)) throw new WritingAgentError('agent_invalid_section', '写作 Agent 返回了无效章节', false)
      if (section.content.trim() && section.evidenceRefs.length === 0 && section.sourceRefs.length === 0) throw new WritingAgentError('agent_unsupported_section', '写作 Agent 返回了没有依据的章节内容', false)
    if (section.evidenceRefs.some((ref) => typeof ref !== 'string' || !allowed.has(`artifact:${ref}`) && !allowed.has(`path_node:${ref}`))) throw new WritingAgentError('agent_unknown_evidence_ref', '写作 Agent 引用了不存在的实验证据', false)
    if (section.sourceRefs.some((ref) => typeof ref !== 'string' || !allowedSources.has(ref))) throw new WritingAgentError('agent_unknown_source_ref', '写作 Agent 引用了不在证据包中的来源', false)
  }
  for (const claim of value.claims) {
    if (!claim || typeof claim !== 'object' || typeof claim.sectionKey !== 'string' || !expected.has(claim.sectionKey) || typeof claim.text !== 'string' || !Array.isArray(claim.evidenceRefs) || !Array.isArray(claim.sourceRefs)) throw new WritingAgentError('agent_invalid_claim', '写作 Agent 返回了无效断言', false)
    if (claim.evidenceRefs.length === 0 && claim.sourceRefs.length === 0) throw new WritingAgentError('agent_unsupported_claim', '写作 Agent 返回了没有依据的事实断言', false)
    if (claim.evidenceRefs.some((ref) => typeof ref !== 'string' || !allowed.has(`artifact:${ref}`) && !allowed.has(`path_node:${ref}`)) || claim.sourceRefs.some((ref) => typeof ref !== 'string' || !allowedSources.has(ref))) throw new WritingAgentError('agent_invalid_claim_ref', '写作 Agent 的断言引用不在证据包中', false)
  }
  return { title: typeof value.title === 'string' ? value.title.trim().slice(0, 120) : '工程实践复盘', summary: typeof value.summary === 'string' ? value.summary.trim().slice(0, 300) : '', sections: sections.map((section) => ({ ...section, required: expected.get(section.sectionKey)!.required, evidenceRefs: [...new Set(section.evidenceRefs)], sourceRefs: [...new Set(section.sourceRefs)], status: 'generated' as const })), claims: value.claims.map((claim) => ({ ...claim, evidenceRefs: [...new Set(claim.evidenceRefs)], sourceRefs: [...new Set(claim.sourceRefs)] })) }
}

export class WritingService {
  private readonly processing = new Set<string>()

  constructor(private readonly repository: ProductRepository, private readonly curation = new CurationService(repository), private readonly agent?: WritingAgentProvider) {}

  private run(runId: string): PracticeRun {
    try { return this.repository.getPracticeRun(runId) } catch { throw new WritingNotFoundError(`Practice run not found: ${runId}`) }
  }

  private ensureProject(runId: string): WritingProject {
    const run = this.run(runId)
    const existing = this.repository.getWritingProjectByRun(runId)
    const project = existing ?? this.repository.createWritingProject({ learnerId: run.learnerId, practiceRunId: runId })
    const snapshot = this.repository.snapshot(runId)
    const sourceList = this.repository.listSources(sourceIds(snapshot))
    for (const artifact of snapshot.artifacts) {
      this.repository.upsertWritingMaterial({ projectId: project.id, category: materialCategory(artifact), refType: 'artifact', refId: artifact.id, title: materialTitle(artifact), excerpt: excerpt(artifact.content), selected: artifact.verificationStatus === 'verified_lab' || artifact.kind === 'user_message', verificationStatus: artifact.verificationStatus, metadata: { artifactKind: artifact.kind, sourceKind: artifact.sourceKind } })
    }
    for (const source of sourceList) this.repository.upsertWritingMaterial(sourceMaterial(project.id, source))
    return this.repository.getWritingProject(project.id)
  }

  initialize(runId: string): WritingProject {
    const project = this.ensureProject(runId)
    this.curation.ensure(project)
    return project
  }

  curationOverview(runId: string) {
    const project = this.ensureProject(runId)
    const candidates = this.curation.buildCandidates(project)
    const existing = this.repository.listWritingClusterDefinitions(project.id)[0]
    if (!existing || existing.sourceFingerprint !== candidates.fingerprint) this.curation.ensure(project)
    return this.curation.overview(project.id, runId)
  }

  curationDetail(runId: string, clusterId: string, filter?: string, cursor?: string, limit?: number) {
    const projectId = this.repository.getWritingProjectIdByRun(runId)
    if (!projectId) throw new WritingNotFoundError(`Writing project not found for practice run: ${runId}`)
    try { return this.curation.detail(projectId, clusterId, filter, cursor, limit) } catch (error) {
      if (error instanceof Error && error.message === 'WRITING_CLUSTER_NOT_FOUND') throw new WritingNotFoundError('写作聚类不存在')
      throw error
    }
  }

  updateCuration(runId: string, clusterId: string, revision: number, status: 'pending' | 'accepted' | 'rejected', userNote?: string | null) {
    const projectId = this.repository.getWritingProjectIdByRun(runId)
    if (!projectId) throw new WritingNotFoundError(`Writing project not found for practice run: ${runId}`)
    try { return this.curation.update(projectId, clusterId, revision, status, userNote) } catch (error) {
      if (error instanceof Error && error.message === 'WRITING_CLUSTER_NOT_FOUND') throw new WritingNotFoundError('写作聚类不存在')
      if (error instanceof Error && error.message === 'WRITING_CLUSTER_REVISION_CONFLICT') throw new WritingConflictError('聚类已在其他标签页更新，请刷新后再确认')
      throw error
    }
  }

  refreshCuration(runId: string) {
    const project = this.ensureProject(runId)
    this.curation.refresh(project)
    return this.curation.overview(project.id, runId)
  }

  replayCuration(runId: string) {
    const project = this.ensureProject(runId)
    this.repository.replayMissingPracticeArtifacts(runId)
    this.curation.prepareRun(runId)
    return this.curation.overview(project.id, runId)
  }

  getExisting(runId: string): WritingProject {
    this.run(runId)
    const project = this.repository.getWritingProjectByRun(runId)
    if (!project) throw new WritingNotFoundError(`Writing project not found for practice run: ${runId}`)
    return project
  }

  selectMaterial(runId: string, materialId: string, selected: boolean, editorialNote?: string | null): WritingProject {
    const project = this.getExisting(runId)
    let material: WritingMaterial
    try {
      material = this.repository.updateWritingMaterial(project.id, materialId, { selected, editorialNote })
    } catch (error) {
      if (error instanceof Error && error.message === `Writing material not found: ${materialId}`) throw new WritingNotFoundError(`Writing material not found: ${materialId}`)
      throw error
    }
    const run = this.run(runId)
    this.repository.updateWritingStatus(project.id, 'materials_ready')
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'writing_material_selected', stage: run.stage, payload: { materialId: material.id, selected: material.selected } })
    return this.repository.getWritingProject(project.id)
  }

  private createEvidencePack(project: WritingProject): WritingEvidencePack {
    const overview = this.curation.overview(project.id, project.practiceRunId)
    if (!overview.canGenerateOutline) throw new WritingConflictError('请先确认“问题与目标”“关键证据”和“候选方案与验证”三个聚类')
    const accepted = overview.clusters.filter((cluster) => cluster.status === 'accepted')
      const capsules = this.repository.listCurrentWritingCapsules(project.id)
      const capsuleById = new Map(capsules.map((capsule) => [capsule.id, capsule]))
    const keys = new Map(overview.clusters.map((cluster) => [cluster.id, cluster.clusterKey]))
    const members = this.repository.listCurrentWritingCapsuleMembers(project.id)
    const acceptedIds = new Set(accepted.map((cluster) => cluster.id)); const seen = new Map<string, PackNode>(); const ordered: PackNode[] = []
    for (const member of members) {
        const capsule = capsuleById.get(member.capsuleId); const clusterKey = capsule ? keys.get(capsule.clusterId) : undefined
      if (!capsule || !clusterKey || !acceptedIds.has(capsule.clusterId) || member.role === 'duplicate') continue
      const refKey = `${member.refType}:${member.refId}`; const existing = seen.get(refKey)
      if (existing) { if (!existing.clusterKeys.includes(clusterKey)) existing.clusterKeys.push(clusterKey); continue }
      const node: PackNode = { refType: member.refType, refId: member.refId, title: member.title, excerpt: member.excerpt.slice(0, 520), kind: member.kind, verificationStatus: member.verificationStatus, sourceOnly: member.refType === 'source', clusterKeys: [clusterKey] }
      seen.set(refKey, node); ordered.push(node)
    }
    const clusterSnapshots = accepted.map((cluster) => { const capsule = capsules.find((item) => item.clusterId === cluster.id); return { clusterKey: cluster.clusterKey, title: cluster.title, summary: capsule?.modelSummary ?? capsule?.ruleSummary ?? cluster.ruleSummary, keyFindings: capsule?.keyFindings ?? [], turningPoints: capsule?.turningPoints ?? [], unresolvedQuestions: capsule?.unresolvedQuestions ?? [] } })
    let nodes = ordered.slice(0, 30); let snapshot = { version: 1, generatedAt: new Date().toISOString(), constraints: { maxNodes: 30, maxChars: 18000 }, clusters: clusterSnapshots, nodes }
    while (JSON.stringify(snapshot).length > snapshot.constraints.maxChars && nodes.length > 0) {
      nodes = nodes.slice(0, -1)
      snapshot = { ...snapshot, nodes }
    }
    const inputFingerprint = createHash('sha256').update(JSON.stringify({ clusters: snapshot.clusters, nodes: nodes.map((node) => [node.refType, node.refId, node.clusterKeys]) })).digest('hex')
    return this.repository.createWritingEvidencePack(project.id, inputFingerprint, snapshot, nodes.length, JSON.stringify(snapshot).length)
  }

  startGeneration(runId: string, kind: WritingGenerationKind, clientRequestId: string, retryFailed = false): WritingGenerationJob {
    const run = this.run(runId); const project = this.ensureProject(runId); let pack: WritingEvidencePack; let outline: WritingDocument | undefined; let outlineDocumentId: string | null = null
    if (kind === 'outline') pack = this.createEvidencePack(project)
    else {
      outline = project.documents.find((document) => document.kind === 'outline')
      if (!outline || outline.status !== 'confirmed') throw new WritingConflictError('请先确认大纲后再生成文章')
      if (!outline.evidencePackId) throw new WritingConflictError('当前大纲没有绑定证据包，请重新生成大纲')
      pack = this.repository.getWritingEvidencePack(outline.evidencePackId, project.id); outlineDocumentId = outline.id
    }
    const inputFingerprint = createHash('sha256').update(JSON.stringify({ kind, packId: pack.id, packVersion: pack.version, outlineId: outlineDocumentId, outlineRevision: outline?.revision ?? null })).digest('hex')
    const job = this.repository.queueWritingGenerationJob({ projectId: project.id, kind, inputFingerprint, clientRequestId, evidencePackId: pack.id, outlineDocumentId, provider: this.agent?.providerName ?? 'unavailable', model: this.agent?.modelName ?? 'unavailable', retryFailed })
    if (!this.agent) this.repository.finishWritingGenerationJob(job.id, 'failed', null, 'model_not_configured', '模型服务尚未配置')
    else void this.processGeneration(job.id)
    return this.repository.getWritingGenerationJob(job.id, project.id)
  }

  getGenerationJob(runId: string, jobId: string): WritingGenerationJob {
    const projectId = this.repository.getWritingProjectIdByRun(runId)
    if (!projectId) throw new WritingNotFoundError('写作工程不存在')
    try { return this.repository.getWritingGenerationJob(jobId, projectId) } catch { throw new WritingNotFoundError('写作任务不存在') }
  }

  confirmOutline(runId: string, documentId: string): WritingDocument {
    const project = this.getExisting(runId)
    try { return this.repository.confirmWritingDocument(project.id, documentId) } catch { throw new WritingConflictError('当前大纲无法确认，请先生成并保存大纲') }
  }

  resumeGenerations(leaseMs = 10 * 60 * 1000): void {
    this.repository.recoverWritingGenerationJobs(leaseMs)
    for (const job of this.repository.listPendingWritingGenerationJobs()) void this.processGeneration(job.id)
  }

  private async processGeneration(jobId: string): Promise<void> {
    if (!this.agent || this.processing.has(jobId)) return
    this.processing.add(jobId)
    try {
      if (!this.repository.claimWritingGenerationJob(jobId)) return
      const job = this.repository.getWritingGenerationJob(jobId); const project = this.repository.getWritingProject(job.projectId)
      if (!job.evidencePackId) throw new WritingAgentError('missing_evidence_pack', '写作任务没有证据包', false)
      const pack = this.repository.getWritingEvidencePack(job.evidencePackId, job.projectId); const outlineDocument = job.outlineDocumentId ? project.documents.find((document) => document.id === job.outlineDocumentId) : undefined
      const outline = outlineDocument ? { title: outlineDocument.title, summary: outlineDocument.summary, sections: outlineDocument.sections.map((section) => ({ sectionKey: section.sectionKey, title: section.title, content: section.content, required: section.required, evidenceRefs: section.evidenceRefs, sourceRefs: section.sourceRefs })), claims: outlineDocument.claims.map((claim) => ({ sectionKey: outlineDocument.sections.find((section) => section.id === claim.sectionId)?.sectionKey ?? 'evidence', text: claim.text, kind: claim.kind, evidenceRefs: claim.evidenceRefs, sourceRefs: claim.sourceRefs })) } satisfies WritingAgentDraft : undefined
      if (job.kind === 'capsule') throw new WritingAgentError('unsupported_generation_kind', '不支持直接生成胶囊文档', false)
      const draft = validateAgentDraft(await this.agent.generate({ kind: job.kind, evidencePack: pack, outline }), pack); const content = draft.sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n')
      const sections = draft.sections.map((section) => ({ ...section, position: sectionTemplate.findIndex((item) => item.key === section.sectionKey) + 1, status: 'generated' as const }))
      const claims = draft.claims.map((claim) => ({ ...claim, status: 'supported' as const }))
      const document = this.repository.persistWritingGeneration({ jobId: job.id, attemptCount: job.attemptCount, projectId: job.projectId, learnerId: project.learnerId, practiceRunId: project.practiceRunId, kind: job.kind, evidencePackId: pack.id, title: draft.title, summary: draft.summary, sections, claims, artifactKind: job.kind === 'outline' ? 'note_outline' : 'article_draft', eventType: job.kind === 'outline' ? 'note_outline_generated' : 'article_draft_generated', stage: this.run(project.practiceRunId).stage, artifactContent: content, projectStatus: job.kind === 'outline' ? 'outline_review' : 'article_review' })
      if (job.kind === 'article') this.review(project.practiceRunId)
      void document
    } catch (error) {
      const job = this.repository.getWritingGenerationJob(jobId)
      if (job.status === 'running') this.repository.finishWritingGenerationJob(jobId, 'failed', null, error instanceof WritingAgentError ? error.code : 'generation_failed', error instanceof Error ? error.message : '写作生成失败', job.attemptCount)
    } finally { this.processing.delete(jobId) }
  }

  generateOutline(runId: string): WritingProject {
    const run = this.run(runId); const project = this.ensureProject(runId); const snapshot = this.repository.snapshot(runId)
    const overview = this.curation.overview(project.id, runId)
    if (!overview.canGenerateOutline) throw new WritingConflictError('请先确认“问题与目标”“关键证据”和“候选方案与验证”三个聚类')
    const acceptedRefs = new Set(this.repository.listAcceptedWritingRefs(project.id).map((ref) => `${ref.refType}:${ref.refId}`))
    const curatedProject = { ...project, materials: project.materials.map((material) => ({ ...material, selected: acceptedRefs.has(`${material.refType}:${material.refId}`) })) }
    const materialIds = selectedMaterials(curatedProject).map((material) => material.id)
    this.repository.updateWritingSnapshot(project.id, materialIds, 'outline_review')
    const current = this.repository.getWritingProject(project.id); const draft = buildOutline(run, { ...current, materials: current.materials.map((material) => ({ ...material, selected: acceptedRefs.has(`${material.refType}:${material.refId}`) })) }, snapshot)
    const document = this.repository.createWritingDocument({ projectId: current.id, kind: 'outline', status: 'generated', title: `${caseLabel(run)} · 实践复盘大纲`, summary: '从实践事件、Lab 证据和已选来源生成的可编辑大纲。', sections: draft.sections, claims: draft.claims })
    const artifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'note_outline', sourceKind: 'system', verificationStatus: 'model_generated', content: draft.sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n'), metadata: { documentId: document.id, generationMethod: 'evidence_template', materialIds } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'system', type: 'note_outline_generated', stage: run.stage, payload: { documentId: document.id, artifactId: artifact.id, materialIds }, artifactRefs: [artifact.id] })
    return this.repository.getWritingProject(current.id)
  }

  generateArticle(runId: string): WritingProject {
    const run = this.run(runId); const project = this.getExisting(runId); const outline = project.documents.find((document) => document.kind === 'outline')
    if (!outline) throw new WritingConflictError('请先生成大纲')
    const sections = articleSections(outline, project)
    const document = this.repository.createWritingDocument({ projectId: project.id, kind: 'article', status: 'needs_review', title: outline.title.replace('实践复盘大纲', '实践复盘'), summary: '根据已确认或已编辑大纲生成的可编辑文章初稿。', sections, claims: outline.claims.map((claim) => ({ sectionKey: outline.sections.find((section) => section.id === claim.sectionId)?.sectionKey ?? 'evidence', text: claim.text, kind: claim.kind, status: claim.status, evidenceRefs: claim.evidenceRefs, sourceRefs: claim.sourceRefs })) })
    const artifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'article_draft', sourceKind: 'system', verificationStatus: 'model_generated', content: sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n'), metadata: { documentId: document.id, generationMethod: 'evidence_template', reviewStatus: 'needs_human_review' } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'system', type: 'article_draft_generated', stage: run.stage, payload: { documentId: document.id, artifactId: artifact.id, reviewStatus: 'needs_human_review' }, artifactRefs: [artifact.id] })
    this.review(runId)
    return this.repository.getWritingProject(project.id)
  }

  editSection(runId: string, documentId: string, sectionId: string, expectedRevision: number, content: string): WritingProject {
    const run = this.run(runId); const project = this.getExisting(runId)
    let document: WritingDocument
    try { document = this.repository.updateWritingSection(project.id, documentId, sectionId, expectedRevision, content) } catch (error) {
      if (error instanceof Error && error.message === 'WRITING_REVISION_CONFLICT') throw new WritingConflictError('文档已在其他标签页更新，请刷新后再保存')
      if (error instanceof Error && (error.message === 'WRITING_DOCUMENT_NOT_FOUND' || error.message === 'WRITING_SECTION_NOT_FOUND')) throw new WritingNotFoundError('写作文档或章节不存在')
      throw error
    }
    this.repository.updateWritingStatus(project.id, document.kind === 'article' ? 'article_review' : 'outline_review')
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'user', type: 'writing_section_edited', stage: run.stage, payload: { documentId, sectionId } })
    return this.repository.getWritingProject(project.id)
  }

  review(runId: string): WritingProject {
    const run = this.run(runId); const project = this.getExisting(runId); const article = project.documents.find((document) => document.kind === 'article')
    if (!article) return project
    const snapshot = this.repository.snapshot(runId)
    const artifacts = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]))
    const items: Array<Omit<WritingReviewItem, 'id' | 'projectId' | 'createdAt'>> = []
    if (run.status !== 'resolved') items.push({ code: 'practice_not_resolved', severity: 'blocking', status: 'open', message: '实践尚未通过 Lab 验证，文章不能标记为可发布。', sectionId: null })
    for (const section of article.sections) if (section.required && (!section.content.trim() || section.content.includes('待补'))) items.push({ code: `section_missing_${section.sectionKey}`, severity: 'warning', status: 'open', message: `${section.title}仍包含待补内容。`, sectionId: section.id })
    for (const claim of article.claims) if (claim.status !== 'supported') items.push({ code: `claim_${claim.id}`, severity: claim.status === 'unsupported' ? 'blocking' : 'warning', status: 'open', message: `文章断言缺少足够证据：${claim.text}`, sectionId: claim.sectionId })
    for (const material of selectedMaterials(project)) {
      const original = material.refType === 'artifact' ? artifacts.get(material.refId)?.content : undefined
      const content = `${original ?? ''}\n${material.title}\n${material.excerpt}`
      if (/(password|secret|api[_-]?key|jdbc:mysql|mysql_root_password|bearer\s+)/i.test(content)) items.push({ code: `privacy_${material.id}`, severity: 'blocking', status: 'open', message: `素材“${material.title}”可能包含连接信息或敏感内容，请人工脱敏。`, sectionId: null })
    }
    this.repository.replaceWritingReviewItems(project.id, items)
    const ready = run.status === 'resolved' && items.every((item) => item.severity !== 'blocking')
    this.repository.updateWritingStatus(project.id, ready ? 'ready_for_preview' : 'article_review')
    return this.repository.getWritingProject(project.id)
  }
}
