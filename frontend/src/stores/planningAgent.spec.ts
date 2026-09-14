// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAgentPlanningSession, createPlanningAssessment, getPlanningAssessment, getPlanningResume } from '@/api/planningService'
import type { AgentPlanningSession, PlanningAssessment } from '@/types/product'
import { usePlanningAgentStore } from './planningAgent'

vi.mock('@/api/planningService', () => ({
  confirmPlanningRequirementBrief: vi.fn(),
  createAgentPlanningSession: vi.fn(),
  createAgentPlanningSessionDraft: vi.fn(),
  createAgentRoadmap: vi.fn(),
  createPlanningAssessment: vi.fn(),
  finalizePlanningAssessment: vi.fn(),
  getAgentPlanningSession: vi.fn(),
  getPlanningResume: vi.fn(),
  getAgentPlanningState: vi.fn(),
  getAgentRoadmapGeneration: vi.fn(),
  getPlanningAssessment: vi.fn(),
  getPlanningAssessmentReview: vi.fn(),
  retryAgentInvocation: vi.fn(),
  retryAgentRoadmap: vi.fn(),
  savePlanningAssessmentAnswers: vi.fn(),
  sendAgentPlanningMessage: vi.fn(),
  sendPlanningRequirementsMessage: vi.fn(),
  uploadPlanningResume: vi.fn(),
}))

const baseSession = (overrides: Partial<AgentPlanningSession> = {}): AgentPlanningSession => ({
  id: 'session-1',
  learnerId: 'learner-1',
  goal: '成为可靠的后端工程师',
  status: 'active',
  mode: 'agent',
  agentStatus: 'idle',
  stage: 'baseline',
  progress: { completed: 0, total: 3, current: 1, label: '基础了解' },
  readiness: { canGenerateRoadmap: false, blockers: ['assessment_not_terminal'], nextAction: '补充一个具体经历' },
  assessment: null,
  requirementBrief: null,
  revision: 1,
  messages: [],
  requiredTopics: [],
  profile: null,
  resume: null,
  roadmapId: null,
  roadmapGeneration: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
})

const failedAssessment = (sessionId = 'session-1'): PlanningAssessment => ({
  id: 'assessment-failed',
  planningSessionId: sessionId,
  version: 1,
  status: 'failed',
  questions: [],
  answers: {},
  skipped: [],
  currentQuestionIndex: 0,
  progress: { completed: 0, total: 12, current: 1, label: '水平测评' },
  summary: null,
  error: 'schema validation details: rubric is invalid',
  updatedAt: '2026-09-14T00:00:00.000Z',
})

describe('planningAgent assessment recovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps three-turn baseline progress from the server session DTO', async () => {
    vi.mocked(getAgentPlanningSession).mockResolvedValue(baseSession({
      messages: Array.from({ length: 3 }, (_, index) => ({ id: `message-${index}`, sequence: index + 1, role: 'user', content: '具体经历', metadata: {}, createdAt: '2026-09-14T00:00:00.000Z' })),
      progress: { completed: 3, total: 3, current: 3, label: '基础了解' },
    }))

    const store = usePlanningAgentStore()
    await store.load('session-1')

    expect(store.session?.progress).toMatchObject({ completed: 3, total: 3, current: 3 })
  })

  it('leaves a loaded failure to server-side recovery and retries once explicitly', async () => {
    vi.mocked(getAgentPlanningSession).mockResolvedValue(baseSession({ stage: 'assessment_preparing', assessment: failedAssessment() }))
    vi.mocked(createPlanningAssessment).mockResolvedValue({ ...failedAssessment(), id: 'assessment-retry', status: 'answering', error: null })

    const store = usePlanningAgentStore()
    await store.load('session-1')

    // The backend regenerates a failed assessment when the planner reopens, so
    // the client must not race it with a duplicate create call. A failure that
    // still surfaces here was already auto-recovered once; retry stays manual.
    expect(createPlanningAssessment).not.toHaveBeenCalled()
    expect(store.assessmentError).toContain('已保存的对话和画像仍然保留')

    await store.retryAssessment()
    expect(createPlanningAssessment).toHaveBeenCalledTimes(1)
    expect(store.assessment?.status).toBe('answering')

    await store.retryAssessment()
    expect(createPlanningAssessment).toHaveBeenCalledTimes(1)
  })

  it('surfaces the stable-protocol notice when the server recovered the assessment', async () => {
    const recovered = { ...failedAssessment(), id: 'assessment-recovered', status: 'answering' as const, error: null, recoveredFromFailure: true }
    vi.mocked(getAgentPlanningSession).mockResolvedValue(baseSession({ stage: 'assessment_answering', assessment: recovered }))
    vi.mocked(getPlanningAssessment).mockResolvedValue(recovered)

    const store = usePlanningAgentStore()
    await store.load('session-1')

    expect(store.assessmentRecoveryNotice).toContain('已使用稳定生成协议重新准备测评')
    expect(store.assessmentError).toBeNull()
    expect(store.assessment?.status).toBe('answering')
  })

  it('reuses the same request identity while recovering an in-flight preparation', async () => {
    vi.mocked(getAgentPlanningSession).mockResolvedValue(baseSession({ stage: 'assessment_preparing' }))
    vi.mocked(createPlanningAssessment)
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ ...failedAssessment(), id: 'assessment-ready', status: 'answering', error: null })

    const store = usePlanningAgentStore()
    await store.load('session-1')
    await store.ensureAssessment()

    expect(createPlanningAssessment).toHaveBeenCalledTimes(2)
    const firstRequestId = vi.mocked(createPlanningAssessment).mock.calls[0]?.[1]
    const secondRequestId = vi.mocked(createPlanningAssessment).mock.calls[1]?.[1]
    expect(firstRequestId).toBeTruthy()
    expect(secondRequestId).toBe(firstRequestId)
    expect(sessionStorage.getItem('zhixing.planning.assessment.request.session-1')).toBeNull()
  })

  it('continues polling a server-owned preparation after refresh', async () => {
    vi.mocked(getAgentPlanningSession).mockResolvedValue(baseSession({
      stage: 'assessment_preparing',
      assessment: { ...failedAssessment(), status: 'preparing', error: null },
    }))
    vi.mocked(getPlanningAssessment).mockResolvedValue({ ...failedAssessment(), id: 'assessment-ready', status: 'answering', error: null })

    const store = usePlanningAgentStore()
    await store.load('session-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getPlanningAssessment).toHaveBeenCalledWith('assessment-failed')
    expect(store.assessment?.status).toBe('answering')
    expect(store.assessmentLoading).toBe(false)
  })

  it('polls a pending PDF after refresh and stops when parsing is ready', async () => {
    vi.useFakeTimers()
    const pending = baseSession({ resume: { id: 'resume-1', learnerId: 'learner-1', planningSessionId: 'session-1', originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', parseStatus: 'pending', pageCount: 0, textLength: 0, parseError: null, version: 1, includedAt: '2026-09-14T00:00:00.000Z', includedInPlanningContext: false, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z' } })
    const ready = { ...pending, resume: { ...pending.resume!, parseStatus: 'ready' as const, pageCount: 2, textLength: 640, includedInPlanningContext: true } }
    vi.mocked(getAgentPlanningSession).mockResolvedValueOnce(pending)
    vi.mocked(getPlanningResume).mockResolvedValueOnce(ready.resume)

    const store = usePlanningAgentStore()
    await store.load('session-1')
    expect(store.resumeParsing).toBe(true)

    await vi.advanceTimersByTimeAsync(700)
    expect(getPlanningResume).toHaveBeenCalledWith('session-1')
    expect(store.session?.resume?.parseStatus).toBe('ready')
    expect(store.resumeParsing).toBe(false)
  })

  it('stops PDF polling at the maximum attempt count', async () => {
    vi.useFakeTimers()
    const pending = baseSession({ resume: { id: 'resume-1', learnerId: 'learner-1', planningSessionId: 'session-1', originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', parseStatus: 'processing', pageCount: 0, textLength: 0, parseError: null, version: 1, includedAt: '2026-09-14T00:00:00.000Z', includedInPlanningContext: false, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z' } })
    vi.mocked(getAgentPlanningSession).mockResolvedValue(pending)
    vi.mocked(getPlanningResume).mockResolvedValue(pending.resume)

    const store = usePlanningAgentStore()
    await store.load('session-1')
    await vi.advanceTimersByTimeAsync(15000)

    expect(getPlanningResume).toHaveBeenCalledTimes(8)
    expect(store.resumeParsing).toBe(false)
    expect(store.resumePollExhausted).toBe(true)
  })
})
