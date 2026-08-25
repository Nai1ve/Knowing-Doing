import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { generateOutline, saveNoteDraft } from '@/api/notesService'
import type { EventType } from '@/types/domain'

export const useNotesStore = defineStore('notes', () => {
  const stage = ref<'capture' | 'outline' | 'article'>('capture')
  const filter = ref<EventType | 'all'>('all')
  const outline = ref('')
  const article = ref('')
  const generatingOutline = ref(false)
  const generatingArticle = ref(false)
  const status = ref('')

  const articlePreview = computed(() => article.value)

  async function createOutline(planId: string) {
    generatingOutline.value = true
    status.value = ''
    try {
      outline.value = await generateOutline(planId)
      status.value = '已根据实践记录生成大纲草稿，请人工确认。'
    } finally {
      generatingOutline.value = false
    }
  }

  async function completeArticle() {
    generatingArticle.value = true
    status.value = ''
    article.value = `# 从一份最小 YAML 理解 Deployment 的期望状态\n\n我最近在本地集群里写一份最小 deployment.yaml。真正让我卡住的不是 replicas: 3 怎么写，而是当只有 2 个 Pod Ready 时，我应该先相信什么证据。\n\n## 先区分三个状态\nDeployment 描述发布和期望状态，ReplicaSet 负责维持副本数，Pod 才是实际运行单元。于是排查不能直接跳到“改镜像”，而要先对照期望副本、当前副本和 Ready 状态。\n\n## 错误是学习记录的一部分\n实践中我先遇到了 deployment.yaml 缩进错误。这个错误提醒我，配置文件必须先成为 Kubernetes 能理解的对象。`
    status.value = '已按确认的大纲完成文章草稿，仍可人工修改。'
    generatingArticle.value = false
  }

  async function save(planId: string) {
    await saveNoteDraft(planId, { outline: outline.value, article: article.value })
    status.value = '文章与大纲已保存。'
  }

  return { stage, filter, outline, article, articlePreview, generatingOutline, generatingArticle, status, createOutline, completeArticle, save }
})
