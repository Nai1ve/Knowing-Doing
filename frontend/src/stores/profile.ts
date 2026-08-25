import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getProfile } from '@/api/profileService'
import type { UserProfile } from '@/types/domain'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<UserProfile | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    if (profile.value) return
    loading.value = true
    error.value = null
    try {
      profile.value = await getProfile()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '学习档案加载失败'
    } finally {
      loading.value = false
    }
  }

  return { profile, loading, error, load }
})
