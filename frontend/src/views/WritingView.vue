<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import WritingWorkspaceHeader from '@/components/writing/WritingWorkspaceHeader.vue'
import WritingDraftProgress from '@/components/writing/WritingDraftProgress.vue'
import WritingArticleWorkspace from '@/components/writing/WritingArticleWorkspace.vue'
import { useWritingStore } from '@/stores/writing'
import { usePracticeStore } from '@/stores/practice'
import type { ProductWritingBlock } from '@/types/product'

const route = useRoute(); const router = useRouter(); const writingStore = useWritingStore(); const practiceStore = usePracticeStore(); const historyOpen = ref(false)
function storedPracticeId(): string | null { if (typeof window === 'undefined') return null; return window.localStorage.getItem('zhixing.active.practice.id') ?? window.localStorage.getItem('zhixing.last.practice.id') }
const currentRunId = computed(() => (typeof route.query.runId === 'string' ? route.query.runId : null) ?? writingStore.runId ?? practiceStore.run?.id ?? storedPracticeId())
const currentPractice = computed(() => practiceStore.history.find((item) => item.id === currentRunId.value) ?? null)

async function selectHistory(practiceId: string) { await practiceStore.selectHistory(practiceId); historyOpen.value = false; await router.replace({ name: 'writing', query: { runId: practiceId } }) }
async function initialize() { if (currentRunId.value) await writingStore.initialize(currentRunId.value) }
onMounted(async () => { await practiceStore.loadHistory(); await initialize() })
watch(currentRunId, () => { if (currentRunId.value && currentRunId.value !== writingStore.runId) void initialize() })
onBeforeUnmount(() => writingStore.dispose())

function copyMarkdown() {
  const document = writingStore.article; if (!document) return
  const markdown = document.contentMarkdown || [`# ${document.title}`, '', document.summary, '', ...document.sections.flatMap((section) => [`## ${section.title}`, ...section.blocks.map((block) => block.content), ''])].join('\n')
  void navigator.clipboard.writeText(markdown)
}
function editBlock(block: ProductWritingBlock, content: string, immediate = false) { writingStore.queueBlockSave(block, content, immediate) }
function refresh() { void writingStore.refresh() }
</script>

<template>
  <div id="writing-title" class="page writing-page">
    <WritingWorkspaceHeader :current-practice="currentPractice" :history="practiceStore.history" :history-loading="practiceStore.historyLoading" :history-open="historyOpen" stage-label="自动写作" @toggle-history="historyOpen = !historyOpen" @select="selectHistory" @back="router.push({ name: 'lesson', query: route.query })" @refresh="refresh" />
    <div class="writing-stage">
      <div v-if="!currentRunId && !practiceStore.historyLoading" class="writing-empty" role="status"><FileText :size="20" aria-hidden="true" /><strong>先完成一条实践</strong><p>实践完成后，知行会自动把过程整理成可编辑的工程文章。</p><button class="secondary-button" type="button" @click="historyOpen = true">打开实践历史</button></div>
      <div v-else-if="writingStore.loading" class="writing-state" role="status">正在载入写作工作区…</div>
      <div v-else-if="writingStore.error && !writingStore.workspace" class="writing-state error" role="alert">{{ writingStore.error }}<button class="secondary-button" type="button" @click="refresh">重新载入</button></div>
      <WritingDraftProgress v-else-if="writingStore.draftRun && writingStore.draftRun.phase !== 'ready'" :draft="writingStore.draftRun" @retry="writingStore.retry" />
      <WritingArticleWorkspace v-else-if="writingStore.article && writingStore.project" :project="writingStore.project" :document="writingStore.article" :save-state="writingStore.saveState" :active-block-id="writingStore.activeBlockId" :evidence="writingStore.evidence" :evidence-loading="writingStore.evidenceLoading" @edit="editBlock" @evidence="writingStore.openEvidence" @close-evidence="writingStore.closeEvidence" @regenerate="writingStore.regenerate" @copy="copyMarkdown" />
      <div v-else class="writing-state" role="status">这条实践还没有可生成的文章。请先完成 Lab 验证。</div>
    </div>
  </div>
</template>

<style scoped>
.writing-page { max-width: 1480px; }.writing-stage { display: grid; gap: 14px; margin-top: 14px; }.writing-state { display: grid; gap: 14px; padding: 24px 18px; border-top: 2px solid var(--blue); background: var(--paper-muted); color: var(--muted); font-size: 12px; }.writing-state.error { border-top-color: var(--red); color: var(--red); }.writing-state button, .writing-empty button { width: fit-content; }.writing-empty { display: grid; justify-items: start; gap: 10px; padding: 42px 26px; border-top: 2px solid var(--blue); background: var(--paper-muted); color: var(--muted); }.writing-empty strong { color: var(--ink); font-size: 15px; }.writing-empty p { margin: 0; max-width: 480px; font-size: 11px; line-height: 1.6; }
</style>
