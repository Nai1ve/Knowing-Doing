import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getActivePlan, getPlanRoute } from '@/api/planService'
import type { LearningPlan, Milestone } from '@/types/domain'

export const usePlanStore = defineStore('plan', () => {
  const plan = ref<LearningPlan | null>(null)
  const milestones = ref<Milestone[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const currentMilestone = computed(() => milestones.value.find((item) => item.status === 'current'))
  const currentNode = computed(() => currentMilestone.value?.nodes.find((item) => item.status === 'current'))

  async function loadPlan() {
    if (loaded.value) return
    loading.value = true
    error.value = null
    try {
      plan.value = await getActivePlan()
      milestones.value = await getPlanRoute(plan.value.id)
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '计划加载失败'
    } finally {
      loading.value = false
    }
  }

  return { plan, milestones, currentMilestone, currentNode, loading, loaded, error, loadPlan }
})
