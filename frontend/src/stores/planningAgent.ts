import { defineStore } from 'pinia'
import { onBeforeUnmount } from 'vue'
import { ref } from 'vue'
import { createAgentPlanningSession, createAgentRoadmap, getAgentPlanningSession, getAgentPlanningState, getAgentRoadmapGeneration, retryAgentInvocation, retryAgentRoadmap, sendAgentPlanningMessage, uploadPlanningResume } from '@/api/planningService'
import type { AgentPlanningSession, AgentPlanningState, AgentRoadmapGeneration, PlanningStreamEvent } from '@/types/product'
import { createClientId } from '@/utils/client-id'

export const usePlanningAgentStore = defineStore('planningAgent', () => {
  const session = ref<AgentPlanningSession | null>(null); const state = ref<AgentPlanningState | null>(null); const stateLoading = ref(false); const streaming = ref(false); const generating = ref(false); const generation = ref<AgentRoadmapGeneration | null>(null); const streamingAssistant = ref(''); const question = ref(''); const canGenerateRoadmap = ref(false); const error = ref<string | null>(null); const loadError = ref<string | null>(null); const failedInvocationId = ref<string | null>(null)
  let pollingToken = 0
  let pollingPromise: Promise<void> | null = null
  const terminalStatuses = new Set<AgentRoadmapGeneration['status']>(['succeeded', 'failed', 'interrupted'])
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
  function stopPolling() { pollingToken += 1; pollingPromise = null; generating.value = false }
  function hydrateGeneration(value: AgentRoadmapGeneration | null) {
    generation.value = value
    if (value?.status === 'succeeded') canGenerateRoadmap.value = false
    else if (value?.status === 'queued' || value?.status === 'running') canGenerateRoadmap.value = false
    else canGenerateRoadmap.value = true
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
  function apply(event: PlanningStreamEvent) { if (event.type === 'assistant_delta') streamingAssistant.value += event.delta; if (event.type === 'roadmap_readiness') canGenerateRoadmap.value = event.readiness === 'ready'; if (event.type === 'next_question') { question.value = event.question; canGenerateRoadmap.value = event.canGenerateRoadmap }; if (event.type === 'completed') { session.value = event.session; streamingAssistant.value = '' } if (event.type === 'failed') { error.value = event.message; failedInvocationId.value = event.invocationId } }
  async function run(request: (onEvent: (event: PlanningStreamEvent) => void) => Promise<void>) { streaming.value = true; error.value = null; failedInvocationId.value = null; streamingAssistant.value = ''; try { await request(apply) } catch (cause) { error.value = cause instanceof Error ? cause.message : '规划服务不可用'; throw cause } finally { streaming.value = false } }
  async function start(message: string, resume?: File) { await run((onEvent) => createAgentPlanningSession(message, createClientId(), onEvent)); if (session.value && resume) session.value.resume = await uploadPlanningResume(session.value.id, resume) as AgentPlanningSession['resume']; return session.value }
  async function load(id: string) { stopPolling(); streaming.value = true; error.value = null; loadError.value = null; try { session.value = await getAgentPlanningSession(id); resumeGeneration(session.value.roadmapGeneration); return session.value } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划会话加载失败'; throw cause } finally { streaming.value = false } }
  async function loadState(force = false) { if (state.value && !force) return state.value; stateLoading.value = true; loadError.value = null; try { state.value = await getAgentPlanningState(); hydrateGeneration(state.value.generation); if (state.value.generation && !terminalStatuses.has(state.value.generation.status)) { generating.value = true; void pollGeneration(state.value.generation.id) } return state.value } catch (cause) { loadError.value = cause instanceof Error ? cause.message : '规划状态加载失败'; throw cause } finally { stateLoading.value = false } }
  async function send(message: string) { if (!session.value) throw new Error('规划会话尚未加载'); const requestId = createClientId(); await run((onEvent) => sendAgentPlanningMessage(session.value!.id, message, requestId, onEvent)); return session.value }
  async function retry() { if (!failedInvocationId.value) return; await run((onEvent) => retryAgentInvocation(failedInvocationId.value!, onEvent)) }
  async function generate() { if (!session.value) throw new Error('规划会话尚未加载'); if (generating.value && generation.value) return generation.value; stopPolling(); error.value = null; generating.value = true; try { const created = await createAgentRoadmap(session.value.id, createClientId()); hydrateGeneration(created); if (!terminalStatuses.has(created.status)) await pollGeneration(created.id); if (generation.value?.status === 'failed' || generation.value?.status === 'interrupted') throw new Error(generation.value.failureMessage ?? '路线生成失败'); return generation.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线生成失败'; throw cause } finally { if (!pollingPromise) generating.value = false } }
  async function retryGeneration() { if (!generation.value || !['failed', 'interrupted'].includes(generation.value.status)) return generation.value; stopPolling(); error.value = null; generating.value = true; try { const retried = await retryAgentRoadmap(generation.value.id); hydrateGeneration(retried); if (!terminalStatuses.has(retried.status)) await pollGeneration(retried.id); if (generation.value?.status === 'failed' || generation.value?.status === 'interrupted') throw new Error(generation.value.failureMessage ?? '路线生成失败'); return generation.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线生成失败'; throw cause } finally { if (!pollingPromise) generating.value = false } }
  onBeforeUnmount(stopPolling)
  return { session, state, stateLoading, streaming, generating, generation, streamingAssistant, question, canGenerateRoadmap, error, loadError, failedInvocationId, start, load, loadState, send, retry, generate, retryGeneration, stopPolling }
})
