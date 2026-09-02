<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle, Check, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import type { ProductWritingDraftRun } from '@/types/product'

const props = defineProps<{ draft: ProductWritingDraftRun; title?: string }>()
const emit = defineEmits<{ retry: [] }>()
const phases = [
  { key: 'indexing', label: '整理实践资料', detail: '读取本次实践的过程记录' },
  { key: 'drafting', label: '撰写文章', detail: '把实践过程整理成完整复盘' },
  { key: 'humanizing', label: '润色表达', detail: '调整文章的叙述节奏和语气' },
]
const activeIndex = computed(() => phases.findIndex((phase) => phase.key === props.draft.phase))
const statusCopy = computed(() => props.draft.phase === 'failed' ? '这次整理没有完成' : props.draft.status === 'queued' ? '已排队，马上开始整理' : '正在整理这次实践')
</script>

<template>
  <section class="draft-progress" aria-live="polite" aria-labelledby="draft-progress-title">
    <div class="progress-mark" :class="{ failed: draft.phase === 'failed' }"><AlertCircle v-if="draft.phase === 'failed'" :size="21" aria-hidden="true" /><LoaderCircle v-else :size="21" class="spin" aria-hidden="true" /></div>
    <div class="progress-copy"><span class="eyebrow">写作沉淀</span><h1 id="draft-progress-title">{{ statusCopy }}</h1><p v-if="draft.phase === 'failed'">{{ draft.failureMessage || '后台整理暂时不可用，实践记录仍然保留。' }}</p><p v-else>知行正在把你的实践过程整理成一篇可修改的工程文章。原始记录不会被改写。</p></div>
    <ol v-if="draft.phase !== 'failed'" class="progress-steps" aria-label="自动写作进度">
      <li v-for="(phase, index) in phases" :key="phase.key" :class="{ active: phase.key === draft.phase, done: index < activeIndex }"><span class="step-mark"><Check v-if="index < activeIndex" :size="12" aria-hidden="true" /><span v-else>{{ index + 1 }}</span></span><span><strong>{{ phase.label }}</strong><small>{{ phase.detail }}</small></span></li>
    </ol>
    <button v-else class="primary-button retry-button" type="button" @click="emit('retry')"><RefreshCw :size="14" aria-hidden="true" />重试整理</button>
  </section>
</template>

<style scoped>
.draft-progress { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px 16px; max-width: 940px; margin: 54px auto; padding: 30px 28px; border-top: 2px solid var(--blue); background: var(--paper-muted); }.progress-mark { display: grid; place-items: center; width: 42px; height: 42px; color: var(--blue); background: var(--blue-soft); }.progress-mark.failed { color: var(--red); background: var(--red-soft); }.spin { animation: spin 1.2s linear infinite; }.progress-copy h1 { margin: 7px 0 0; color: var(--ink); font: 400 25px/1.25 var(--serif); }.progress-copy p { max-width: 600px; margin: 9px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }.progress-steps { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 10px 0 0; padding: 0; list-style: none; background: var(--line); }.progress-steps li { display: flex; gap: 9px; min-width: 0; padding: 14px 12px; background: #fff; color: var(--muted); }.progress-steps li.active { color: var(--blue); background: var(--blue-soft); }.progress-steps li.done { color: var(--green); }.step-mark { display: grid; place-items: center; width: 21px; height: 21px; flex: 0 0 auto; border: 1px solid currentColor; font: 10px var(--mono); }.progress-steps strong, .progress-steps small { display: block; }.progress-steps strong { font-size: 11px; }.progress-steps small { margin-top: 5px; color: var(--muted); font-size: 9px; line-height: 1.45; }.retry-button { grid-column: 2; display: inline-flex; align-items: center; gap: 7px; width: fit-content; }.retry-button svg { flex: 0 0 auto; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .draft-progress { margin: 30px auto; padding: 24px 18px; }.progress-steps { grid-template-columns: 1fr 1fr; }.progress-steps li { padding: 11px 9px; } }
@media (max-width: 460px) { .draft-progress { grid-template-columns: auto minmax(0, 1fr); }.progress-steps { grid-template-columns: 1fr; }.retry-button { grid-column: 1 / -1; } }
</style>
