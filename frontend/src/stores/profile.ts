import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getProfileEvidence } from '@/api/profileService'
import type { ProductProfileEvidence } from '@/types/product'

export const useProfileStore = defineStore('profile', () => {
  const evidence = ref<ProductProfileEvidence[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    if (evidence.value.length) return
    loading.value = true
    error.value = null
    try {
      evidence.value = await getProfileEvidence()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '学习档案加载失败'
    } finally {
      loading.value = false
    }
  }

  return { evidence, loading, error, load }
})
