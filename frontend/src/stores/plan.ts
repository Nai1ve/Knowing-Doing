import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMysqlPerformancePlan, getActivePlan } from '@/api/planService'
import type { LearningPlan, Milestone } from '@/types/domain'
import type { ProductPlan } from '@/types/product'

export const usePlanStore = defineStore('plan', () => {
  const plan = ref<LearningPlan | null>(null)
  const productPlan = ref<ProductPlan | null>(null)
  const milestones = ref<Milestone[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const currentMilestone = computed(() => milestones.value.find((item) => item.status === 'current') ?? milestones.value.find((item) => item.status === 'upcoming'))
  const currentNode = computed(() => currentMilestone.value?.nodes.find((item) => item.status === 'current') ?? currentMilestone.value?.nodes[0])

  async function loadPlan() {
    if (loaded.value) return
    loading.value = true
    error.value = null
    try {
      productPlan.value = await getActivePlan()
      if (productPlan.value) syncLegacyPlan(productPlan.value)
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '计划加载失败'
    } finally {
      loading.value = false
    }
  }

  function syncLegacyPlan(source: ProductPlan) {
    const completedUnits = source.units.filter((unit) => unit.status === 'completed').length
    const current = source.units.find((unit) => unit.status === 'current') ?? source.units.at(-1)
    plan.value = {
      id: source.id, title: source.title, technology: 'MySQL 8', goal: source.goal,
      week: Math.min(Math.max(completedUnits + 1, 1), source.units.length), totalWeeks: source.units.length,
      progress: source.units.length ? Math.round(completedUnits / source.units.length * 100) : 0,
      completedUnits, totalUnits: source.units.length, weeklyMinutes: 240,
      currentNodeId: current?.id ?? '', startedAt: source.createdAt, dueAt: source.updatedAt,
    }
    milestones.value = source.units.map((unit, index) => ({
      id: unit.id, index: String(index + 1).padStart(2, '0'), title: unit.title,
      status: unit.status === 'completed' ? 'completed' : unit.status === 'current' && unit.availability === 'available' ? 'current' : 'upcoming',
      summary: unit.objective, progress: unit.status === 'completed' ? '已完成' : unit.availability === 'coming_soon' ? '即将开放' : unit.status === 'current' ? '进行中' : '待开始',
      nodes: [{ id: unit.id, title: unit.title, status: unit.status === 'completed' ? 'completed' : unit.status === 'current' && unit.availability === 'available' ? 'current' : 'upcoming', duration: '一次实践' }],
    }))
  }

  async function createMysqlPlan() {
    if (loading.value) return
    loading.value = true; error.value = null
    try { productPlan.value = await createMysqlPerformancePlan(); syncLegacyPlan(productPlan.value); loaded.value = true }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '计划创建失败' }
    finally { loading.value = false }
  }

  return { plan, productPlan, milestones, currentMilestone, currentNode, loading, loaded, error, loadPlan, createMysqlPlan }
})
