import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { editWritingSection, generateWritingArticle, generateWritingOutline, getWriting, initializeWriting, reviewWriting, selectWritingMaterial } from '@/api/productService'
import type { ProductWritingDocument, ProductWritingProject } from '@/types/product'

const activePracticeKey = 'zhixing.active.practice.id'

export const useWritingStore = defineStore('writing', () => {
  const project = ref<ProductWritingProject | null>(null)
  const runId = ref<string | null>(null)
  const loading = ref(false)
  const generating = ref<'outline' | 'article' | null>(null)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const status = ref('')

  const outline = computed(() => project.value?.documents.find((document) => document.kind === 'outline') ?? null)
  const article = computed(() => project.value?.documents.find((document) => document.kind === 'article') ?? null)
  const selectedCount = computed(() => project.value?.materials.filter((material) => material.selected).length ?? 0)
  const blockingCount = computed(() => project.value?.reviewItems.filter((item) => item.status === 'open' && item.severity === 'blocking').length ?? 0)

  function activeRunId(): string | null {
    if (runId.value) return runId.value
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(activePracticeKey)
  }

  async function initialize(preferredRunId?: string | null) {
    const id = preferredRunId ?? activeRunId()
    if (!id) { error.value = '请先从 MySQL 实验进入一次实践，再整理文章。'; return }
    runId.value = id
    if (typeof window !== 'undefined') window.localStorage.setItem(activePracticeKey, id)
    loading.value = true; error.value = null
    try { project.value = await initializeWriting(id); status.value = '已载入本次实践的写作素材。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '写作工程载入失败' } finally { loading.value = false }
  }

  async function refresh() {
    const id = activeRunId()
    if (!id) return initialize(null)
    runId.value = id; loading.value = true; error.value = null
    try { project.value = await getWriting(id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '写作工程刷新失败' } finally { loading.value = false }
  }

  async function toggleMaterial(materialId: string, selected: boolean) {
    if (!runId.value || saving.value) return
    saving.value = true; error.value = null
    try { project.value = await selectWritingMaterial(runId.value, materialId, selected); status.value = selected ? '素材已加入写作快照。' : '素材已从写作快照移除。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '素材更新失败' } finally { saving.value = false }
  }

  async function makeOutline() {
    if (!runId.value || generating.value) return
    generating.value = 'outline'; error.value = null
    try { project.value = await generateWritingOutline(runId.value); status.value = '大纲已生成，请逐节确认判断和证据。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '大纲生成失败' } finally { generating.value = null }
  }

  async function makeArticle() {
    if (!runId.value || generating.value) return
    generating.value = 'article'; error.value = null
    try { project.value = await generateWritingArticle(runId.value); status.value = '文章初稿已生成，请完成发布前审查。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '文章生成失败' } finally { generating.value = null }
  }

  async function saveSection(document: ProductWritingDocument, sectionId: string, content: string) {
    if (!runId.value || saving.value) return
    saving.value = true; error.value = null
    try { project.value = await editWritingSection(runId.value, document.id, sectionId, document.revision, content); status.value = '章节已保存。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '章节保存失败' } finally { saving.value = false }
  }

  async function runReview() {
    if (!runId.value || saving.value) return
    saving.value = true; error.value = null
    try { project.value = await reviewWriting(runId.value); status.value = blockingCount.value === 0 ? '审查完成，可查看知乎预览。' : '审查完成，请先处理阻断项。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '审查失败' } finally { saving.value = false }
  }

  return { project, runId, loading, generating, saving, error, status, outline, article, selectedCount, blockingCount, initialize, refresh, toggleMaterial, makeOutline, makeArticle, saveSection, runReview }
})
