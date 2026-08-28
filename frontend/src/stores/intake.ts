import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { confirmProductPlan, createProductIntake, createProductPlan } from '@/api/productService'
import type { ProductIntake, ProductPlan } from '@/types/product'

export const useIntakeStore = defineStore('intake', () => {
  const intake = ref<ProductIntake | null>(null)
  const plan = ref<ProductPlan | null>(null)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const hasPlan = computed(() => Boolean(plan.value))

  async function create(goal: string) {
    const cleanGoal = goal.trim()
    if (!cleanGoal || submitting.value) return
    submitting.value = true; error.value = null
    try {
      intake.value = await createProductIntake({ goal: cleanGoal })
      plan.value = await createProductPlan(intake.value.id)
      plan.value = await confirmProductPlan(plan.value.id)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '学习路线生成失败' } finally { submitting.value = false }
  }

  return { intake, plan, submitting, error, hasPlan, create }
})
