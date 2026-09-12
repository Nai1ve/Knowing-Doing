import { defineStore } from 'pinia'
import { onBeforeUnmount } from 'vue'
import { ref } from 'vue'
import { confirmPlanningRequirementBrief, createAgentPlanningSession, createAgentPlanningSessionDraft, createAgentRoadmap, createPlanningAssessment, finalizePlanningAssessment, getAgentPlanningSession, getAgentPlanningState, getAgentRoadmapGeneration, getPlanningAssessment, getPlanningAssessmentReview, retryAgentInvocation, retryAgentRoadmap, savePlanningAssessmentAnswers, sendAgentPlanningMessage, uploadPlanningResume } from '@/api/planningService'
import type { AgentPlanningSession, AgentPlanningState, AgentRoadmapGeneration, PlanningAssessment, PlanningAssessmentAnswer, PlanningAssessmentReview, PlanningReadiness, PlanningRequirementBrief, PlanningStreamEvent } from '@/types/product'
import { createClientId } from '@/utils/client-id'
import { hasApiErrorCode } from '@/api/client'

export const usePlanningAgentStore = defineStore('planningAgent', () => {
  const session = ref<AgentPlanningSession | null>(null); const state = ref<AgentPlanningState | null>(null); const stateLoading = ref(false); const streaming = ref(false); const generating = ref(false); const generation = ref<AgentRoadmapGeneration | null>(null); const streamingAssistant = ref(''); const question = ref(''); const canGenerateRoadmap = ref(false); const error = ref<string | null>(null); const loadError = ref<string | null>(null); const resumeNotice = ref<string | null>(null); const failedInvocationId = ref<string | null>(null)
  const assessment = ref<PlanningAssessment | null>(null); const assessmentLoading = ref(false); const assessmentSaving = ref(false); const assessmentError = ref<string | null>(null); const assessmentReview = ref<PlanningAssessmentReview | null>(null); const reviewLoading = ref(false); const requirementSaving = ref(false)
  let pollingToken = 0
  let pollingPromise: Promise<void> | null = null
  const terminalStatuses = new Set<AgentRoadmapGeneration['status']>(['succeeded', 'failed', 'interrupted'])
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
  function stopPolling() { pollingToken += 1; pollingPromise = null; generating.value = false }
  function applyReadiness(value: PlanningReadiness | null | undefined) { if (!value) return; canGenerateRoadmap.value = value.canGenerateRoadmap }
  function applySession(value: AgentPlanningSession) { session.value = value; applyReadiness(value.readiness); question.value = value.readiness?.nextAction ?? question.value }
  function applyAssessment(value: PlanningAssessment | null | undefined) { if (!value) return; assessment.value = value; assessmentError.value = value.error ?? null; if (session.value) { session.value.assessment = value.summary; if (value.progress) session.value.progress = value.progress } }
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
      if (event.stage === 'assessment_preparing') void ensureAssessment()
    }
    if (event.type === 'assessment_status') { applyAssessment(event.assessment); if (session.value) { if (event.progress) session.value.progress = event.progress; if (event.summary !== undefined) session.value.assessment = event.summary }; if (event.message) assessmentError.value = event.message }
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
    stopPolling(); streaming.value = true; error.value = null; loadError.value = null; assessmentError.value = null; assessmentReview.value = null
    if (assessment.value && assessment.value.planningSessionId !== id) assessment.value = null
    try {
      const loadedSession = await getAgentPlanningSession(id); applySession(loadedSession); resumeGeneration(loadedSession.roadmapGeneration)
      if (loadedSession.stage === 'assessment_preparing') await ensureAssessment()
      else if (loadedSession.assessment?.id) await loadAssessment(loadedSession.assessment.id)
      return loadedSession
    } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划会话加载失败'; throw cause } finally { streaming.value = false }
  }
  async function loadState(force = false) { if (state.value && !force) return state.value; stateLoading.value = true; loadError.value = null; try { state.value = await getAgentPlanningState(); hydrateGeneration(state.value.generation); if (state.value.generation && !terminalStatuses.has(state.value.generation.status)) { generating.value = true; void pollGeneration(state.value.generation.id) } return state.value } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划状态加载失败'; throw cause } finally { stateLoading.value = false } }
  async function send(message: string) { if (!session.value) throw new Error('规划会话尚未加载'); if (session.value.stage === 'assessment_answering' || session.value.stage === 'assessment_preparing' || session.value.stage === 'assessment_evaluating') throw new Error('评估进行中，请先完成当前评估'); const requestId = createClientId(); await run((onEvent) => sendAgentPlanningMessage(session.value!.id, message, requestId, onEvent)); return session.value }
  async function ensureAssessment() {
    if (!session.value || assessmentLoading.value || (assessment.value?.planningSessionId === session.value.id && assessment.value.status !== 'failed')) return assessment.value
    assessmentLoading.value = true; assessmentError.value = null
    try { const created = await createPlanningAssessment(session.value.id); applyAssessment(created); return created }
    catch (cause) { assessmentError.value = cause instanceof Error ? cause.message : '评估准备失败，请重试'; throw cause }
    finally { assessmentLoading.value = false }
  }
  async function loadAssessment(id = assessment.value?.id ?? session.value?.assessment?.id) {
    if (!id) return null
    assessmentLoading.value = true; assessmentError.value = null
    try { const loaded = await getPlanningAssessment(id); applyAssessment(loaded); return loaded }
    catch (cause) { assessmentError.value = cause instanceof Error ? cause.message : '评估加载失败，请重试'; throw cause }
    finally { assessmentLoading.value = false }
  }
  async function retryAssessment() { assessmentError.value = null; if (session.value?.stage === 'assessment_preparing' || !assessment.value) return ensureAssessment(); return loadAssessment() }
  async function saveAssessmentAnswers(answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]) {
    if (!assessment.value) throw new Error('评估尚未准备好'); assessmentSaving.value = true; assessmentError.value = null
    try { const saved = await savePlanningAssessmentAnswers(assessment.value.id, answers, skipped); applyAssessment(saved); return saved }
    catch (cause) { assessmentError.value = cause instanceof Error ? cause.message : '答案保存失败，请重试'; throw cause }
    finally { assessmentSaving.value = false }
  }
  async function finalizeAssessment(mode: 'complete' | 'abandon') {
    if (!assessment.value) throw new Error('评估尚未准备好'); assessmentSaving.value = true; assessmentError.value = null
    try { const finalized = await finalizePlanningAssessment(assessment.value.id, mode); applyAssessment(finalized); if (session.value) applySession(await getAgentPlanningSession(session.value.id)); return finalized }
    catch (cause) { assessmentError.value = cause instanceof Error ? cause.message : '评估提交失败，请重试'; throw cause }
    finally { assessmentSaving.value = false }
  }
  async function loadAssessmentReview() {
    if (!assessment.value || !['completed', 'abandoned'].includes(assessment.value.status)) return null
    reviewLoading.value = true; assessmentError.value = null
    try { assessmentReview.value = await getPlanningAssessmentReview(assessment.value.id); return assessmentReview.value }
    catch (cause) { assessmentError.value = cause instanceof Error ? cause.message : '评估复核加载失败，请重试'; throw cause }
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
  onBeforeUnmount(stopPolling)
  return { session, state, stateLoading, streaming, generating, generation, streamingAssistant, question, canGenerateRoadmap, error, loadError, resumeNotice, failedInvocationId, assessment, assessmentLoading, assessmentSaving, assessmentError, assessmentReview, reviewLoading, requirementSaving, start, load, loadState, send, retry, ensureAssessment, loadAssessment, retryAssessment, saveAssessmentAnswers, finalizeAssessment, loadAssessmentReview, confirmRequirementBrief, generate, retryGeneration, clearResumeNotice, stopPolling }
})
