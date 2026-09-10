import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { SourceSnapshotService, type SourceContentProvider } from '../src/case-source-snapshot.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'
import { ZhihuOpenApiClient } from '../src/zhihu-openapi.js'

class FakeSourceProvider implements SourceContentProvider {
  readonly providerName = 'fake-zhihu'
  calls = 0
  constructor(private content: string | Error) {}
  setContent(content: string): void { this.content = content }
  async fetch() {
    this.calls += 1
    if (this.content instanceof Error) throw this.content
    return { content: this.content, retrievedAt: '2026-09-10T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }
  }
}

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-source-snapshot-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  const learnerId = 'source-learner'
  const now = new Date().toISOString()
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('source-roadmap', ?, 'agent-roadmap-v2', '学习 Python list', 'active', 1, '{}', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('source-node', 'source-roadmap', NULL, 'python-list', 'concept', 'Python list', '从文章构建案例', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.collections.list', NULL, ?)").run(now)
  repository.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, revision, updated_at) VALUES ('source-roadmap', 'source-node', 'available', 'agent', 1, ?)").run(now)
  repository.db.prepare("INSERT INTO source_items(id, provider, external_id, title, author, url, excerpt, query, retrieved_at, metadata_json) VALUES ('source-item', 'zhihu', 'article-1', 'Python list 实践', '作者', 'https://www.zhihu.com/article/1', '摘要，不是正文', 'Python list', ?, '{}')").run(now)
  repository.db.prepare("INSERT INTO knowledge_route_sets(id, learner_id, roadmap_node_id, profile_snapshot_id, query_fingerprint, status, research_json, created_at, updated_at) VALUES ('source-route', ?, 'source-node', NULL, 'source-query', 'ready', '{}', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO knowledge_route_items(id, route_set_id, source_item_id, position, role, reason, learning_question) VALUES ('source-route-item', 'source-route', 'source-item', 1, 'foundation', '相关', '理解文章中的 list 行为')").run()
  return { directory, repository, learnerId }
}

describe('Case source snapshots', () => {
  it('freezes visible article content before the case job and hides full text from case reads', async () => {
    const state = setup()
    const provider = new FakeSourceProvider('# Python list\n\n这是一段正文，说明切片会创建新列表。')
    const snapshots = new SourceSnapshotService(state.repository.db, provider)
    const service = new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()), undefined, undefined, snapshots)
    try {
      const request = service.createCaseRequest(state.learnerId, { roadmapNodeId: 'source-node', input: { kind: 'zhihu_article', sourceItemId: 'source-item' }, clientRequestId: 'source-case-1' })
      expect(request.job.status).toBe('preparing_source')
      await vi.waitFor(() => expect(service.getCaseGenerationJob(state.learnerId, request.job.id).job.status).toBe('succeeded'))
      const result = service.getCaseGenerationJob(state.learnerId, request.job.id)
      expect(provider.calls).toBe(1)
      expect(result.case.sourceSnapshot).toMatchObject({ sourceItemId: 'source-item', title: 'Python list 实践', extractionStatus: 'ready', segmentCount: 2 })
      expect(result.case.sourceSnapshot).not.toHaveProperty('contentMarkdown')
      expect(result.case.inputSnapshot.sourceSnapshotId).toBe(result.case.sourceSnapshot!.id)
      expect(result.case.spec?.scenario).toContain('冻结正文已作为案例上下文读取')
      expect(result.case.spec?.scenario).not.toContain('切片会创建新列表')
      const snapshot = state.repository.db.prepare('SELECT content_markdown, content_checksum, extraction_status FROM case_source_snapshots WHERE id = ?').get(result.case.sourceSnapshot!.id) as { content_markdown: string; content_checksum: string; extraction_status: string }
      expect(snapshot).toMatchObject({ content_markdown: expect.stringContaining('切片会创建新列表'), extraction_status: 'ready' })
      expect(snapshot.content_checksum).toHaveLength(64)
      const reused = await snapshots.freeze(state.learnerId, { id: 'source-item', provider: 'zhihu', externalId: 'article-1', title: 'Python list 实践', author: '作者', url: 'https://www.zhihu.com/article/1', excerpt: '摘要', query: null, retrievedAt: new Date().toISOString(), metadata: {} })
      expect(reused.id).toBe(result.case.sourceSnapshot!.id)
      expect(provider.calls).toBe(2)
      provider.setContent('# Python list\n\n正文发生了变化，新增对象身份说明。')
      const refreshed = await snapshots.freeze(state.learnerId, { id: 'source-item', provider: 'zhihu', externalId: 'article-1', title: 'Python list 实践', author: '作者', url: 'https://www.zhihu.com/article/1', excerpt: '摘要', query: null, retrievedAt: new Date().toISOString(), metadata: {} })
      expect(refreshed.id).not.toBe(reused.id)
      expect(refreshed.contentChecksum).not.toBe(reused.contentChecksum)
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('reuses an unexpired snapshot and records extraction failure without using the excerpt', async () => {
    const state = setup()
    const provider = new FakeSourceProvider(new Error('provider_timeout'))
    const snapshots = new SourceSnapshotService(state.repository.db, provider)
    try {
      await expect(snapshots.freeze(state.learnerId, { id: 'source-item', provider: 'zhihu', externalId: 'article-1', title: '标题', author: null, url: 'https://www.zhihu.com/article/1', excerpt: '摘要', query: null, retrievedAt: new Date().toISOString(), metadata: {} })).rejects.toThrow('source_snapshot_unavailable:provider_timeout')
      expect(provider.calls).toBe(1)
      expect(state.repository.db.prepare("SELECT extraction_status, extraction_error FROM case_source_snapshots WHERE learner_id = ?").get(state.learnerId)).toMatchObject({ extraction_status: 'failed', extraction_error: 'provider_timeout' })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('rejects a source item that is not visible to the learner', () => {
    const state = setup()
    try {
      const other = 'other-learner'
      state.repository.ensureLearner(other)
      state.repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('other-roadmap', ?, 'agent-roadmap-v2', '其他', 'active', 1, '{}', ?, ?)").run(other, new Date().toISOString(), new Date().toISOString())
      state.repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('other-node', 'other-roadmap', NULL, 'python-list', 'concept', 'Python list', '其他', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.collections.list', NULL, ?)").run(new Date().toISOString())
      const service = new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()), undefined, undefined, new SourceSnapshotService(state.repository.db, new FakeSourceProvider('正文足够长，避免被判定为空。')))
      expect(() => service.createCaseRequest(other, { roadmapNodeId: 'other-node', input: { kind: 'zhihu_article', sourceItemId: 'source-item' }, clientRequestId: 'other-case' })).toThrow('知乎材料不存在或当前 learner 不可见')
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('uses the configured Zhihu article endpoint with bearer authentication', async () => {
    const requests: Request[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({ data: { content: '<p>正文内容</p>' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const client = new ZhihuOpenApiClient({ accessSecret: 'test-secret', baseUrl: 'https://developer.test', timeoutMs: 1000, articlePath: '/article-content' })
      await expect(client.fetchArticle({ externalId: 'article-1', url: 'https://www.zhihu.com/article/1' })).resolves.toBe('<p>正文内容</p>')
      expect(requests[0]?.url).toBe('https://developer.test/article-content?Id=article-1')
      expect(requests[0]?.headers.get('authorization')).toBe('Bearer test-secret')
      expect(requests[0]?.headers.get('x-request-timestamp')).toMatch(/^\d+$/)
    } finally { globalThis.fetch = originalFetch }
  })
})
