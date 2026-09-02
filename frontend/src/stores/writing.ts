import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { confirmWritingOutline, editWritingSection, getWriting, getWritingGenerationJob, initializeWriting, reviewWriting, retryWritingGeneration, selectWritingMaterial, startWritingGeneration } from '@/api/productService'
import type { ProductWritingDocument, ProductWritingGenerationJob, ProductWritingProject } from '@/types/product'

const activePracticeKey = 'zhixing.active.practice.id'
const lastPracticeKey = 'zhixing.last.practice.id'

export const useWritingStore = defineStore('writing', () => {
  const project = ref<ProductWritingProject | null>(null)
  const runId = ref<string | null>(null)
  const loading = ref(false)
  const generating = ref<'outline' | 'article' | null>(null)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const status = ref('')
  const generationJob = ref<ProductWritingGenerationJob | null>(null)

  const outline = computed(() => project.value?.documents.find((document) => document.kind === 'outline') ?? null)
  const article = computed(() => project.value?.documents.find((document) => document.kind === 'article') ?? null)
  const selectedCount = computed(() => project.value?.materials.filter((material) => material.selected).length ?? 0)
  const blockingCount = computed(() => project.value?.reviewItems.filter((item) => item.status === 'open' && item.severity === 'blocking').length ?? 0)

  function activeRunId(): string | null {
    if (runId.value) return runId.value
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(activePracticeKey) ?? window.localStorage.getItem(lastPracticeKey)
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
    try { generationJob.value = await waitForGeneration(await startWritingGeneration(runId.value, 'outline')); if (generationJob.value.status === 'succeeded') { await refresh(); status.value = '大纲已生成，请逐节确认判断和证据。' } } catch (cause) { error.value = cause instanceof Error ? cause.message : '大纲生成失败' } finally { generating.value = null }
  }

  async function makeArticle() {
    if (!runId.value || generating.value) return
    generating.value = 'article'; error.value = null
    try {
      const document = outline.value
      if (!document) throw new Error('请先生成大纲')
      if (document.status !== 'confirmed') throw new Error('请先确认大纲，再生成文章初稿')
      generationJob.value = await waitForGeneration(await startWritingGeneration(runId.value, 'article'))
      if (generationJob.value.status === 'succeeded') { await refresh(); status.value = '文章初稿已生成，请完成发布前审查。' }
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '文章生成失败' } finally { generating.value = null }
  }

  async function confirmOutline() {
    if (!runId.value || !outline.value || saving.value) return
    saving.value = true; error.value = null
    try { const confirmed = await confirmWritingOutline(runId.value, outline.value.id); project.value = { ...project.value!, documents: project.value!.documents.map((item) => item.id === confirmed.id ? confirmed : item) }; status.value = '大纲已确认，可以生成文章初稿。' } catch (cause) { error.value = cause instanceof Error ? cause.message : '大纲确认失败' } finally { saving.value = false }
  }

  async function waitForGeneration(initial: ProductWritingGenerationJob): Promise<ProductWritingGenerationJob> {
    let current = initial
    for (let attempt = 0; attempt < 180; attempt += 1) {
      generationJob.value = current
      if (current.status === 'succeeded') return current
      if (current.status === 'failed' || current.status === 'interrupted') throw new Error(current.failureMessage || '写作 Agent 生成失败')
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      if (runId.value) current = await getWritingGenerationJob(runId.value, current.id)
    }
    throw new Error('写作 Agent 生成超时，请稍后重试')
  }

  async function retryGeneration() {
    if (!runId.value || !generationJob.value || generating.value) return
    generating.value = generationJob.value.kind === 'outline' ? 'outline' : 'article'; error.value = null
    try { generationJob.value = await waitForGeneration(await retryWritingGeneration(runId.value, generationJob.value.id)); await refresh() } catch (cause) { error.value = cause instanceof Error ? cause.message : '写作任务重试失败' } finally { generating.value = null }
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

  return { project, runId, loading, generating, saving, error, status, generationJob, outline, article, selectedCount, blockingCount, initialize, refresh, toggleMaterial, makeOutline, confirmOutline, makeArticle, retryGeneration, saveSection, runReview }
})
