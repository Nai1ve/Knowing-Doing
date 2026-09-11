import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createGymBuild, getGymBuild, retryGymBuild, startGymBuild } from '@/api/productService'
import type { ProductGymBuildView } from '@/types/product'

export const useGymBuildStore = defineStore('gym-build', () => {
  const build = ref<ProductGymBuildView | null>(null)
  const loading = ref(false)
  const starting = ref(false)
  const error = ref<string | null>(null)
  let timer: number | null = null

  function stopPolling() { if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer); timer = null }
  function schedule(id: string) { stopPolling(); if (!build.value || !['queued', 'building'].includes(build.value.job.status) || typeof window === 'undefined') return; timer = window.setTimeout(() => { void load(id, true) }, 700) }
  async function load(id: string, background = false) {
    if (!background) loading.value = true
    error.value = null
    try { build.value = await getGymBuild(id); schedule(id) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建任务加载失败'; stopPolling() } finally { if (!background) loading.value = false }
  }
  async function create(planId: string, planUnitId: string) {
    loading.value = true; error.value = null
    try { build.value = await createGymBuild(planId, planUnitId); schedule(build.value.job.id); return build.value } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建任务创建失败'; throw cause } finally { loading.value = false }
  }
  async function retry() {
    if (!build.value) return
    loading.value = true; error.value = null
    try { build.value = await retryGymBuild(build.value.job.id); schedule(build.value.job.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 构建重试失败'; throw cause } finally { loading.value = false }
  }
  async function start() {
    if (!build.value) return null
    starting.value = true; error.value = null
    try { return await startGymBuild(build.value.job.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 启动失败'; throw cause } finally { starting.value = false }
  }
  function dispose() { stopPolling() }
  return { build, loading, starting, error, load, create, retry, start, dispose }
})
