import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  cancelQueueTicket,
  createLabRun,
  createLabSession,
  deleteLabRun,
  executeLabSql,
  getLabCases,
  getLabHealth,
  getLabRun,
  getQueueTicket,
  LabApiError,
  resetLabRun,
} from '@/api/labService'
import {
  PRIMARY_LAB_CASE,
  type LabCaseId,
  type LabCaseSummary,
  type LabExecutionResponse,
  type LabExecutionResult,
  type LabHealth,
  type LabQueueTicket,
  type LabRun,
} from '@/types/lab'

export const DEFAULT_SLOW_SQL = `EXPLAIN SELECT id, user_id, status, total_amount, created_at
FROM orders
WHERE user_id = 4242
  AND status = 'PAID'
  AND DATE(created_at) = '2026-08-01'
ORDER BY created_at DESC
LIMIT 20`

export const OPTIMIZED_SLOW_SQL = `EXPLAIN SELECT id, user_id, status, total_amount, created_at
FROM orders
WHERE user_id = 4242
  AND status = 'PAID'
  AND created_at >= '2026-08-01 00:00:00'
  AND created_at < '2026-08-02 00:00:00'
ORDER BY created_at DESC
LIMIT 20`

const STORAGE_KEY = 'zhixing.lab.run.v1'

interface PersistedLabState {
  run?: LabRun
  accessToken?: string
  sessionId?: string
  ticket?: LabQueueTicket
}

function getSessionStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage
}

function isStaleRunError(error: unknown): boolean {
  return error instanceof LabApiError && [401, 403, 404, 409, 410].includes(error.status)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const useLabStore = defineStore('lab', () => {
  const health = ref<LabHealth | null>(null)
  const cases = ref<LabCaseSummary[]>([])
  const selectedCaseId = ref<LabCaseId>(PRIMARY_LAB_CASE)
  const run = ref<LabRun | null>(null)
  const accessToken = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const ticket = ref<LabQueueTicket | null>(null)
  const sql = ref(DEFAULT_SLOW_SQL)
  const latestResult = ref<LabExecutionResponse | null>(null)
  const loading = ref(false)
  const starting = ref(false)
  const polling = ref(false)
  const executing = ref(false)
  const resetting = ref(false)
  const ending = ref(false)
  const error = ref<string | null>(null)
  const initialized = ref(false)
  let pollGeneration = 0
  let pendingRequestId: string | null = null
  let heartbeatTimer: number | null = null

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const environmentReady = computed(() => health.value?.fixtures[PRIMARY_LAB_CASE]?.ready === true)
  const canStart = computed(() => environmentReady.value && !run.value && !ticket.value && !starting.value && !polling.value)
  const activeSession = computed(() => run.value?.sessions.find((session) => session.id === sessionId.value))

  function persist() {
    const storage = getSessionStorage()
    if (!storage) return
    if (!run.value && !ticket.value) {
      storage.removeItem(STORAGE_KEY)
      return
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({
      run: run.value ?? undefined,
      accessToken: accessToken.value ?? undefined,
      sessionId: sessionId.value ?? undefined,
      ticket: ticket.value ?? undefined,
    } satisfies PersistedLabState))
  }

  function clearActiveState() {
    pollGeneration += 1
    run.value = null
    accessToken.value = null
    sessionId.value = null
    ticket.value = null
    latestResult.value = null
    pendingRequestId = null
    persist()
  }

  async function ensureDefaultSession() {
    if (!run.value || !accessToken.value) return
    const session = await createLabSession(run.value.runId, accessToken.value, 'default')
    sessionId.value = session.id
    run.value = { ...run.value, sessions: run.value.sessions.some((item) => item.id === session.id) ? run.value.sessions : [...run.value.sessions, session] }
    persist()
  }

  async function adoptRun(nextRun: LabRun, token: string) {
    run.value = nextRun
    accessToken.value = token
    ticket.value = null
    latestResult.value = null
    error.value = null
    persist()
    await ensureDefaultSession()
  }

  async function restoreSavedState() {
    const storage = getSessionStorage()
    if (!storage) return
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as PersistedLabState
      if (saved.run && saved.accessToken) {
        const current = await getLabRun(saved.run.runId, saved.accessToken)
        run.value = current
        accessToken.value = saved.accessToken
        sessionId.value = saved.sessionId ?? null
        persist()
        await ensureDefaultSession()
        return
      }
      if (saved.ticket) {
        ticket.value = await getQueueTicket(saved.ticket.ticketId)
        persist()
        if (ticket.value.status === 'ready' && ticket.value.run) {
          await adoptRun(ticket.value.run, ticket.value.run.accessToken)
        } else if (ticket.value.status === 'waiting') {
          void pollQueueTicket(ticket.value.ticketId)
        }
      }
    } catch (cause) {
      clearActiveState()
      if (!isStaleRunError(cause)) error.value = messageOf(cause, '无法恢复 Lab 运行')
    }
  }

  async function load() {
    if (initialized.value) return
    loading.value = true
    error.value = null
    try {
      const [healthData, caseData] = await Promise.all([getLabHealth(), getLabCases()])
      health.value = healthData
      cases.value = caseData
      initialized.value = true
      await restoreSavedState()
    } catch (cause) {
      error.value = messageOf(cause, 'Lab 环境加载失败')
    } finally {
      loading.value = false
    }
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  async function pollQueueTicket(ticketId: string) {
    const generation = ++pollGeneration
    polling.value = true
    try {
      while (generation === pollGeneration) {
        const next = await getQueueTicket(ticketId)
        ticket.value = next
        persist()
        if (next.status === 'ready' && next.run) {
          await adoptRun(next.run, next.run.accessToken)
          break
        }
        if (next.status !== 'waiting') break
        await wait(Math.max(500, next.pollAfterMs ?? 2000))
      }
    } catch (cause) {
      if (generation === pollGeneration) error.value = messageOf(cause, '队列状态获取失败')
    } finally {
      if (generation === pollGeneration) polling.value = false
    }
  }

  async function start() {
    if (!canStart.value) return
    starting.value = true
    error.value = null
    try {
      const response = await createLabRun(PRIMARY_LAB_CASE)
      if ('run' in response) {
        await adoptRun(response.run, response.accessToken)
      } else {
        ticket.value = response.ticket
        persist()
        void pollQueueTicket(response.ticket.ticketId)
      }
    } catch (cause) {
      error.value = messageOf(cause, '无法启动 Lab')
    } finally {
      starting.value = false
    }
  }

  async function cancelQueue() {
    if (!ticket.value) return
    pollGeneration += 1
    polling.value = false
    try {
      await cancelQueueTicket(ticket.value.ticketId)
      clearActiveState()
    } catch (cause) {
      error.value = messageOf(cause, '取消排队失败')
    }
  }

  async function execute() {
    if (!run.value || !accessToken.value || !sessionId.value) return
    if (!sql.value.trim()) {
      error.value = 'SQL 不能为空'
      return
    }
    const requestId = pendingRequestId ?? crypto.randomUUID()
    pendingRequestId = requestId
    executing.value = true
    error.value = null
    try {
      latestResult.value = await executeLabSql(run.value.runId, accessToken.value, {
        revision: run.value.revision,
        sessionId: sessionId.value,
        statement: sql.value,
        clientRequestId: requestId,
      })
      pendingRequestId = null
    } catch (cause) {
      if (isStaleRunError(cause)) clearActiveState()
      if (cause instanceof LabApiError && [400, 422].includes(cause.status)) pendingRequestId = null
      error.value = messageOf(cause, 'SQL 执行请求失败')
    } finally {
      executing.value = false
    }
  }

  async function reset() {
    if (!run.value || !accessToken.value) return
    resetting.value = true
    error.value = null
    try {
      const response = await resetLabRun(run.value.runId, accessToken.value, run.value.revision)
      await adoptRun(response.run, response.accessToken)
    } catch (cause) {
      if (isStaleRunError(cause)) clearActiveState()
      error.value = messageOf(cause, 'Lab 重置失败')
    } finally {
      resetting.value = false
    }
  }

  async function end() {
    if (!run.value || !accessToken.value) return
    ending.value = true
    error.value = null
    try {
      await deleteLabRun(run.value.runId, accessToken.value)
      clearActiveState()
    } catch (cause) {
      if (isStaleRunError(cause)) clearActiveState()
      error.value = messageOf(cause, '结束 Lab 失败')
    } finally {
      ending.value = false
    }
  }

  function loadDefaultSql() { sql.value = DEFAULT_SLOW_SQL }
  function loadOptimizedSql() { sql.value = OPTIMIZED_SLOW_SQL }

  async function refreshRun() {
    if (!run.value || !accessToken.value) return
    const runId = run.value.runId
    const revision = run.value.revision
    const token = accessToken.value
    try {
      const current = await getLabRun(runId, token)
      if (run.value?.runId !== runId || run.value.revision !== revision || accessToken.value !== token) return
      run.value = current
      persist()
    } catch (cause) {
      if (run.value?.runId === runId && run.value.revision === revision && accessToken.value === token) {
        if (isStaleRunError(cause)) clearActiveState()
        else error.value = messageOf(cause, '实验会话刷新失败')
      }
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') void refreshRun()
  }

  function startHeartbeat() {
    if (typeof window === 'undefined' || heartbeatTimer !== null) return
    document.addEventListener('visibilitychange', handleVisibilityChange)
    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRun()
    }, 60_000)
  }

  function stopHeartbeat() {
    if (typeof window !== 'undefined' && heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange)
  }

  function dispose() {
    pollGeneration += 1
    stopHeartbeat()
  }

  return {
    health, cases, selectedCaseId, selectedCase, run, accessToken, sessionId, ticket, sql, latestResult,
    loading, starting, polling, executing, resetting, ending, error, environmentReady, canStart, activeSession,
    load, start, adoptRun, cancelQueue, execute, reset, end, loadDefaultSql, loadOptimizedSql, startHeartbeat, dispose,
  }
})
