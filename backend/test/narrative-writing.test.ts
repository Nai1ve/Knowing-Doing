import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { WritingService } from '../src/writing-service.js'
import type { NarrativeWritingAgentProvider } from '../src/writing-agent.js'

describe('narrative writing', () => {
  it('indexes mixed practice records and persists a narrative article after humanizing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-narrative-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    try {
      repository.ensureLearner('learner-1')
      const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
      const artifact = repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: '我想弄清楚这个实践为什么变慢。', metadata: {} })
      const event = repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'user_message', stage: 'observe', payload: { message: artifact.content }, artifactRefs: [artifact.id] })
      repository.updatePracticeRun(run.id, { stage: 'resolved', status: 'resolved' })
      const agent: NarrativeWritingAgentProvider = {
        providerName: 'test', modelName: 'test-model',
        generate: vi.fn(),
        generateNarrative: vi.fn(async () => `# 一次实践复盘\n\n我先从问题开始。[[ref:artifact:${artifact.id}]][[ref:event:${event.id}]]\n\n> 这条记录改变了我的判断。`),
        humanize: vi.fn(async (markdown) => markdown.replace('我先从问题开始。', '我先从问题开始查。')),
      }
      const service = new WritingService(repository, undefined, agent)
      const draft = service.enqueueAutoDraft(run.id)!
      await vi.waitFor(() => expect(service.workspace(run.id).draftRun?.phase).toBe('ready'))
      const workspace = service.workspace(run.id)
      const article = workspace.project?.documents.find((document) => document.kind === 'article')
      expect(article?.format).toBe('narrative')
      expect(article?.contentMarkdown).toContain('我先从问题开始查。')
      expect(article?.blocks.map((block) => block.blockType)).toEqual(['heading', 'paragraph', 'quote'])
      expect(article?.blocks[0]?.content).toBe('一次实践复盘')
      expect(article?.blocks[2]?.content).toBe('这条记录改变了我的判断。')
      expect(repository.listWritingEvidenceItems(workspace.draftRun!.evidencePackId!, '想弄清楚').length).toBeGreaterThanOrEqual(1)
      expect(repository.getWritingGenerationJob(workspace.draftRun!.draftJobId!).kind).toBe('draft')
      expect(repository.getWritingGenerationJob(workspace.draftRun!.humanizeJobId!).kind).toBe('humanize')
      const paragraph = article!.blocks.find((block) => block.blockType === 'paragraph')!
      const evidence = service.blockEvidence(run.id, article!.id, paragraph.id)
      expect(evidence.references.map((reference) => reference.refType)).toEqual(['artifact', 'event'])
      const edited = service.editBlock(run.id, article!.id, paragraph.id, paragraph.revision, '我改成了自己的表达。')
      expect(edited.contentMarkdown).toContain('我改成了自己的表达。')
      expect(() => service.editBlock(run.id, article!.id, paragraph.id, paragraph.revision, '过期修改')).toThrow()
      expect(draft.id).toBe(workspace.draftRun!.id)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
