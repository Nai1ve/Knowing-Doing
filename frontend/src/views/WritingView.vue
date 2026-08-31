<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-vue-next'
import PageHeader from '@/components/shared/PageHeader.vue'
import WritingMaterials from '@/components/writing/WritingMaterials.vue'
import WritingOutline from '@/components/writing/WritingOutline.vue'
import WritingArticle from '@/components/writing/WritingArticle.vue'
import WritingReview from '@/components/writing/WritingReview.vue'
import WritingPreview from '@/components/writing/WritingPreview.vue'
import { useWritingStore } from '@/stores/writing'
import { usePracticeStore } from '@/stores/practice'
import type { ProductWritingDocument, ProductWritingMaterial, ProductWritingSection } from '@/types/product'

const route = useRoute()
const writingStore = useWritingStore()
const practiceStore = usePracticeStore()
const stages = [
  { name: 'writing-materials', label: '素材', detail: '从实践记录中选择' },
  { name: 'writing-outline', label: '大纲', detail: '确认判断路径' },
  { name: 'writing-article', label: '文章', detail: '分章节编辑初稿' },
  { name: 'writing-review', label: '审查', detail: '检查事实与来源' },
  { name: 'writing-preview', label: '预览', detail: '查看知乎样式' },
]
const stageName = computed(() => String(route.name ?? 'writing-materials'))
const stageIndex = computed(() => Math.max(0, stages.findIndex((stage) => stage.name === stageName.value)))
const stageTitle = computed(() => stages[stageIndex.value]?.detail ?? '从实践生成文章')

onMounted(() => {
  const queryRunId = typeof route.query.runId === 'string' ? route.query.runId : null
  void writingStore.initialize(practiceStore.run?.id ?? queryRunId)
})

function toggleMaterial(material: ProductWritingMaterial, selected: boolean) { void writingStore.toggleMaterial(material.id, selected) }
function saveSection(document: ProductWritingDocument, section: ProductWritingSection, content: string) { void writingStore.saveSection(document, section.id, content) }
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
    <PageHeader eyebrow="04 · Writing studio" title="把一次实践写成自己的文章。" :description="`从实践记录、Lab 证据和知乎参考出发，完成${stageTitle}。原始记录保持不变，文章内容由你确认。`" :meta="['工程实践复盘型', '证据可追溯', '发布前人工确认']" />
    <div class="writing-shell">
      <nav class="writing-steps" aria-label="写作流程"><RouterLink v-for="(stage, index) in stages" :key="stage.name" :to="{ name: stage.name, query: route.query }" class="writing-step" :class="{ active: stageName === stage.name, passed: index < stageIndex }"><span class="step-marker"><CheckCircle2 v-if="index < stageIndex" :size="13" aria-hidden="true" /><span v-else>{{ String(index + 1).padStart(2, '0') }}</span></span><span><strong>{{ stage.label }}</strong><small>{{ stage.detail }}</small></span><ArrowRight v-if="index < stages.length - 1" class="step-arrow" :size="13" aria-hidden="true" /></RouterLink></nav>
      <div v-if="writingStore.loading" class="writing-state" role="status">正在整理本次实践素材…</div>
      <div v-else-if="writingStore.error && !writingStore.project" class="writing-state error" role="alert">{{ writingStore.error }}<RouterLink class="secondary-button" :to="{ name: 'lesson' }">回到 MySQL 实验</RouterLink></div>
      <template v-else-if="writingStore.project">
        <div class="writing-status"><span><strong>{{ writingStore.project.status === 'ready_for_preview' ? '可以预览' : '写作进行中' }}</strong> · {{ writingStore.selectedCount }} 条素材已选</span><span>最近更新 {{ new Date(writingStore.project.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span><button class="icon-button" type="button" title="刷新写作工程" aria-label="刷新写作工程" @click="writingStore.refresh"><RefreshCw :size="13" aria-hidden="true" /></button></div>
        <div v-if="writingStore.error" class="inline-error" role="alert">{{ writingStore.error }}</div>
        <WritingMaterials v-if="stageName === 'writing-materials'" :project="writingStore.project" :saving="writingStore.saving" @toggle="toggleMaterial" />
        <WritingOutline v-else-if="stageName === 'writing-outline'" :document="writingStore.outline" :generating="writingStore.generating === 'outline'" :saving="writingStore.saving" @generate="writingStore.makeOutline" @save="saveSection" />
        <WritingArticle v-else-if="stageName === 'writing-article'" :document="writingStore.article" :saving="writingStore.saving" @save="saveSection" />
        <WritingReview v-else-if="stageName === 'writing-review'" :project="writingStore.project" :saving="writingStore.saving" @review="writingStore.runReview" />
        <WritingPreview v-else :project="writingStore.project" :document="writingStore.article" @copy="copyMarkdown" />
        <div class="writing-actions"><button v-if="stageName === 'writing-materials'" class="primary-button" type="button" :disabled="writingStore.generating !== null" @click="writingStore.makeOutline">生成实践大纲 <ArrowRight :size="13" aria-hidden="true" /></button><button v-else-if="stageName === 'writing-outline'" class="primary-button" type="button" :disabled="!writingStore.outline || writingStore.generating !== null" @click="writingStore.makeArticle">生成文章初稿 <ArrowRight :size="13" aria-hidden="true" /></button><button v-else-if="stageName === 'writing-article'" class="primary-button" type="button" :disabled="!writingStore.article || writingStore.saving" @click="writingStore.runReview">进入发布审查 <ArrowRight :size="13" aria-hidden="true" /></button><button v-else-if="stageName === 'writing-review'" class="primary-button" type="button" :disabled="writingStore.project.status !== 'ready_for_preview'" @click="$router.push({ name: 'writing-preview' })">查看知乎预览 <ArrowRight :size="13" aria-hidden="true" /></button><span v-else class="writing-endnote">当前为预览状态，不会调用知乎写接口。</span></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.writing-page { max-width: 1040px; }.writing-shell { display: grid; gap: 14px; margin-top: 22px; }.writing-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--paper-muted); }.writing-step { position: relative; display: flex; gap: 8px; align-items: center; min-width: 0; padding: 12px 13px; border-right: 1px solid var(--line); color: var(--muted); text-decoration: none; }.writing-step:last-child { border-right: 0; }.writing-step:hover, .writing-step.active { background: #fff; color: var(--blue); }.writing-step.passed { color: var(--green); }.step-marker { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid currentColor; flex: 0 0 auto; font: 9px var(--mono); }.writing-step strong, .writing-step small { display: block; }.writing-step strong { font-size: 11px; font-weight: 600; }.writing-step small { margin-top: 3px; color: var(--muted); font-size: 9px; white-space: nowrap; }.step-arrow { display: none; }.writing-state { display: grid; gap: 14px; padding: 24px 18px; border-top: 2px solid var(--blue); background: var(--paper-muted); color: var(--muted); font-size: 12px; }.writing-state.error { border-top-color: var(--red); color: var(--red); }.writing-state a { width: fit-content; text-decoration: none; }.writing-status { display: flex; align-items: center; gap: 13px; padding: 9px 12px; border-left: 2px solid var(--blue); background: var(--blue-soft); color: #586476; font: 9px var(--mono); }.writing-status strong { color: var(--blue); font-weight: 500; }.writing-status span:nth-child(2) { margin-left: auto; }.icon-button { display: grid; place-items: center; width: 25px; height: 25px; border: 1px solid #b8c1ec; background: transparent; color: var(--blue); }.inline-error { padding: 10px 12px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); font-size: 10px; }.writing-actions { display: flex; justify-content: flex-end; align-items: center; min-height: 36px; }.writing-actions button { display: inline-flex; align-items: center; gap: 6px; }.writing-endnote { color: var(--muted); font: 9px var(--mono); }
@media (max-width: 760px) { .writing-steps { display: flex; overflow-x: auto; }.writing-step { flex: 0 0 155px; }.writing-step small { white-space: normal; }.writing-status { align-items: start; flex-wrap: wrap; }.writing-status span:nth-child(2) { margin-left: 0; } }
@media (max-width: 560px) { .writing-actions { justify-content: stretch; }.writing-actions button { justify-content: center; width: 100%; } }
</style>
