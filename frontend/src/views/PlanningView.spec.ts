// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlanningView from './PlanningView.vue'
import { usePlanningAgentStore } from '@/stores/planningAgent'
import type { AgentPlanningSession, PlanningAssessment, PlanningRequirementBrief, PlanningStage } from '@/types/product'

function assessment(status: PlanningAssessment['status']): PlanningAssessment {
  return {
    id: 'assessment-1', planningSessionId: 'session-1', version: 1, status,
    questions: status === 'answering' ? [{ id: 'q-1', key: 'q1', position: 1, dimensionKey: 'foundation', difficulty: 'foundation', type: 'single_choice', prompt: '如何排查问题？', options: [{ value: 'logs', label: '先看日志' }] }] : [],
    answers: {}, skipped: [], currentQuestionIndex: 0,
    progress: { completed: 0, total: 12, current: 1, label: '水平测评' },
    summary: status === 'completed' || status === 'abandoned' ? { dimensions: [] } : null,
    error: null, updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

function requirementBrief(status: PlanningRequirementBrief['status'] = 'draft'): PlanningRequirementBrief {
  return { id: 'brief-1', version: 1, status, confirmedAt: status === 'confirmed' ? '2026-09-16T00:00:00.000Z' : null, updatedAt: '2026-09-16T00:00:00.000Z', content: { goal: '学习 MySQL', targetOutcome: '能独立优化查询', deadline: '三个月', weeklyCommitment: '每周 6 小时', preferredDeliverable: '一个案例', constraints: [], priorities: [], evidenceNotes: [], openQuestions: [] } }
}

function session(stage: PlanningStage, currentAssessment: PlanningAssessment | null): AgentPlanningSession {
  return {
    id: 'session-1', learnerId: 'learner-1', goal: '学习 MySQL', status: 'active', mode: 'agent', agentStatus: 'idle', stage,
    progress: currentAssessment?.progress ?? { completed: 1, total: 3, current: 2, label: '基础了解' },
    readiness: { canGenerateRoadmap: false, blockers: ['assessment_not_terminal'], nextAction: '补充一个真实经验' },
    assessment: currentAssessment, requirementBrief: stage === 'ready' ? requirementBrief('confirmed') : null, revision: 1,
    messages: [{ id: 'message-1', sequence: 1, role: 'assistant', content: '请介绍一下你的经验。', metadata: {}, createdAt: '2026-09-16T00:00:00.000Z' }],
    requiredTopics: [], profile: null, resume: null, roadmapId: null, roadmapGeneration: null,
    createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

describe('PlanningView stage rendering', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  async function mountFor(stage: PlanningStage, currentAssessment: PlanningAssessment | null) {
    const planning = usePlanningAgentStore()
    const currentSession = session(stage, currentAssessment)
    planning.session = currentSession
    planning.assessment = currentAssessment
    vi.spyOn(planning, 'load').mockResolvedValue(currentSession)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/planning/:sessionId', name: 'planning', component: PlanningView },
        { path: '/roadmap-preview/:roadmapId', name: 'roadmap-preview', component: { template: '<div>roadmap</div>' } },
      ],
    })
    await router.push('/planning/session-1')
    const host = document.createElement('div')
    const app = createApp(PlanningView).use(pinia).use(router)
    app.mount(host)
    await nextTick()
    return { app, host }
  }

  it.each([
    ['assessment_preparing', assessment('preparing')],
    ['assessment_answering', assessment('answering')],
    ['assessment_evaluating', assessment('evaluating')],
  ] as const)('shows only the assessment experience during %s', async (stage, currentAssessment) => {
    const { app, host } = await mountFor(stage, currentAssessment)

    expect(host.querySelector('.assessment-card')).not.toBeNull()
    expect(host.querySelector('.planning-chat')).toBeNull()
    expect(host.querySelector('textarea[aria-label="发送给知行 Planner"]')).toBeNull()
    expect(host.querySelector('.generation-blocked')).toBeNull()
    app.unmount()
  })

  it('restores chat after assessment for requirements while retaining the terminal summary', async () => {
    const { app, host } = await mountFor('requirements', assessment('completed'))

    expect(host.querySelector('.assessment-card')).not.toBeNull()
    expect(host.querySelector('.assessment-compact')).not.toBeNull()
    expect(host.querySelector('.next-step-banner')?.textContent).toContain('下一步：确认你的学习要求')
    expect(host.querySelector('.requirements-flow')).not.toBeNull()
    expect(host.querySelector('.planning-chat')).not.toBeNull()
    expect(host.querySelector('textarea[aria-label="发送给知行 Planner"]')).not.toBeNull()
    app.unmount()
  })

  it('uses a dedicated confirmation view after requirements are confirmed', async () => {
    const { app, host } = await mountFor('ready', assessment('completed'))

    expect(host.querySelector('.roadmap-ready-card')).not.toBeNull()
    expect(host.textContent).toContain('开始生成我的路线')
    expect(host.querySelector('.assessment-card')).toBeNull()
    expect(host.querySelector('.planning-chat')).toBeNull()
    expect(host.querySelector('textarea[aria-label="发送给知行 Planner"]')).toBeNull()
    app.unmount()
  })

  it('uses a dedicated generation view without the conversation composer', async () => {
    const { app, host } = await mountFor('generating', assessment('completed'))

    expect(host.querySelector('.roadmap-generation-card')).not.toBeNull()
    expect(host.textContent).toContain('正在生成你的学习路线')
    expect(host.querySelector('.assessment-card')).toBeNull()
    expect(host.querySelector('.planning-chat')).toBeNull()
    app.unmount()
  })
})
