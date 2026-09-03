import { defineStore } from 'pinia'
import { ref } from 'vue'
import { confirmPlanProposal, createPlanProposal, getDiagnosticSession, getPlanProposal, saveDiagnosticSession } from '@/api/onboardingService'
import type { ProductDiagnosticSession, ProductPlan, ProductPlanProposal } from '@/types/product'

export const useDiagnosticStore = defineStore('diagnostic', () => {
  const session = ref<ProductDiagnosticSession | null>(null)
  const proposal = ref<ProductPlanProposal | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)

  async function loadSession(id: string) {
    loading.value = true; error.value = null
    try { session.value = await getDiagnosticSession(id); return session.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '诊断加载失败'; throw cause }
    finally { loading.value = false }
  }

  async function save(id: string, input: { goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }) {
    if (!session.value || submitting.value) return null
    submitting.value = true; error.value = null
    try { session.value = await saveDiagnosticSession(id, { ...input, revision: session.value.revision }); return session.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '诊断保存失败'; throw cause }
    finally { submitting.value = false }
  }

  async function generateProposal(id: string) {
    submitting.value = true; error.value = null
    try { proposal.value = await createPlanProposal(id); return proposal.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '计划草案生成失败'; throw cause }
    finally { submitting.value = false }
  }

  async function loadProposal(id: string) {
    loading.value = true; error.value = null
    try { proposal.value = await getPlanProposal(id); return proposal.value }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '计划草案加载失败'; throw cause }
    finally { loading.value = false }
  }

  async function confirm(id: string): Promise<ProductPlan> {
    if (!proposal.value || submitting.value) throw new Error('草案尚未加载')
    submitting.value = true; error.value = null
    try { return await confirmPlanProposal(id, proposal.value.revision) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '计划确认失败'; throw cause }
    finally { submitting.value = false }
  }

  return { session, proposal, loading, submitting, error, loadSession, save, generateProposal, loadProposal, confirm }
})
