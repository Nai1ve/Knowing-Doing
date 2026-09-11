import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createDynamicLabSession, endDynamicLabRuntime, resetDynamicLabRuntime } from '@/api/productService'
import type { LabExecutionResponse, LabRun } from '@/types/lab'

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const useLabStore = defineStore('lab', () => {
  const practiceRunId = ref<string | null>(null)
  const run = ref<LabRun | null>(null)
  const accessToken = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const sql = ref('')
  const latestResult = ref<LabExecutionResponse | null>(null)
  const loading = ref(false)
  const executing = ref(false)
  const resetting = ref(false)
  const ending = ref(false)
  const error = ref<string | null>(null)
  const activeSession = computed(() => run.value?.sessions.find((session) => session.id === sessionId.value))

  function clear() {
    practiceRunId.value = null
    run.value = null
    accessToken.value = null
    sessionId.value = null
    latestResult.value = null
    error.value = null
  }

  async function ensureDefaultSession() {
    if (!run.value || !practiceRunId.value) return
    const session = await createDynamicLabSession(practiceRunId.value)
    sessionId.value = session.id
    if (!run.value.sessions.some((item) => item.id === session.id)) run.value = { ...run.value, sessions: [...run.value.sessions, session] }
  }

  async function adoptRun(nextRun: LabRun, token: string, nextPracticeRunId: string) {
    practiceRunId.value = nextPracticeRunId
    run.value = nextRun
    accessToken.value = token
    latestResult.value = null
    error.value = null
    await ensureDefaultSession()
  }

  async function reset() {
    if (!run.value || !practiceRunId.value) return
    resetting.value = true
    error.value = null
    try {
      const response = await resetDynamicLabRuntime(practiceRunId.value, run.value.revision)
      await adoptRun(response.run, response.accessToken, practiceRunId.value)
    } catch (cause) {
      error.value = messageOf(cause, '实验室重置失败')
    } finally {
      resetting.value = false
    }
  }

  async function end() {
    if (!practiceRunId.value) return
    ending.value = true
    error.value = null
    try {
      await endDynamicLabRuntime(practiceRunId.value)
      clear()
    } catch (cause) {
      error.value = messageOf(cause, '结束实验室失败')
    } finally {
      ending.value = false
    }
  }

  function loadDefaultSql() { sql.value = '' }
  function loadCreateIndexSql() { sql.value = '' }
  function loadOptimizedSql() { sql.value = '' }
  function load() { return Promise.resolve() }
  function startHeartbeat() {}
  function dispose() {}

  return {
    practiceRunId, run, accessToken, sessionId, sql, latestResult, loading, executing, resetting, ending, error, activeSession,
    load, adoptRun, reset, end, loadDefaultSql, loadCreateIndexSql, loadOptimizedSql, startHeartbeat, dispose, clear,
  }
})
