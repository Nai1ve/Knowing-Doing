import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getAgentPlanningSession, getAgentPlanningState } from '@/api/planningService'

type ProfileEvidenceItem = { id: string; content: string; evidenceKey: string; sourceKind: string; updatedAt: string }

export const useProfileStore = defineStore('profile', () => {
  const evidence = ref<ProfileEvidenceItem[]>([])
  const dimensions = ref<Array<{ key: string; level: string; confidence: number; summary: string; nextValidation: string }>>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    if (evidence.value.length) return
    loading.value = true
    error.value = null
    try {
      const state = await getAgentPlanningState()
      if (!state.session) return
      const session = await getAgentPlanningSession(state.session.id)
      evidence.value = (session.profile?.evidence ?? []).map((item) => ({ id: item.id, content: item.excerpt, evidenceKey: item.topicKey ?? item.sourceType, sourceKind: item.sourceType, updatedAt: item.createdAt }))
      dimensions.value = session.profile?.dimensions ?? []
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '学习档案加载失败'
    } finally {
      loading.value = false
    }
  }

  return { evidence, dimensions, loading, error, load }
})
