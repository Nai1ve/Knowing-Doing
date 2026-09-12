import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createGymBuild, getGymBuild, getGymBuildEvents, retryGymBuild, startGymBuild } from '@/api/productService'
import type { ProductGymBuildEvent, ProductGymBuildView } from '@/types/product'

export const useGymBuildStore = defineStore('gym-build', () => {
  const build = ref<ProductGymBuildView | null>(null)
  const events = ref<ProductGymBuildEvent[]>([])
  const nextEventSequence = ref(0)
  const loading = ref(false)
  const starting = ref(false)
  const error = ref<string | null>(null)
  let timer: number | null = null

  function stopPolling() { if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer); timer = null }
  function isPending() { return Boolean(build.value && ['queued', 'running', 'cleanup_pending'].includes(build.value.job.status)) }
  function schedule(id: string) {
    stopPolling()
    if (!isPending() || typeof window === 'undefined') return
    timer = window.setTimeout(() => { void load(id, true) }, 900)
  }

  async function refreshEvents(id: string, reset = false) {
    const afterSequence = reset ? 0 : nextEventSequence.value
    const page = await getGymBuildEvents(id, afterSequence)
    if (reset) events.value = page.events
    else {
      const known = new Set(events.value.map((event) => event.sequence))
      events.value = [...events.value, ...page.events.filter((event) => !known.has(event.sequence))]
    }
    nextEventSequence.value = page.nextSequence
  }

  async function load(id: string, background = false) {
    if (!background) loading.value = true
    error.value = null
    try {
      const previousId = build.value?.job.id
      build.value = await getGymBuild(id)
      await refreshEvents(id, previousId !== id)
      schedule(id)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建任务加载失败'; stopPolling() } finally { if (!background) loading.value = false }
  }
  async function create(planId: string, planUnitId: string) {
    loading.value = true; error.value = null
    try {
      build.value = await createGymBuild(planId, planUnitId)
      events.value = []; nextEventSequence.value = 0
      await refreshEvents(build.value.job.id, true)
      schedule(build.value.job.id)
      return build.value
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建任务创建失败'; throw cause } finally { loading.value = false }
  }
  async function retry() {
    if (!build.value) return
    loading.value = true; error.value = null
    try {
      build.value = await retryGymBuild(build.value.job.id)
      await refreshEvents(build.value.job.id)
      schedule(build.value.job.id)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建重试失败'; throw cause } finally { loading.value = false }
  }
  async function start() {
    if (!build.value) return null
    starting.value = true; error.value = null
    try { return await startGymBuild(build.value.job.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 启动失败'; throw cause } finally { starting.value = false }
  }
  function dispose() { stopPolling(); events.value = []; nextEventSequence.value = 0 }
  return { build, events, loading, starting, error, load, create, retry, start, dispose }
})
