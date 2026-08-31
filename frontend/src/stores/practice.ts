import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '@/api/client'
import { executeProductLab, getProductLabAccess, getProductPracticeHistory, getProductSnapshot, reopenProductLab, retryProductTutor, startProductPractice, streamProductTutor, submitProductArtifact } from '@/api/productService'
import type { LabCaseId, LabExecutionResult } from '@/types/lab'
import type { ProductPracticeHistoryItem, ProductPracticeRun, ProductPracticeStart, ProductSnapshot, ProductTutorMessage, ProductTutorResponse, ProductTutorSource, ProductTutorStreamEvent } from '@/types/product'
import { useLabStore } from './lab'

export const usePracticeStore = defineStore('practice', () => {
  const activePracticeKey = 'zhixing.active.practice.id'
  const lastPracticeKey = 'zhixing.last.practice.id'
  const run = ref<ProductPracticeRun | null>(null)
  const snapshot = ref<ProductSnapshot | null>(null)
  const messages = ref<ProductTutorMessage[]>([])
  const history = ref<ProductPracticeHistoryItem[]>([])
  const sources = ref<ProductTutorSource[]>([])
  const tutorFailure = ref<{ invocationId: string; code: string; message: string; retryable: boolean } | null>(null)
  const invocationId = ref<string | null>(null)
  const lastTutor = ref<ProductTutorResponse | null>(null)
  const starting = ref(false)
  const tutorLoading = ref(false)
  const restoring = ref(false)
  const error = ref<string | null>(null)
  let queueTimer: number | null = null
  const currentGap = computed(() => snapshot.value?.stageMemories.find((memory) => memory.stage === run.value?.stage)?.memory.currentGap as string | undefined)
  const nextQuestion = computed(() => [...messages.value].reverse().find((message) => message.role === 'assistant')?.content ?? '先说明你观察到的现象和当前判断。')

  function hydrate(data: ProductSnapshot) {
    run.value = data.run; snapshot.value = data
    const nextMessages: ProductTutorMessage[] = []
    const turnByUser = new Map(data.tutorTurns.map((turn) => [turn.userArtifactId, turn]))
    for (const artifact of data.artifacts.filter((item) => item.kind === 'user_message').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      nextMessages.push({ id: artifact.id, role: 'user', content: artifact.content })
      const turn = turnByUser.get(artifact.id); const assistant = turn?.assistantArtifactId ? data.artifacts.find((item) => item.id === turn.assistantArtifactId) : undefined
      if (assistant) nextMessages.push({ id: assistant.id, role: 'assistant', content: assistant.content, source: `${turn?.provider === 'scripted' ? '知行预置 Tutor' : '知行 AI'} · ${turn?.sourceStatus ?? 'unknown'}` })
    }
    messages.value = nextMessages
    const replyEvent = [...data.events].reverse().find((event) => event.type === 'tutor_reply' && typeof event.payload.response === 'string')
    lastTutor.value = replyEvent ? replyEvent.payload as unknown as ProductTutorResponse : null
  }

  async function loadHistory() {
    try { history.value = (await getProductPracticeHistory()).items } catch (cause) { error.value = cause instanceof Error ? cause.message : '实践历史加载失败' }
  }

  async function selectHistory(practiceId: string) {
    if (restoring.value || run.value?.id === practiceId) return
    restoring.value = true; error.value = null
    try {
      const data = await getProductSnapshot(practiceId)
      useLabStore().clear(); hydrate(data)
      if (typeof window !== 'undefined') window.localStorage.setItem(lastPracticeKey, practiceId)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '实践历史加载失败' } finally { restoring.value = false }
  }

  async function restoreActive() {
    if (restoring.value || typeof window === 'undefined') return
    const practiceId = window.localStorage.getItem(activePracticeKey)
    if (!practiceId) return
    restoring.value = true
    error.value = null
    try {
      const data = await getProductSnapshot(practiceId)
      hydrate(data)
      const labStore = useLabStore()
      const access = await getProductLabAccess(practiceId)
      if (access.status === 'ready' && access.run && access.accessToken) {
        await labStore.adoptRun(access.run, access.accessToken)
        return
      }
      if (access.status === 'waiting') {
        void pollLabAccess(practiceId)
        return
      }
      window.localStorage.setItem(lastPracticeKey, practiceId)
      labStore.clear()
      error.value = '上次实践的 Lab 运行已结束。历史记录已恢复为只读状态，可重新启动实验继续练习。'
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status)) {
        window.localStorage.removeItem(activePracticeKey)
        run.value = null
        snapshot.value = null
        messages.value = []
      }
      error.value = cause instanceof Error ? cause.message : '无法恢复当前实践'
    } finally {
      restoring.value = false
    }
  }

  async function restoreRecord() {
    if (run.value || typeof window === 'undefined') return
    const practiceId = window.localStorage.getItem(lastPracticeKey)
    if (!practiceId) return
    try {
      hydrate(await getProductSnapshot(practiceId))
    } catch {
      window.localStorage.removeItem(lastPracticeKey)
    }
  }

  async function start(caseId: LabCaseId, planUnitId?: string) {
    if (starting.value) return
    starting.value = true; error.value = null
    try {
      const result: ProductPracticeStart = await startProductPractice(caseId, planUnitId)
      run.value = result.practice
      window.localStorage.setItem('zhixing.active.practice.id', result.practice.id)
      window.localStorage.setItem(lastPracticeKey, result.practice.id)
      if (result.lab) {
        const labStore = useLabStore()
        await labStore.adoptRun(result.lab.run, result.lab.accessToken)
      }
      snapshot.value = await getProductSnapshot(result.practice.id)
      hydrate(snapshot.value)
      await loadHistory()
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
    await streamTutor(run.value.id, message, crypto.randomUUID())
  }

  function applyTutorEvent(event: ProductTutorStreamEvent) {
    if (event.type === 'accepted') { invocationId.value = event.invocationId; return }
    if (event.type === 'sources') { sources.value = event.items; return }
    if (event.type === 'answer_delta') {
      const current = messages.value.find((message) => message.id === `stream-${event.invocationId}`)
      if (current) current.content += event.delta
      else messages.value.push({ id: `stream-${event.invocationId}`, role: 'assistant', content: event.delta, source: '知行 AI · 流式回答' })
      return
    }
    if (event.type === 'completed') { run.value = event.run; lastTutor.value = event.tutor; sources.value = event.sources; hydrate(event.snapshot); tutorFailure.value = null; return }
    if (event.type === 'failed') { tutorFailure.value = { invocationId: event.invocationId, code: event.code, message: event.message, retryable: event.retryable }; error.value = `模型暂不可用：${event.message}` }
  }

  async function streamTutor(runId: string, message: string, requestId: string) {
    tutorLoading.value = true; error.value = null; tutorFailure.value = null; sources.value = []
    messages.value.push({ id: `local-${crypto.randomUUID()}`, role: 'user', content: message })
    try { await streamProductTutor(runId, message, requestId, applyTutorEvent); await loadHistory() } catch (cause) { if (!tutorFailure.value) error.value = cause instanceof Error ? cause.message : 'Tutor 暂时不可用' } finally { tutorLoading.value = false }
  }

  async function retryTutor() {
    if (!run.value || !tutorFailure.value || tutorLoading.value) return
    tutorLoading.value = true; error.value = null; const failure = tutorFailure.value; sources.value = []
    try { await retryProductTutor(run.value.id, failure.invocationId, applyTutorEvent); await loadHistory() } catch (cause) { if (!tutorFailure.value) error.value = cause instanceof Error ? cause.message : 'Tutor 暂时不可用' } finally { tutorLoading.value = false }
  }

  async function reopen(practiceId = run.value?.id) {
    if (!practiceId || starting.value) return
    starting.value = true; error.value = null
    try {
      const result = await reopenProductLab(practiceId)
      run.value = result.practice
      if (typeof window !== 'undefined') { window.localStorage.setItem(activePracticeKey, practiceId); window.localStorage.setItem(lastPracticeKey, practiceId) }
      if (result.lab) await useLabStore().adoptRun(result.lab.run, result.lab.accessToken)
      if (result.queue) { error.value = `当前案例正在排队，第 ${result.queue.position ?? '—'} 位`; void pollLabAccess(practiceId) }
      hydrate(await getProductSnapshot(practiceId)); await loadHistory()
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Lab 续开失败' } finally { starting.value = false }
  }

  async function execute() {
    const labStore = useLabStore()
    if (!run.value) {
      error.value = '请先启动一个实践案例，再执行 SQL。'
      return
    }
    if (!labStore.run || !labStore.accessToken) {
      error.value = '当前实践没有可执行的 Lab 运行，请重新启动实验。'
      return
    }
    if (!labStore.sessionId || labStore.activeSession?.status !== 'open') {
      error.value = 'SQL 会话尚未就绪，请稍后重试或重新启动实验。'
      return
    }
    labStore.executing = true; error.value = null
    try {
      const result = await executeProductLab(run.value.id, labStore.accessToken, { revision: labStore.run.revision, sessionId: labStore.sessionId, statement: labStore.sql, clientRequestId: crypto.randomUUID() })
      labStore.latestResult = result.execution as LabExecutionResult
      run.value = result.run; hydrate(result.snapshot)
    } catch (cause) {
      if (cause instanceof ApiError && [422, 504].includes(cause.status)) {
        const envelope = cause.payload && typeof cause.payload === 'object' && 'error' in cause.payload
          ? (cause.payload as { error?: { code?: unknown; message?: unknown; retryable?: unknown } }).error
          : undefined
        if (typeof envelope?.code === 'string' && typeof envelope.message === 'string') {
          labStore.latestResult = { kind: 'request_error', status: cause.status === 504 ? 'timed_out' : 'rejected', statusCode: cause.status, error: { code: envelope.code, message: envelope.message, retryable: envelope.retryable === true } }
        }
      }
      if (cause instanceof ApiError && [401, 403, 404, 409, 410].includes(cause.status)) labStore.clear()
      error.value = cause instanceof Error ? cause.message : 'Lab 执行失败'
    } finally { labStore.executing = false }
  }

  async function addExternal(content: string) { if (run.value && content.trim()) { await submitProductArtifact(run.value.id, content); snapshot.value = await getProductSnapshot(run.value.id); hydrate(snapshot.value) } }
  function clear() { if (queueTimer !== null) window.clearTimeout(queueTimer); queueTimer = null; run.value = null; snapshot.value = null; messages.value = []; lastTutor.value = null; sources.value = []; tutorFailure.value = null; invocationId.value = null; error.value = null; if (typeof window !== 'undefined') window.localStorage.removeItem(activePracticeKey) }
  return { run, snapshot, messages, history, sources, tutorFailure, invocationId, lastTutor, starting, restoring, tutorLoading, error, currentGap, nextQuestion, start, loadHistory, selectHistory, restoreActive, restoreRecord, ask, retryTutor, reopen, execute, addExternal, clear }
})
