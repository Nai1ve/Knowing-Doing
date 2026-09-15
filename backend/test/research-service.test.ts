import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { MixedGymService } from '../src/mixed-gym-service.js'
import { ResearchService } from '../src/research-service.js'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from '../src/zhihu-openapi.js'
import { ZhihuGateway, ZHIHU_OAUTH_CALLBACK } from '../src/zhihu-gateway.js'
import type { EnvironmentBuildOrchestrator } from '../src/gym-build-service.js'
import type { PracticeCardGenerationInput, PracticeCardGenerator } from '../src/practice-card-generator.js'
import type { SourceItem } from '../src/product-types.js'

type StubHandlers = {
  search?: (query: string, count?: number) => Promise<SourceItem[]> | SourceItem[]
  globalSearch?: (query: string, count?: number) => Promise<SourceItem[]> | SourceItem[]
  recommendQuestions?: (query?: string, count?: number) => Promise<Array<{ title: string; url: string }>> | Array<{ title: string; url: string }>
  research?: (input: { goal: string; profileSummary: string; nodeTitle: string }) => Promise<string> | string
}

class StubZhihu extends ZhihuOpenApiClient {
  public searchCalls = 0
  public globalSearchCalls = 0
  public recommendCalls = 0
  public researchCalls = 0
  constructor(private readonly handlers: StubHandlers = {}) {
    super({ accessSecret: 'test-access-secret', baseUrl: 'https://developer.test', timeoutMs: 1000 })
  }
  override async search(query: string, count = 5): Promise<SourceItem[]> { this.searchCalls += 1; return this.handlers.search ? this.handlers.search(query, count) : [] }
  override async globalSearch(query: string, count = 5): Promise<SourceItem[]> { this.globalSearchCalls += 1; return this.handlers.globalSearch ? this.handlers.globalSearch(query, count) : [] }
  override async recommendQuestions(query?: string, count = 5): Promise<Array<{ title: string; url: string }>> { this.recommendCalls += 1; return this.handlers.recommendQuestions ? this.handlers.recommendQuestions(query, count) : [] }
  override async research(input: { goal: string; profileSummary: string; nodeTitle: string }): Promise<string> { this.researchCalls += 1; return this.handlers.research ? this.handlers.research(input) : '直答研究辅助。' }
}

function searchItem(title: string, url: string, excerpt: string): SourceItem {
  return { id: url, provider: 'zhihu', externalId: url, title, author: '作者', url, excerpt, query: 'x', retrievedAt: new Date().toISOString(), metadata: {} }
}

function validCard() {
  return {
    title: '模型生成卡', summary: '结合来源完成一次验证。',
    activities: [
      { id: 'concept', type: 'concept' as const, title: '概念', prompt: '建立框架。', required: true },
      { id: 'check-a', type: 'knowledge_check' as const, title: '证据', prompt: '先做什么？', options: [{ value: 'observe', label: '观察' }, { value: 'guess', label: '猜测' }], required: true, core: true },
      { id: 'check-b', type: 'knowledge_check' as const, title: '边界', prompt: '如何迁移？', options: [{ value: 'boundary', label: '说明边界' }, { value: 'copy', label: '照搬' }], required: true, core: true },
      { id: 'predict', type: 'scenario_reasoning' as const, title: '预测', prompt: '写下预测。', required: true },
      { id: 'reflect', type: 'reflection' as const, title: '反思', prompt: '记录反思。', required: true },
    ],
    answerKey: { 'check-a': 'observe', 'check-b': 'boundary' }, hints: { 'check-a': '看证据。', 'check-b': '看边界。' },
    explanations: { 'check-a': '观察优先。', 'check-b': '边界保证迁移。' }, references: { 'check-a': 'observe', 'check-b': 'boundary' },
  }
}

function setup(learningMode: 'knowledge' | 'lab' = 'knowledge') {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-research-'))
  const database = path.join(directory, 'product.db')
  applyProductMigrations(database)
  const repository = new ProductRepository(database)
  const learnerId = `research-${learningMode}`
  const timestamp = new Date().toISOString()
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO intakes(id,learner_id,goal,technology,status,created_at,updated_at) VALUES('intake',?,'学习数据库','MySQL','active',?,?)").run(learnerId, timestamp, timestamp)
  repository.db.prepare("INSERT INTO learning_roadmaps(id,learner_id,template_key,goal,status,revision,input_snapshot_json,created_at,updated_at) VALUES('roadmap',?,'test','学习数据库','active',1,'{}',?,?)").run(learnerId, timestamp, timestamp)
  repository.db.prepare("INSERT INTO roadmap_nodes(id,roadmap_id,parent_id,node_key,node_type,title,summary,knowledge_card_json,completion_standard,estimated_minutes,priority,position,learning_mode,capability_key,case_id,created_at) VALUES('node','roadmap',NULL,'explain','concept','EXPLAIN 判断','理解执行计划','{}','能用证据解释执行计划',45,1,1,?,'mysql.explain-plan',NULL,?)").run(learningMode, timestamp)
  repository.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id,node_id,status,source,revision,updated_at) VALUES('roadmap','node','available','test',1,?)").run(timestamp)
  repository.db.prepare("INSERT INTO learning_plans(id,learner_id,intake_id,title,goal,source_status,status,roadmap_id,created_at,updated_at) VALUES('plan',?,'intake','数据库路线','学习数据库','local','active','roadmap',?,?)").run(learnerId, timestamp, timestamp)
  repository.db.prepare("INSERT INTO plan_units(id,plan_id,position,title,objective,status,source_refs_json,availability,learning_mode,estimated_minutes,rationale,roadmap_node_id) VALUES('unit','plan',1,'EXPLAIN 判断','能用证据解释执行计划','current','[]','available',?,45,'诊断缺口','node')").run(learningMode)
  const builds = {
    create() { throw new Error('runtime build should not be called by these tests') },
    get() { throw new Error('build readiness must not be treated as user verification') },
    async start() { throw new Error('runtime should not be started by these tests') },
  } as unknown as EnvironmentBuildOrchestrator
  return { directory, repository, learnerId, builds }
}

function cardService(repository: ProductRepository, builds: EnvironmentBuildOrchestrator, zhihu: StubZhihu, capture: (input: PracticeCardGenerationInput) => void) {
  const generator: PracticeCardGenerator = { async generate(input) { capture(input); return validCard() } }
  const research = new ResearchService(repository, zhihu)
  return new MixedGymService(repository, builds, generator, undefined, research)
}

describe('research orchestration behind the Practice Card route', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

  it('keeps low-relevance candidates off the card and still generates a pure route card', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const zhihu = new StubZhihu({
      search: () => [searchItem('不相关内容', 'https://www.zhihu.com/p/irrelevant', '与学习目标无关的新闻')],
    })
    let generationInput: PracticeCardGenerationInput | undefined
    const service = cardService(state.repository, state.builds, zhihu, (input) => { generationInput = input })

    const card = await service.createCard(state.learnerId, 'unit', 'low-relevance-card')
    expect(card.sourceReferences).toHaveLength(0)
    expect(generationInput?.sources).toHaveLength(0)
    const statuses = state.repository.db.prepare("SELECT DISTINCT status FROM research_queries WHERE learner_id=?").all(state.learnerId) as Array<{ status: string }>
    expect(statuses.map((row) => row.status)).toEqual(expect.arrayContaining(['succeeded']))
  })

  it('dedupes the same article across provider classes into one adopted source', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const zhihu = new StubZhihu({
      search: () => [searchItem('EXPLAIN 判断', 'https://www.zhihu.com/p/search-a', '用执行计划验证索引命中。')],
      globalSearch: () => [searchItem('EXPLAIN 判断', 'https://example.test/p/global-b', '用执行计划验证索引命中。')],
    })
    const research = new ResearchService(state.repository, zhihu)

    const outcome = await research.researchForCard(state.learnerId, {
      planUnitId: 'unit', objective: '能用证据解释执行计划', capabilityIds: ['mysql.explain-plan'],
      learnerLevel: 'junior', learnerGaps: ['explain'], roadmapNodeId: 'node',
      sourceQuery: { concepts: ['explain', '执行计划'], scenarios: [], exclusions: [] },
    })
    expect(outcome.candidates).toHaveLength(1)
    expect(outcome.candidates[0]?.canonicalUrl).toBe('https://www.zhihu.com/p/search-a')
    expect(outcome.adopted).toHaveLength(1)
    expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM research_candidates WHERE learner_id=?").get(state.learnerId)).toMatchObject({ count: 3 })
  })

  it('classifies a rate-limited provider class and still generates a card', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const zhihu = new StubZhihu({
      search: () => { throw new ZhihuOpenApiError('zhihu_rate_limited', '知乎开放 API 请求过于频繁') },
      recommendQuestions: () => { throw new ZhihuOpenApiError('zhihu_upstream_unavailable', '知乎开放 API 服务暂时不可用') },
    })
    const service = cardService(state.repository, state.builds, zhihu, () => undefined)

    const card = await service.createCard(state.learnerId, 'unit', 'rate-limited-card')
    expect(card.sourceReferences).toHaveLength(0)
    expect(card.status).toBe('ready')
    const rateLimited = state.repository.db.prepare("SELECT COUNT(*) AS count FROM research_queries WHERE learner_id=? AND provider='zhihu_search' AND status='rate_limited'").get(state.learnerId) as { count: number }
    expect(rateLimited.count).toBeGreaterThan(0)
    const failed = state.repository.db.prepare("SELECT COUNT(*) AS count FROM research_queries WHERE learner_id=? AND provider='question_recommendation' AND status='failed'").get(state.learnerId) as { count: number }
    expect(failed.count).toBeGreaterThan(0)
  })

  it('re-generating the same plan unit hits the cache instead of re-contacting platforms', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const zhihu = new StubZhihu({
      search: () => [searchItem('EXPLAIN 判断', 'https://www.zhihu.com/p/cached', '用执行计划验证索引命中。')],
    })
    const service = cardService(state.repository, state.builds, zhihu, () => undefined)

    const first = await service.createCard(state.learnerId, 'unit', 'idem-1')
    expect(first.sourceReferences).toHaveLength(1)
    const searchCallsAfterFirst = zhihu.searchCalls
    expect(searchCallsAfterFirst).toBeGreaterThan(0)

    const second = await service.createCard(state.learnerId, 'unit', 'idem-2')
    expect(second.sourceReferences).toHaveLength(1)
    expect(second.id).not.toBe(first.id)
    expect(zhihu.searchCalls).toBe(searchCallsAfterFirst)
    const cachedQueries = state.repository.db.prepare("SELECT COUNT(*) AS count FROM research_queries WHERE learner_id=? AND error LIKE 'cached:%'").get(state.learnerId) as { count: number }
    expect(cachedQueries.count).toBeGreaterThan(0)
  })

  it('keeps the direct answer as unverified assistance that never reaches a card', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const zhihu = new StubZhihu({
      research: () => '知识地形：MySQL 执行计划。建议搜索：EXPLAIN 判断、索引命中。',
      search: () => [searchItem('EXPLAIN 判断', 'https://www.zhihu.com/p/direct-search', '用执行计划验证索引命中。')],
    })
    let generationInput: PracticeCardGenerationInput | undefined
    const service = cardService(state.repository, state.builds, zhihu, (input) => { generationInput = input })

    const card = await service.createCard(state.learnerId, 'unit', 'direct-answer-card')
    expect(generationInput?.sources.every((source) => !source.title.includes('直答'))).toBe(true)
    expect(card.sourceReferences.every((ref) => ref.title !== '直答研究辅助')).toBe(true)
    const assist = state.repository.db.prepare("SELECT credibility, retrieval_evidence_json FROM research_candidates WHERE learner_id=? AND provider='direct_answer'").get(state.learnerId) as { credibility: number; retrieval_evidence_json: string } | undefined
    expect(assist).toBeTruthy()
    expect(assist!.credibility).toBeLessThan(0.25)
    expect(JSON.parse(assist!.retrieval_evidence_json)).toEqual(expect.arrayContaining(['direct_answer_unverified', 'research_assistance_only']))
  })

  it('keeps private user sources private and public search results public', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const timestamp = new Date().toISOString()
    state.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,created_at,updated_at)
      VALUES('private-fav',?,'zhihu','private-1','https://www.zhihu.com/p/private-fav','EXPLAIN 判断 私藏','我','执行计划','{}','private','hash-private','active',1,'[]',?,?)
    `).run(state.learnerId, timestamp, timestamp)
    state.repository.db.prepare(`
      INSERT INTO external_source_collections(id,learner_id,connection_id,provider,external_id,kind,title,status,metadata_json,created_at,updated_at)
      VALUES('fav-col',?,NULL,'zhihu','fav-1','favorites','我的收藏夹','active','{}',?,?)
    `).run(state.learnerId, timestamp, timestamp)
    state.repository.db.prepare(`
      INSERT INTO external_source_collection_items(collection_id,source_item_id,position,created_at)
      VALUES('fav-col','private-fav',1,?)
    `).run(timestamp)
    const zhihu = new StubZhihu({
      search: () => [searchItem('EXPLAIN 判断 公开资料', 'https://www.zhihu.com/p/public-search', '执行计划')],
    })
    const service = cardService(state.repository, state.builds, zhihu, () => undefined)

    const card = await service.createCard(state.learnerId, 'unit', 'visibility-card')
    expect(card.sourceReferences).toHaveLength(2)
    const visibilities = (state.repository.db.prepare("SELECT visibility, title FROM research_candidates WHERE learner_id=?").all(state.learnerId) as Array<{ visibility: string; title: string }>)
      .filter((row) => !row.title.includes('直答'))
    expect(visibilities.map((row) => row.visibility).sort()).toEqual(['private', 'public'])
  })

  it('does not let one learner favorites become candidates for another learner', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const otherLearner = 'research-other'
    state.repository.ensureLearner(otherLearner)
    const timestamp = new Date().toISOString()
    state.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,created_at,updated_at)
      VALUES('owner-fav',?,'zhihu','owner-1','https://www.zhihu.com/p/owner','EXPLAIN 判断 我的收藏','我','执行计划','{}','private','hash-owner','active',1,'[]',?,?)
    `).run(state.learnerId, timestamp, timestamp)
    const zhihu = new StubZhihu()
    const research = new ResearchService(state.repository, zhihu)
    const other = await research.researchForCard(otherLearner, {
      planUnitId: 'unit-other', objective: '能用证据解释执行计划', capabilityIds: ['mysql.explain-plan'],
      learnerLevel: 'junior', learnerGaps: [], roadmapNodeId: null,
      sourceQuery: { concepts: ['explain', '执行计划'], scenarios: [], exclusions: [] },
    })
    expect(other.candidates.some((candidate) => candidate.title.includes('我的收藏'))).toBe(false)
    expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM research_candidates WHERE learner_id=? AND provider='user_source'").get(otherLearner)).toMatchObject({ count: 0 })
  })

  it('persists adopted sources so disconnect keeps only card-referenced de-identified snapshots', async () => {
    const state = setup(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const timestamp = new Date().toISOString()
    // A public search item that was stored earlier but is not adopted by this card.
    state.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,created_at,updated_at)
      VALUES('unreferenced-search',?,'zhihu','search-hit','https://www.zhihu.com/p/not-adopted','EXPLAIN 判断 未被采用','作者','执行计划','{}','public','hash-unref','active',0,'[]',?,?)
    `).run(state.learnerId, timestamp, timestamp)
    const zhihu = new StubZhihu({
      search: () => [
        searchItem('EXPLAIN 判断 一', 'https://www.zhihu.com/p/adopted-1', '执行计划'),
        searchItem('EXPLAIN 判断 二', 'https://www.zhihu.com/p/adopted-2', '执行计划'),
      ],
    })
    const service = cardService(state.repository, state.builds, zhihu, () => undefined)
    const card = await service.createCard(state.learnerId, 'unit', 'disconnect-card')
    expect(card.sourceReferences).toHaveLength(2)
    const referencedIds = (state.repository.db.prepare("SELECT source_item_id FROM practice_card_sources WHERE practice_card_id=?").all(card.id) as Array<{ source_item_id: string }>).map((row) => row.source_item_id)
    expect(referencedIds).toHaveLength(2)
    expect(referencedIds).not.toContain('unreferenced-search')

    const gateway = new ZhihuGateway(state.repository, {
      clientId: 'app-id', clientSecret: 'app-key', baseUrl: 'https://oauth.example.test', encryptionKey: 'x'.repeat(32),
      allowInsecureCallback: true, authorizePath: '/authorize', tokenPath: '/access_token',
      dataPlatformBaseUrl: 'https://developer.zhihu.com', dataPlatformAccessSecret: 'secret',
      collectionsPath: '/api/v1/user/collections', contentPath: '/api/v1/user/contents', followeesPath: '/api/v1/user/followees',
      favlistsPath: '/api/v1/user/favlists', favlistContentsPath: '/api/v1/user/favlist_contents',
      redirectUri: ZHIHU_OAUTH_CALLBACK, scopes: 'read collections',
    })
    gateway.disconnect(state.learnerId)

    // The unreferenced public search item is gone; the two card-referenced
    // snapshots survive de-identified and marked removed.
    expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM learner_source_items WHERE learner_id=? AND id='unreferenced-search'").get(state.learnerId)).toMatchObject({ count: 0 })
    const kept = state.repository.db.prepare("SELECT status, content_json FROM learner_source_items WHERE id IN (?, ?)").all(...referencedIds) as Array<{ status: string; content_json: string }>
    expect(kept).toHaveLength(2)
    expect(kept.every((row) => row.status === 'removed')).toBe(true)
    expect(kept.every((row) => JSON.stringify(JSON.parse(row.content_json)) === '{}')).toBe(true)
  })
})

describe('research object model tables', () => {
  it('persists queries, candidates, and cache records for a research run', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-research-model-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    try {
      repository.ensureLearner('model-learner')
      const zhihu = new StubZhihu({
        search: () => [searchItem('EXPLAIN 判断', 'https://www.zhihu.com/p/model', '执行计划')],
        recommendQuestions: () => [{ title: '如何理解执行计划？', url: 'https://www.zhihu.com/question/9' }],
      })
      const research = new ResearchService(repository, zhihu)
      await research.researchForCard('model-learner', {
        planUnitId: 'unit', objective: '能用证据解释执行计划', capabilityIds: ['mysql.explain-plan'],
        learnerLevel: 'junior', learnerGaps: [], roadmapNodeId: null,
        sourceQuery: { concepts: ['explain', '执行计划'], scenarios: [], exclusions: [] },
      })
      expect(repository.db.prepare("SELECT COUNT(*) AS count FROM research_queries WHERE learner_id='model-learner'").get()).toMatchObject({ count: 5 })
      expect(repository.db.prepare("SELECT COUNT(*) AS count FROM research_candidates WHERE learner_id='model-learner'").get()).toMatchObject({ count: 3 })
      expect(repository.db.prepare("SELECT COUNT(*) AS count FROM research_query_cache WHERE learner_id='model-learner'").get()).toMatchObject({ count: 4 })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
