import { defineStore } from 'pinia'
import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { confirmPlanningRequirementBrief, createAgentPlanningSession, createAgentPlanningSessionDraft, createAgentRoadmap, createPlanningAssessment, finalizePlanningAssessment, getAgentPlanningSession, getAgentPlanningState, getAgentRoadmapGeneration, getPlanningAssessment, getPlanningAssessmentReview, getPlanningResume, retryAgentInvocation, retryAgentRoadmap, savePlanningAssessmentAnswers, sendAgentPlanningMessage, sendPlanningRequirementsMessage, uploadPlanningResume } from '@/api/planningService'
import type { AgentPlanningSession, AgentPlanningState, AgentRoadmapGeneration, PlanningAssessment, PlanningAssessmentAnswer, PlanningAssessmentReview, PlanningReadiness, PlanningRequirementBrief, PlanningStreamEvent } from '@/types/product'
import { createClientId } from '@/utils/client-id'
import { hasApiErrorCode } from '@/api/client'

export const usePlanningAgentStore = defineStore('planningAgent', () => {
  const session = ref<AgentPlanningSession | null>(null); const state = ref<AgentPlanningState | null>(null); const stateLoading = ref(false); const streaming = ref(false); const generating = ref(false); const generation = ref<AgentRoadmapGeneration | null>(null); const streamingAssistant = ref(''); const question = ref(''); const canGenerateRoadmap = ref(false); const error = ref<string | null>(null); const loadError = ref<string | null>(null); const resumeNotice = ref<string | null>(null); const failedInvocationId = ref<string | null>(null)
  const assessment = ref<PlanningAssessment | null>(null); const assessmentLoading = ref(false); const assessmentSaving = ref(false); const assessmentError = ref<string | null>(null); const assessmentRecoveryNotice = ref<string | null>(null); const assessmentReview = ref<PlanningAssessmentReview | null>(null); const reviewLoading = ref(false); const requirementSaving = ref(false)
  const resumeParsing = ref(false); const resumePollExhausted = ref(false); const resumePollError = ref<string | null>(null)
  const assessmentRequestIds = new Map<string, string>()
  let pollingToken = 0
  let pollingPromise: Promise<void> | null = null
  let assessmentPollingToken = 0
  let assessmentPollingPromise: Promise<void> | null = null
  let resumePollingToken = 0
  let resumePollingPromise: Promise<void> | null = null
  const terminalStatuses = new Set<AgentRoadmapGeneration['status']>(['succeeded', 'failed', 'interrupted'])
  const resumePendingStatuses = new Set(['pending', 'processing'])
  const resumePollMaximum = 8
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
  function stopPolling() { pollingToken += 1; pollingPromise = null; generating.value = false; assessmentPollingToken += 1; assessmentPollingPromise = null; assessmentLoading.value = false; assessmentRecoveryNotice.value = null; resumePollingToken += 1; resumePollingPromise = null; resumeParsing.value = false }
  function applyReadiness(value: PlanningReadiness | null | undefined) { if (!value) return; if (session.value) session.value.readiness = value; canGenerateRoadmap.value = value.canGenerateRoadmap }
  function applySession(value: AgentPlanningSession) { session.value = value; if (!value.resume || !resumePendingStatuses.has(value.resume.parseStatus)) { resumePollExhausted.value = false; resumePollError.value = null }; applyReadiness(value.readiness); question.value = value.readiness?.nextAction ?? question.value; if (value.assessment) { applyAssessment(value.assessment); resumeAssessmentPolling(value.assessment) } }
  function safeAssessmentMessage(message: string | null | undefined): string | null {
    if (!message) return null
    if (/校验|验证|rubric|reference|参考答案|schema|validation|zod|json/i.test(message)) return '评估题目暂时没有准备好，但已保存的对话和画像仍然保留，可以安全重试。'
    return message
  }
  function assessmentErrorMessage(cause: unknown, fallback: string): string {
    return safeAssessmentMessage(cause instanceof Error ? cause.message : null) ?? fallback
  }
  function requestIdForAssessment(sessionId: string, rotate = false): string {
    const storageKey = `zhixing.planning.assessment.request.${sessionId}`
    if (rotate) {
      assessmentRequestIds.delete(sessionId)
      try { sessionStorage.removeItem(storageKey) } catch { /* storage may be unavailable */ }
    }
    const existing = assessmentRequestIds.get(sessionId) ?? (() => {
      try { return sessionStorage.getItem(storageKey) } catch { return null }
    })()
    if (existing) return existing
    const id = createClientId()
    assessmentRequestIds.set(sessionId, id)
    try { sessionStorage.setItem(storageKey, id) } catch { /* storage may be unavailable */ }
    return id
  }
  function clearAssessmentRequestId(sessionId: string) {
    assessmentRequestIds.delete(sessionId)
    try { sessionStorage.removeItem(`zhixing.planning.assessment.request.${sessionId}`) } catch { /* storage may be unavailable */ }
  }
  function applyAssessment(value: PlanningAssessment | null | undefined) {
    if (!value) return
    assessment.value = value
    assessmentError.value = value.status === 'failed' ? safeAssessmentMessage(value.error) ?? '评估题目暂时没有准备好，但已保存的对话和画像仍然保留，可以安全重试。' : safeAssessmentMessage(value.error)
    if (value.recoveredFromFailure && value.status !== 'failed') assessmentRecoveryNotice.value = '已使用稳定生成协议重新准备测评，之前的对话和画像都保留。'
    if (value.status !== 'preparing' && value.status !== 'failed' && session.value?.id === value.planningSessionId) clearAssessmentRequestId(value.planningSessionId)
    if (session.value) { session.value.assessment = value; if (value.progress) session.value.progress = value.progress }
  }
  function resumeAssessmentPolling(value: PlanningAssessment | null | undefined) {
    if (!value || !['preparing', 'evaluating'].includes(value.status) || assessmentPollingPromise) return
    const token = ++assessmentPollingToken
    assessmentLoading.value = true
    assessmentPollingPromise = (async () => {
      try {
        let delay = 700
        while (token === assessmentPollingToken) {
          const next = await getPlanningAssessment(value.id)
          if (token !== assessmentPollingToken) return
          applyAssessment(next)
          if (!['preparing', 'evaluating'].includes(next.status)) return
          await sleep(delay)
          delay = Math.min(2000, delay + 300)
        }
      } catch (cause) {
        if (token === assessmentPollingToken) assessmentError.value = assessmentErrorMessage(cause, '评估状态暂时无法获取，但已保存的对话和画像仍然保留，可以安全重试。')
      } finally {
        if (token === assessmentPollingToken) { assessmentPollingPromise = null; assessmentLoading.value = false }
      }
    })()
  }
  function pollResumeStatus(sessionId: string): Promise<void> {
    resumePollExhausted.value = false
    resumePollError.value = null
    const currentResume = session.value?.id === sessionId ? session.value.resume : null
    if (!currentResume || !resumePendingStatuses.has(currentResume.parseStatus)) return Promise.resolve()
    if (resumePollingPromise) return resumePollingPromise
    const token = ++resumePollingToken
    resumeParsing.value = true
    resumePollExhausted.value = false
    resumePollError.value = null
    resumePollingPromise = (async () => {
      let delay = 700
      try {
        for (let attempt = 0; attempt < resumePollMaximum && token === resumePollingToken; attempt += 1) {
          await sleep(delay)
          if (token !== resumePollingToken) return
          const next = await getPlanningResume(sessionId)
          if (token !== resumePollingToken) return
          if (session.value?.id === sessionId) session.value.resume = next
          if (!next || !resumePendingStatuses.has(next.parseStatus)) return
          delay = Math.min(2000, delay + 300)
        }
        if (token === resumePollingToken && session.value?.id === sessionId && session.value.resume && resumePendingStatuses.has(session.value.resume.parseStatus)) resumePollExhausted.value = true
      } catch {
        if (token === resumePollingToken) resumePollError.value = '解析状态暂时无法确认，请稍后刷新重试。'
      } finally {
        if (token === resumePollingToken) { resumePollingPromise = null; resumeParsing.value = false }
      }
    })()
    return resumePollingPromise
  }
  function hydrateGeneration(value: AgentRoadmapGeneration | null) {
    generation.value = value
    if (value?.status === 'succeeded') canGenerateRoadmap.value = false
    else if (value?.status === 'queued' || value?.status === 'running') canGenerateRoadmap.value = false
    else if (session.value?.readiness) applyReadiness(session.value.readiness)
  }
  async function pollGeneration(id: string) {
    const token = pollingToken
    if (pollingPromise) return pollingPromise
    pollingPromise = (async () => {
      let delay = 700
      try {
        while (token === pollingToken) {
          try {
            const next = await getAgentRoadmapGeneration(id)
            if (token !== pollingToken) return
            hydrateGeneration(next)
            delay = 700
            if (terminalStatuses.has(next.status)) return
          } catch (cause) {
            if (token !== pollingToken) return
            error.value = cause instanceof Error ? '路线状态暂时无法获取，正在重试' : '路线状态暂时无法获取，正在重试'
            delay = 2000
          }
          await sleep(delay)
        }
      } finally {
        if (token === pollingToken) {
          pollingPromise = null
          generating.value = false
        }
      }
    })()
    return pollingPromise
  }
  function resumeGeneration(value: AgentRoadmapGeneration | null) {
    hydrateGeneration(value)
    if (value && !terminalStatuses.has(value.status)) {
      generating.value = true
      void pollGeneration(value.id)
    } else generating.value = false
  }
  function apply(event: PlanningStreamEvent) {
    if (event.type === 'assistant_delta') streamingAssistant.value += event.delta
    if (event.type === 'roadmap_readiness') canGenerateRoadmap.value = event.readiness === 'ready'
    if (event.type === 'next_question') { question.value = event.question; canGenerateRoadmap.value = event.canGenerateRoadmap }
    if (event.type === 'stage_changed') {
      if (event.session) applySession(event.session)
      else if (session.value) { session.value.stage = event.stage; if (event.progress) session.value.progress = event.progress; if (event.readiness) { session.value.readiness = event.readiness; applyReadiness(event.readiness) } }
      if (event.stage === 'assessment_preparing') void ensureAssessment().catch(() => undefined)
    }
    if (event.type === 'assessment_status') { applyAssessment(event.assessment); if (session.value && event.progress) session.value.progress = event.progress; if (event.message) assessmentError.value = safeAssessmentMessage(event.message) }
    if (event.type === 'requirements_brief_updated' && session.value) session.value.requirementBrief = event.requirementBrief
    if (event.type === 'readiness_changed' && session.value) { session.value.readiness = event.readiness; applyReadiness(event.readiness) }
    if (event.type === 'completed') { applySession(event.session); streamingAssistant.value = '' }
    if (event.type === 'failed') { error.value = event.message; failedInvocationId.value = event.invocationId }
  }
  async function run(request: (onEvent: (event: PlanningStreamEvent) => void) => Promise<void>) { streaming.value = true; error.value = null; failedInvocationId.value = null; streamingAssistant.value = ''; try { await request(apply) } catch (cause) { error.value = cause instanceof Error ? cause.message : '规划服务不可用'; throw cause } finally { streaming.value = false } }
  async function start(message: string, resume?: File) {
    const requestId = createClientId()
    streaming.value = true; error.value = null; resumeNotice.value = null; assessment.value = null; assessmentReview.value = null
    try {
      if (resume) {
        session.value = await createAgentPlanningSessionDraft(message, requestId)
        try {
          session.value.resume = await uploadPlanningResume(session.value.id, resume, requestId) as AgentPlanningSession['resume']
        } catch (cause) {
          if (!hasApiErrorCode(cause, 'resume_text_unavailable')) throw cause
          resumeNotice.value = 'PDF 中没有可提取的文本，已跳过简历内容。你可以继续对话补充经历，或稍后上传含可复制文本的 PDF。'
        }
        await run((onEvent) => sendAgentPlanningMessage(session.value!.id, message, requestId, onEvent))
      } else {
        await run((onEvent) => createAgentPlanningSession(message, requestId, onEvent))
      }
      return session.value
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '规划会话创建失败'
      throw cause
    } finally { streaming.value = false }
  }
  function clearResumeNotice() { resumeNotice.value = null }
  async function load(id: string) {
    stopPolling(); streaming.value = true; error.value = null; loadError.value = null; assessmentError.value = null; assessmentReview.value = null; assessmentRecoveryNotice.value = null
    if (assessment.value && assessment.value.planningSessionId !== id) assessment.value = null
    try {
      const loadedSession = await getAgentPlanningSession(id); applySession(loadedSession); resumeGeneration(loadedSession.roadmapGeneration); void pollResumeStatus(id)
      if (loadedSession.stage === 'assessment_preparing') await ensureAssessment().catch(() => null)
      else if (loadedSession.assessment?.id) await loadAssessment(loadedSession.assessment.id).catch(() => null)
      return loadedSession
    } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划会话加载失败'; throw cause } finally { streaming.value = false }
  }
  async function loadState(force = false) { if (state.value && !force) return state.value; stateLoading.value = true; loadError.value = null; try { state.value = await getAgentPlanningState(); hydrateGeneration(state.value.generation); if (state.value.generation && !terminalStatuses.has(state.value.generation.status)) { generating.value = true; void pollGeneration(state.value.generation.id) } return state.value } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划状态加载失败'; throw cause } finally { stateLoading.value = false } }
  async function send(message: string) {
    if (!session.value) throw new Error('规划会话尚未加载')
    const currentSession = session.value
    if (currentSession.stage === 'assessment_answering' || currentSession.stage === 'assessment_preparing' || currentSession.stage === 'assessment_evaluating') throw new Error('评估进行中，请先完成当前评估')
    if (currentSession.stage === 'requirements' || currentSession.stage === 'requirements_review' || currentSession.stage === 'ready') {
      streaming.value = true; error.value = null
      try { currentSession.requirementBrief = await sendPlanningRequirementsMessage(currentSession.id, message); applySession(await getAgentPlanningSession(currentSession.id)); return session.value }
      catch (cause) { error.value = cause instanceof Error ? cause.message : '需求摘要更新失败'; throw cause }
      finally { streaming.value = false }
    }
    const requestId = createClientId(); await run((onEvent) => sendAgentPlanningMessage(currentSession.id, message, requestId, onEvent)); return session.value
  }
  async function ensureAssessment(force = false) {
    if (!session.value || assessmentLoading.value) return assessment.value
    if (assessment.value?.planningSessionId === session.value.id && assessment.value.status === 'failed' && !force) return assessment.value
    if (assessment.value?.planningSessionId === session.value.id && !['failed', 'preparing'].includes(assessment.value.status)) return assessment.value
    assessmentLoading.value = true; assessmentError.value = null
    try { const created = await createPlanningAssessment(session.value.id, requestIdForAssessment(session.value.id)); applyAssessment(created); resumeAssessmentPolling(created); return created }
    catch (cause) { assessmentError.value = assessmentErrorMessage(cause, '评估暂时没有准备好，但已保存的对话和画像仍然保留，可以安全重试。'); throw cause }
    finally { if (!assessmentPollingPromise) assessmentLoading.value = false }
  }
  async function loadAssessment(id = assessment.value?.id ?? session.value?.assessment?.id) {
    if (!id) return null
    assessmentLoading.value = true; assessmentError.value = null
    try { const loaded = await getPlanningAssessment(id); applyAssessment(loaded); resumeAssessmentPolling(loaded); return loaded }
    catch (cause) { assessmentError.value = assessmentErrorMessage(cause, '评估加载失败，但已保存的对话和画像仍然保留，可以安全重试。'); throw cause }
    finally { if (!assessmentPollingPromise) assessmentLoading.value = false }
  }
  async function retryAssessment() {
    assessmentError.value = null
    if (!session.value) return null
    if (assessment.value?.status === 'failed') {
      clearAssessmentRequestId(session.value.id)
      return ensureAssessment(true)
    }
    if (session.value.stage === 'assessment_preparing' || !assessment.value) return ensureAssessment()
    return loadAssessment()
  }
  async function saveAssessmentAnswers(answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]) {
    if (!assessment.value) throw new Error('评估尚未准备好'); assessmentSaving.value = true; assessmentError.value = null
    try { const saved = await savePlanningAssessmentAnswers(assessment.value.id, answers, skipped); applyAssessment(saved); return saved }
    catch (cause) { assessmentError.value = assessmentErrorMessage(cause, '答案保存失败，请重试。已保存的其他答案不会丢失。'); throw cause }
    finally { assessmentSaving.value = false }
  }
  async function finalizeAssessment(mode: 'complete' | 'abandon') {
    if (!assessment.value) throw new Error('评估尚未准备好'); assessmentSaving.value = true; assessmentError.value = null
    try { const finalized = await finalizePlanningAssessment(assessment.value.id, mode); applyAssessment(finalized); if (session.value) applySession(await getAgentPlanningSession(session.value.id)); return finalized }
    catch (cause) { assessmentError.value = assessmentErrorMessage(cause, '评估提交失败，请重试。已保存的答案不会丢失。'); throw cause }
    finally { assessmentSaving.value = false }
  }
  async function loadAssessmentReview() {
    if (!assessment.value || !['completed', 'abandoned'].includes(assessment.value.status)) return null
    reviewLoading.value = true; assessmentError.value = null
    try { assessmentReview.value = await getPlanningAssessmentReview(assessment.value.id); return assessmentReview.value }
    catch (cause) { assessmentError.value = assessmentErrorMessage(cause, '评估复核加载失败，请重试。'); throw cause }
    finally { reviewLoading.value = false }
  }
  async function confirmRequirementBrief(brief: PlanningRequirementBrief) {
    if (!session.value) throw new Error('规划会话尚未加载'); requirementSaving.value = true; error.value = null
    try { applySession(await confirmPlanningRequirementBrief(session.value.id, brief)); return session.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '需求确认失败，请重试'; throw cause }
    finally { requirementSaving.value = false }
  }
  async function retry() { if (!failedInvocationId.value) return; await run((onEvent) => retryAgentInvocation(failedInvocationId.value!, onEvent)) }
  async function generate() { if (!session.value) throw new Error('规划会话尚未加载'); if (!session.value.readiness?.canGenerateRoadmap) throw new Error(session.value.readiness?.blockers?.join('；') || session.value.readiness?.nextAction || '当前信息还不足以生成路线'); if (generating.value && generation.value) return generation.value; stopPolling(); error.value = null; generating.value = true; session.value.stage = 'generating'; try { const created = await createAgentRoadmap(session.value.id, createClientId()); hydrateGeneration(created); if (!terminalStatuses.has(created.status)) await pollGeneration(created.id); if (generation.value?.status === 'failed' || generation.value?.status === 'interrupted') throw new Error(generation.value.failureMessage ?? '路线生成失败'); return generation.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线生成失败'; throw cause } finally { if (!pollingPromise) generating.value = false } }
  async function retryGeneration() { if (!generation.value || !['failed', 'interrupted'].includes(generation.value.status)) return generation.value; stopPolling(); error.value = null; generating.value = true; try { const retried = await retryAgentRoadmap(generation.value.id); hydrateGeneration(retried); if (!terminalStatuses.has(retried.status)) await pollGeneration(retried.id); if (generation.value?.status === 'failed' || generation.value?.status === 'interrupted') throw new Error(generation.value.failureMessage ?? '路线生成失败'); return generation.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线生成失败'; throw cause } finally { if (!pollingPromise) generating.value = false } }
  if (getCurrentInstance()) onBeforeUnmount(stopPolling)
  return { session, state, stateLoading, streaming, generating, generation, streamingAssistant, question, canGenerateRoadmap, error, loadError, resumeNotice, failedInvocationId, assessment, assessmentLoading, assessmentSaving, assessmentError, assessmentRecoveryNotice, assessmentReview, reviewLoading, requirementSaving, resumeParsing, resumePollExhausted, resumePollError, start, load, loadState, send, retry, ensureAssessment, loadAssessment, retryAssessment, saveAssessmentAnswers, finalizeAssessment, loadAssessmentReview, confirmRequirementBrief, generate, retryGeneration, clearResumeNotice, pollResumeStatus, stopPolling }
})
