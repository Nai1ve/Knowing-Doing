import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { MixedGymService } from '../src/mixed-gym-service.js'
import type { EnvironmentBuildOrchestrator } from '../src/gym-build-service.js'

function setup(learningMode: 'knowledge' | 'lab' = 'knowledge') {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-mixed-gym-'))
  const database = path.join(directory, 'product.db')
  applyProductMigrations(database)
  const repository = new ProductRepository(database)
  const learnerId = `mixed-${learningMode}`
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
  return { directory, repository, learnerId, service: new MixedGymService(repository, builds) }
}

function answer(service: MixedGymService, learnerId: string, sessionId: string, activityId: string, value: string, key: string) {
  service.draft(learnerId, sessionId, activityId, value, `${key}:draft`)
  return service.submitActivity(learnerId, sessionId, activityId, `${key}:submit`)
}

describe('Practice Card and mixed Gym contracts', () => {
  it('keeps private answers out of public DTOs and reveals an explanation only after the second failed attempt', () => {
    const state = setup()
    try {
      const card = state.service.createCard(state.learnerId, 'unit', 'card-1')
      expect(card.activities).toHaveLength(5)
      expect(card.activities.filter((activity: { type: string }) => activity.type === 'knowledge_check')).toHaveLength(2)
      expect(JSON.stringify(card)).not.toMatch(/answerKey|rubric|references|可靠判断应先记录/)
      expect(card).toMatchObject({ mode: 'knowledge_only', sourceReferences: [] })
      expect(state.service.createCard(state.learnerId, 'unit', 'card-1').id).toBe(card.id)
      const session = state.service.startSession(state.learnerId, card.id, 'session-1')
      state.service.draft(state.learnerId, session.id, 'knowledge-1', 'change-first', 'same-draft')
      expect(() => state.service.draft(state.learnerId, session.id, 'knowledge-1', 'evidence-first', 'same-draft')).toThrow(/幂等键/)
      const first = answer(state.service, state.learnerId, session.id, 'knowledge-1', 'change-first', 'attempt-1')
      expect(first).not.toHaveProperty('referenceAnswer')
      const second = answer(state.service, state.learnerId, session.id, 'knowledge-1', 'change-first', 'attempt-2')
      expect(second).toHaveProperty('referenceAnswer')
      expect(() => answer(state.service, state.learnerId, session.id, 'knowledge-1', 'evidence-first', 'attempt-3')).toThrow('最多两次')
      const events = state.service.sessionEvents(state.learnerId, session.id)
      expect(JSON.stringify(events)).not.toContain('change-first')
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('marks a fully attempted knowledge card with wrong core knowledge as completed_with_gaps', () => {
    const state = setup()
    try {
      const card = state.service.createCard(state.learnerId, 'unit', 'card-gaps')
      const session = state.service.startSession(state.learnerId, card.id, 'session-gaps')
      answer(state.service, state.learnerId, session.id, 'knowledge-1', 'change-first', 'g1')
      answer(state.service, state.learnerId, session.id, 'knowledge-2', 'boundary-first', 'g2')
      answer(state.service, state.learnerId, session.id, 'scenario', '我会先记录 rows 与 key，再用结果推翻假设。', 'g3')
      const completed = state.service.complete(state.learnerId, session.id, '这次我会先验证执行计划，再决定是否调整索引。', 'complete-gaps')
      expect(completed.outcome).toBe('completed_with_gaps')
      expect(completed.session.stage).toBe('completed')
      expect(state.repository.db.prepare("SELECT status FROM plan_units WHERE id='unit'").get()).toMatchObject({ status: 'completed' })
      expect(state.service.complete(state.learnerId, session.id, 'ignored replay', 'complete-gaps').outcome).toBe('completed_with_gaps')
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('requires a server-resolved runtime practice before a mixed card can be verified', () => {
    const state = setup('lab')
    try {
      const card = state.service.createCard(state.learnerId, 'unit', 'mixed-card')
      expect(card.mode).toBe('mixed')
      const session = state.service.startSession(state.learnerId, card.id, 'mixed-session')
      answer(state.service, state.learnerId, session.id, 'knowledge-1', 'evidence-first', 'm1')
      answer(state.service, state.learnerId, session.id, 'knowledge-2', 'boundary-first', 'm2')
      answer(state.service, state.learnerId, session.id, 'scenario', '我会先预测访问行数，再用实际执行结果验证。', 'm3')
      const completed = state.service.complete(state.learnerId, session.id, '我会记录预测与实际结果的差异，并继续验证索引边界。', 'm-complete')
      expect(completed.outcome).toBe('incomplete')
      expect(state.repository.db.prepare("SELECT status FROM plan_units WHERE id='unit'").get()).toMatchObject({ status: 'current' })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })
})
