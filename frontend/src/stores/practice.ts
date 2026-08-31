import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { executeProductLab, getProductLabAccess, getProductSnapshot, sendProductTutor, startProductPractice, submitProductArtifact } from '@/api/productService'
import type { LabCaseId, LabExecutionResult } from '@/types/lab'
import type { ProductPracticeRun, ProductPracticeStart, ProductSnapshot, ProductTutorMessage, ProductTutorResponse } from '@/types/product'
import { useLabStore } from './lab'

export const usePracticeStore = defineStore('practice', () => {
  const run = ref<ProductPracticeRun | null>(null)
  const snapshot = ref<ProductSnapshot | null>(null)
  const messages = ref<ProductTutorMessage[]>([])
  const lastTutor = ref<ProductTutorResponse | null>(null)
  const starting = ref(false)
  const tutorLoading = ref(false)
  const error = ref<string | null>(null)
  let queueTimer: number | null = null
  const currentGap = computed(() => snapshot.value?.stageMemories.find((memory) => memory.stage === run.value?.stage)?.memory.currentGap as string | undefined)
  const nextQuestion = computed(() => [...messages.value].reverse().find((message) => message.role === 'assistant')?.content ?? '先说明你观察到的现象和当前判断。')

  function hydrate(data: ProductSnapshot) {
    run.value = data.run; snapshot.value = data
    const nextMessages: ProductTutorMessage[] = []
    for (const turn of data.tutorTurns) {
      const user = data.artifacts.find((artifact) => artifact.id === turn.userArtifactId)
      const assistant = data.artifacts.find((artifact) => artifact.id === turn.assistantArtifactId)
      if (user) nextMessages.push({ id: user.id, role: 'user', content: user.content })
      if (assistant) nextMessages.push({ id: assistant.id, role: 'assistant', content: assistant.content, source: `${turn.provider === 'scripted' ? '知行预置 Tutor' : '知行 AI'} · ${turn.sourceStatus}` })
    }
    messages.value = nextMessages
  }

  async function start(caseId: LabCaseId, planUnitId?: string) {
    if (starting.value) return
    starting.value = true; error.value = null
    try {
      const result: ProductPracticeStart = await startProductPractice(caseId, planUnitId)
      run.value = result.practice
      window.localStorage.setItem('zhixing.active.practice.id', result.practice.id)
      if (result.lab) {
        const labStore = useLabStore()
        await labStore.adoptRun(result.lab.run, result.lab.accessToken)
      }
      snapshot.value = await getProductSnapshot(result.practice.id)
      hydrate(snapshot.value)
      if (result.queue) {
        error.value = `当前案例正在排队，第 ${result.queue.position ?? '—'} 位`
        pollLabAccess(result.practice.id)
      }
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '实践启动失败' } finally { starting.value = false }
  }

  async function pollLabAccess(practiceId: string) {
    if (queueTimer !== null) window.clearTimeout(queueTimer)
    try {
      const access = await getProductLabAccess(practiceId)
      if (access.status === 'ready' && access.run && access.accessToken) {
        const labStore = useLabStore()
        await labStore.adoptRun(access.run, access.accessToken)
        run.value = await getProductSnapshot(practiceId).then((data) => { hydrate(data); return data.run })
        error.value = null
        return
      }
      if (access.status === 'expired' || access.status === 'cancelled') {
        error.value = access.status === 'expired' ? '排队票据已过期，请重新进入案例' : '排队已取消'
        return
      }
      queueTimer = window.setTimeout(() => { void pollLabAccess(practiceId) }, 2000)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '队列状态获取失败' }
  }

  async function ask(message: string) {
    if (!run.value || tutorLoading.value) return
    tutorLoading.value = true; error.value = null; messages.value.push({ id: `local-${crypto.randomUUID()}`, role: 'user', content: message })
    try {
      const result = await sendProductTutor(run.value.id, message)
      run.value = result.run; lastTutor.value = result.tutor; hydrate(result.snapshot)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Tutor 暂时不可用' } finally { tutorLoading.value = false }
  }

  async function execute() {
    const labStore = useLabStore()
    if (!run.value || !labStore.run || !labStore.accessToken || !labStore.sessionId) return
    labStore.executing = true; error.value = null
    try {
      const result = await executeProductLab(run.value.id, labStore.accessToken, { revision: labStore.run.revision, sessionId: labStore.sessionId, statement: labStore.sql, clientRequestId: crypto.randomUUID() })
      labStore.latestResult = result.execution as LabExecutionResult
      run.value = result.run; hydrate(result.snapshot)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Lab 执行失败' } finally { labStore.executing = false }
  }

  async function addExternal(content: string) { if (run.value && content.trim()) { await submitProductArtifact(run.value.id, content); snapshot.value = await getProductSnapshot(run.value.id); hydrate(snapshot.value) } }
  function clear() { if (queueTimer !== null) window.clearTimeout(queueTimer); queueTimer = null; run.value = null; snapshot.value = null; messages.value = []; error.value = null }
  return { run, snapshot, messages, lastTutor, starting, tutorLoading, error, currentGap, nextQuestion, start, ask, execute, addExternal, clear }
})
