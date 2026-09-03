import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createDiagnosticSession, getOnboardingState, regeneratePlan } from '@/api/onboardingService'
import type { DiagnosticTargetKey, ProductOnboardingState } from '@/types/product'

export const useOnboardingStore = defineStore('onboarding', () => {
  const state = ref<ProductOnboardingState | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(force = false) {
    if (state.value && !force) return state.value
    loading.value = true; error.value = null
    try { state.value = await getOnboardingState(); return state.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '入口状态加载失败'; throw cause }
    finally { loading.value = false }
  }

  async function start(targetKey: DiagnosticTargetKey, goal: string) {
    loading.value = true; error.value = null
    try {
      const session = await createDiagnosticSession({ targetKey, goal, clientRequestId: crypto.randomUUID() })
      state.value = { status: 'diagnostic_in_progress', currentPlan: null, diagnosticSession: { id: session.id, status: session.status, revision: session.revision, updatedAt: session.updatedAt }, proposal: null }
      return session
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '诊断创建失败'; throw cause }
    finally { loading.value = false }
  }

  async function regenerate() {
    loading.value = true; error.value = null
    try {
      const session = await regeneratePlan(crypto.randomUUID())
      state.value = { status: 'diagnostic_in_progress', currentPlan: null, diagnosticSession: { id: session.id, status: session.status, revision: session.revision, updatedAt: session.updatedAt }, proposal: null }
      return session
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '重新生成计划失败'; throw cause }
    finally { loading.value = false }
  }

  return { state, loading, error, load, start, regenerate }
})
