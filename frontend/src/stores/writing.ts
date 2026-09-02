import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { editWritingBlock, getWritingBlockEvidence, getWritingWorkspace, regenerateWritingDraft, retryWritingDraft } from '@/api/productService'
import type { ProductWritingBlock, ProductWritingBlockEvidence, ProductWritingDocument, ProductWritingDraftRun, ProductWritingProject, ProductWritingWorkspace } from '@/types/product'

const activePracticeKey = 'zhixing.active.practice.id'
const lastPracticeKey = 'zhixing.last.practice.id'

export const useWritingStore = defineStore('writing', () => {
  const workspace = ref<ProductWritingWorkspace | null>(null)
  const runId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const saveState = ref<'idle' | 'saving' | 'saved' | 'offline' | 'conflict'>('idle')
  const activeBlockId = ref<string | null>(null)
  const evidence = ref<ProductWritingBlockEvidence | null>(null)
  const evidenceLoading = ref(false)
  const pollHandle = ref<number | null>(null)
  const saveTimers = new Map<string, number>()
  const savingBlocks = new Set<string>()
  const pendingBlockSaves = new Map<string, { block: ProductWritingBlock; content: string }>()

  const project = computed(() => workspace.value?.project ?? null)
  const draftRun = computed(() => workspace.value?.draftRun ?? null)
  const article = computed(() => project.value?.documents.find((document) => document.kind === 'article') ?? null)
  const blockingCount = computed(() => project.value?.reviewItems.filter((item) => item.status === 'open' && item.severity === 'blocking').length ?? 0)

  function activeRunId(): string | null {
    if (runId.value) return runId.value
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(activePracticeKey) ?? window.localStorage.getItem(lastPracticeKey)
  }

  function setWorkspace(value: ProductWritingWorkspace) {
    workspace.value = value
    if (value.draftRun && (value.draftRun.phase === 'ready' || value.draftRun.status === 'succeeded')) stopPolling()
  }

  function stopPolling() {
    if (pollHandle.value !== null && typeof window !== 'undefined') window.clearTimeout(pollHandle.value)
    pollHandle.value = null
  }

  function schedulePoll() {
    stopPolling()
    if (typeof window === 'undefined' || !runId.value || !draftRun.value || ['ready', 'failed'].includes(draftRun.value.phase)) return
    pollHandle.value = window.setTimeout(async () => { pollHandle.value = null; await refresh(true) }, 1200)
  }

  async function initialize(preferredRunId?: string | null) {
    const id = preferredRunId ?? activeRunId()
    if (!id) { error.value = '请先完成一次实践，再进入写作沉淀。'; return }
    runId.value = id
    if (typeof window !== 'undefined') window.localStorage.setItem(activePracticeKey, id)
    loading.value = true; error.value = null
    try { setWorkspace(await getWritingWorkspace(id)); if (draftRun.value && !['ready', 'failed'].includes(draftRun.value.phase)) schedulePoll() }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '写作工作区载入失败' }
    finally { loading.value = false }
  }

  async function refresh(fromPoll = false) {
    const id = activeRunId()
    if (!id) return initialize(null)
    runId.value = id
    if (!fromPoll) loading.value = true
    try { setWorkspace(await getWritingWorkspace(id)); if (draftRun.value && !['ready', 'failed'].includes(draftRun.value.phase)) schedulePoll() }
    catch (cause) { if (!fromPoll) error.value = cause instanceof Error ? cause.message : '写作工作区刷新失败' }
    finally { if (!fromPoll) loading.value = false }
  }

  async function retry() {
    if (!runId.value || !draftRun.value || draftRun.value.phase !== 'failed') return
    error.value = null
    setWorkspace({ ...workspace.value!, draftRun: await retryWritingDraft(runId.value, draftRun.value.id), project: null })
    schedulePoll()
  }

  async function regenerate() {
    if (!runId.value) return
    error.value = null
    setWorkspace({ ...workspace.value!, draftRun: await regenerateWritingDraft(runId.value), project: null })
    schedulePoll()
  }

  function replaceDocument(document: ProductWritingDocument) {
    if (!workspace.value?.project) return
    workspace.value = { ...workspace.value, project: { ...workspace.value.project, documents: workspace.value.project.documents.map((item) => item.id === document.id ? document : item) } }
  }

  function currentBlock(blockId: string): ProductWritingBlock | null {
    return article.value?.sections.flatMap((section) => section.blocks).find((block) => block.id === blockId) ?? null
  }

  async function persistBlock(block: ProductWritingBlock, content: string) {
    if (!runId.value) return
    if (savingBlocks.has(block.id)) { pendingBlockSaves.set(block.id, { block, content }); return }
    savingBlocks.add(block.id); saveState.value = 'saving'; error.value = null
    try { replaceDocument(await editWritingBlock(runId.value, block.documentId, block.id, block.revision, content)); saveState.value = 'saved' }
    catch (cause) { saveState.value = cause instanceof Error && cause.message.includes('其他标签页') ? 'conflict' : 'offline'; error.value = cause instanceof Error ? cause.message : '段落保存失败' }
    finally {
      savingBlocks.delete(block.id)
      const pending = pendingBlockSaves.get(block.id)
      if (pending) { pendingBlockSaves.delete(block.id); const latest = currentBlock(block.id); if (latest) void persistBlock(latest, pending.content) }
    }
  }

  function queueBlockSave(block: ProductWritingBlock, content: string, immediate = false) {
    const existing = saveTimers.get(block.id)
    if (existing !== undefined && typeof window !== 'undefined') window.clearTimeout(existing)
    if (immediate || typeof window === 'undefined') { void persistBlock(block, content); return }
    const timer = window.setTimeout(() => { saveTimers.delete(block.id); void persistBlock(block, content) }, 900)
    saveTimers.set(block.id, timer)
  }

  async function openEvidence(block: ProductWritingBlock) {
    if (!runId.value || !article.value) return
    activeBlockId.value = block.id; evidenceLoading.value = true; evidence.value = null
    try { evidence.value = await getWritingBlockEvidence(runId.value, block.documentId, block.id) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '证据载入失败' }
    finally { evidenceLoading.value = false }
  }

  function closeEvidence() { activeBlockId.value = null; evidence.value = null }
  function dispose() { stopPolling(); if (typeof window !== 'undefined') for (const timer of saveTimers.values()) window.clearTimeout(timer); saveTimers.clear(); pendingBlockSaves.clear() }

  return { workspace, project, draftRun, runId, article, loading, error, saveState, activeBlockId, evidence, evidenceLoading, blockingCount, initialize, refresh, retry, regenerate, queueBlockSave, persistBlock, openEvidence, closeEvidence, dispose }
})
