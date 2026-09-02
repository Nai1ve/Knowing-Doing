<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Check, FileText, RefreshCw } from 'lucide-vue-next'
import WritingWorkspaceHeader from '@/components/writing/WritingWorkspaceHeader.vue'
import WritingStageNav from '@/components/writing/WritingStageNav.vue'
import WritingOutline from '@/components/writing/WritingOutline.vue'
import WritingArticle from '@/components/writing/WritingArticle.vue'
import WritingReview from '@/components/writing/WritingReview.vue'
import WritingPreview from '@/components/writing/WritingPreview.vue'
import WritingEvidenceMap from '@/components/writing/WritingEvidenceMap.vue'
import { useWritingStore } from '@/stores/writing'
import { useCurationStore } from '@/stores/curation'
import { usePracticeStore } from '@/stores/practice'
import type { ProductWritingDocument, ProductWritingSection } from '@/types/product'

const route = useRoute()
const router = useRouter()
const writingStore = useWritingStore()
const curationStore = useCurationStore()
const practiceStore = usePracticeStore()
const stages = [
  { name: 'writing-materials', label: '证据', detail: '确认六个证据聚类' },
  { name: 'writing-outline', label: '大纲', detail: '确认判断路径' },
  { name: 'writing-article', label: '文章', detail: '分章节编辑初稿' },
  { name: 'writing-review', label: '审查', detail: '检查事实与来源' },
  { name: 'writing-preview', label: '预览', detail: '查看知乎样式' },
]
const stageName = computed(() => String(route.name ?? 'writing-materials'))
const stageIndex = computed(() => Math.max(0, stages.findIndex((stage) => stage.name === stageName.value)))
const stageTitle = computed(() => stages[stageIndex.value]?.detail ?? '从实践生成文章')
const historyOpen = ref(false)
function storedPracticeId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('zhixing.active.practice.id') ?? window.localStorage.getItem('zhixing.last.practice.id')
}
const currentRunId = computed(() => (typeof route.query.runId === 'string' ? route.query.runId : null) ?? practiceStore.run?.id ?? storedPracticeId())
const historyItems = computed(() => practiceStore.history)
const currentPractice = computed(() => historyItems.value.find((item) => item.id === currentRunId.value) ?? null)

async function selectHistory(practiceId: string) {
  await practiceStore.selectHistory(practiceId)
  historyOpen.value = false
  if (route.query.runId !== practiceId) await router.replace({ query: { ...route.query, runId: practiceId } })
}

async function initializeStage() {
  if (!currentRunId.value) return
  if (stageName.value === 'writing-materials') await curationStore.initialize(currentRunId.value)
  else await writingStore.initialize(currentRunId.value)
}
onMounted(async () => { await practiceStore.loadHistory(); await initializeStage() })
watch([stageName, currentRunId], () => { void initializeStage() })

function saveSection(document: ProductWritingDocument, section: ProductWritingSection, content: string) { void writingStore.saveSection(document, section.id, content) }
async function continueToOutline() {
  if (!currentRunId.value || !curationStore.overview?.canGenerateOutline) return
  await writingStore.initialize(currentRunId.value)
  await writingStore.makeOutline()
  if (!writingStore.error) await router.push({ name: 'writing-outline', query: route.query })
}
async function copyMarkdown() {
  const document = writingStore.article
  if (!document) return
  const markdown = [`# ${document.title}`, '', document.summary, '', ...document.sections.flatMap((section) => [`## ${section.title}`, section.content, ''])].join('\n')
  await navigator.clipboard.writeText(markdown)
  writingStore.status = '文章 Markdown 已复制。'
}
</script>

<template>
  <div id="writing-title" class="page writing-page">
    <WritingWorkspaceHeader :current-practice="currentPractice" :history="historyItems" :history-loading="practiceStore.historyLoading" :history-open="historyOpen" :stage-label="stageTitle" @toggle-history="historyOpen = !historyOpen" @select="selectHistory" @back="router.push({ name: 'lesson', query: route.query })" @refresh="stageName === 'writing-materials' ? curationStore.refresh() : writingStore.refresh()" />
    <WritingStageNav :stages="stages" :active-name="stageName" />
    <div class="writing-stage">
      <div v-if="!currentRunId && !practiceStore.historyLoading" class="writing-empty" role="status"><FileText :size="20" aria-hidden="true" /><strong>先选择一条实践</strong><p>写作沉淀只整理已经完成的实践记录，不会在这里重新执行实验。</p><button class="secondary-button" type="button" @click="historyOpen = true">打开实践历史</button></div>
      <div v-else-if="stageName === 'writing-materials' && curationStore.loading" class="writing-state" role="status">正在整理证据地图…</div>
      <div v-else-if="stageName === 'writing-materials' && curationStore.error && !curationStore.overview" class="writing-state error" role="alert">{{ curationStore.error }}<button class="secondary-button" type="button" @click="router.push({ name: 'lesson', query: route.query })">回到 MySQL 实验</button></div>
      <WritingEvidenceMap v-else-if="stageName === 'writing-materials' && curationStore.overview" :overview="curationStore.overview" :detail="curationStore.detail" :active-cluster-id="curationStore.activeClusterId" :filter="curationStore.filter" :loading="curationStore.loading" :detail-loading="curationStore.detailLoading" :saving="curationStore.saving" @open="curationStore.selectCluster" @status="curationStore.setStatus" @filter="curationStore.setFilter" @load-more="curationStore.loadMore" @refresh="curationStore.refresh" @replay="curationStore.replay" @continue="continueToOutline" />
      <template v-else-if="stageName !== 'writing-materials' && writingStore.project">
        <div class="writing-status"><span><strong>{{ writingStore.project.status === 'ready_for_preview' ? '可以预览' : '写作进行中' }}</strong> · {{ writingStore.selectedCount }} 条素材已选</span><span>最近更新 {{ new Date(writingStore.project.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span><button class="icon-button" type="button" title="刷新写作工程" aria-label="刷新写作工程" @click="writingStore.refresh"><RefreshCw :size="13" aria-hidden="true" /></button></div>
        <div v-if="writingStore.error" class="inline-error" role="alert">{{ writingStore.error }}<button v-if="writingStore.generationJob?.status === 'failed'" class="secondary-button" type="button" :disabled="writingStore.generating !== null" @click="writingStore.retryGeneration">重试生成</button></div>
        <WritingOutline v-if="stageName === 'writing-outline'" :document="writingStore.outline" :generating="writingStore.generating === 'outline'" :saving="writingStore.saving" @generate="writingStore.makeOutline" @save="saveSection" />
        <WritingArticle v-else-if="stageName === 'writing-article'" :document="writingStore.article" :saving="writingStore.saving" @save="saveSection" />
        <WritingReview v-else-if="stageName === 'writing-review'" :project="writingStore.project" :saving="writingStore.saving" @review="writingStore.runReview" />
        <WritingPreview v-else :project="writingStore.project" :document="writingStore.article" @copy="copyMarkdown" />
        <div class="writing-actions"><button v-if="stageName === 'writing-outline' && writingStore.outline?.status !== 'confirmed'" class="primary-button" type="button" :disabled="!writingStore.outline || writingStore.saving" @click="writingStore.confirmOutline"><Check :size="13" aria-hidden="true" />确认大纲</button><button v-else-if="stageName === 'writing-outline'" class="primary-button" type="button" :disabled="!writingStore.outline || writingStore.generating !== null" @click="writingStore.makeArticle">生成文章初稿 <ArrowRight :size="13" aria-hidden="true" /></button><button v-else-if="stageName === 'writing-article'" class="primary-button" type="button" :disabled="!writingStore.article || writingStore.saving" @click="writingStore.runReview">进入发布审查 <ArrowRight :size="13" aria-hidden="true" /></button><button v-else-if="stageName === 'writing-review'" class="primary-button" type="button" :disabled="writingStore.project.status !== 'ready_for_preview'" @click="$router.push({ name: 'writing-preview' })">查看知乎预览 <ArrowRight :size="13" aria-hidden="true" /></button><span v-else class="writing-endnote">当前为预览状态，不会调用知乎写接口。</span></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.writing-page { max-width: 1480px; }.writing-stage { display: grid; gap: 14px; margin-top: 14px; }.writing-state { display: grid; gap: 14px; padding: 24px 18px; border-top: 2px solid var(--blue); background: var(--paper-muted); color: var(--muted); font-size: 12px; }.writing-state.error { border-top-color: var(--red); color: var(--red); }.writing-state button, .writing-empty button { width: fit-content; }.writing-empty { display: grid; justify-items: start; gap: 10px; padding: 42px 26px; border-top: 2px solid var(--blue); background: var(--paper-muted); color: var(--muted); }.writing-empty strong { color: var(--ink); font-size: 15px; }.writing-empty p { margin: 0; max-width: 480px; font-size: 11px; line-height: 1.6; }.writing-status { display: flex; align-items: center; gap: 13px; padding: 9px 12px; border-left: 2px solid var(--blue); background: var(--blue-soft); color: #586476; font: 9px var(--mono); }.writing-status strong { color: var(--blue); font-weight: 500; }.writing-status span:nth-child(2) { margin-left: auto; }.icon-button { display: grid; place-items: center; width: 25px; height: 25px; border: 1px solid #b8c1ec; background: transparent; color: var(--blue); }.inline-error { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-left: 2px solid var(--red); background: var(--red-soft); font-size: 10px; }.inline-error button { margin-left: auto; }.writing-actions { display: flex; justify-content: flex-end; align-items: center; min-height: 36px; }.writing-actions button { display: inline-flex; align-items: center; gap: 6px; }.writing-endnote { color: var(--muted); font: 9px var(--mono); }
@media (max-width: 760px) { .writing-status { align-items: start; flex-wrap: wrap; }.writing-status span:nth-child(2) { margin-left: 0; } }
@media (max-width: 560px) { .writing-actions { justify-content: stretch; }.writing-actions button { justify-content: center; width: 100%; } }
</style>
