import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentPlanningService, type PlanningProvider } from '../src/agent-planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

describe('P2 Python list route', () => {
  it('materializes a workspace node with the server-resolved capability', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-p2-route-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    const provider: PlanningProvider = {
      providerName: 'test',
      modelName: 'test-model',
      async stream(_input, onDelta) { await onDelta('可以继续补充，也可以生成路线。'); return '可以继续补充，也可以生成路线。' },
      async interpret() { return { coveredTopics: ['goal_deadline'], dimensions: [], evidence: [], followUpTopic: null } },
    }
    try {
      const service = new AgentPlanningService(repository, provider)
      const session = service.createSession('p2-route-learner', { message: '我想学习 Python list 的创建、索引、切片和可变性', clientRequestId: 'p2-route-start' })
      await service.streamMessage('p2-route-learner', session.id, session.goal, 'p2-route-start', async () => undefined)
      const generation = await service.generateRoadmap('p2-route-learner', session.id, 'p2-route-generate')
      await vi.waitFor(() => expect(service.getRoadmapGeneration('p2-route-learner', generation.id).status).toBe('succeeded'))
      const roadmapId = service.getRoadmapGeneration('p2-route-learner', generation.id).roadmapId!
      const node = repository.db.prepare("SELECT learning_mode, capability_key, case_id FROM roadmap_nodes WHERE roadmap_id = ? AND node_key = 'python-list'").get(roadmapId) as { learning_mode: string; capability_key: string; case_id: string | null }
      expect(node).toEqual({ learning_mode: 'workspace', capability_key: 'python.collections.list', case_id: null })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
