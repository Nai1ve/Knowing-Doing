<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle, ChevronDown, CircleCheck, Database, RotateCcw, ShieldCheck, Square } from 'lucide-vue-next'
import SqlWorkbench from '@/components/lab/SqlWorkbench.vue'
import PinnedReferences from './PinnedReferences.vue'
import PracticeCompletionPanel from './PracticeCompletionPanel.vue'
import TutorAgent from './TutorAgent.vue'
import type { LabExecutionResponse, LabRun } from '@/types/lab'
import type { ProductPracticeCompletion, ProductPracticePin, ProductPracticeRun, ProductSnapshot, ProductTutorMessage, ProductTutorSource } from '@/types/product'

const props = defineProps<{
  practice: ProductPracticeRun
  snapshot: ProductSnapshot | null
  completion?: ProductPracticeCompletion | null
  labRun: LabRun | null
  labError?: string | null
  practiceError?: string | null
  labSql: string
  latestResult: LabExecutionResponse | null
  activeSessionName?: string
  labReady: boolean
  labExecuting: boolean
  practiceStarting: boolean
  labResetting: boolean
  labEnding: boolean
  practiceVerifying: boolean
  messages: ProductTutorMessage[]
  sources: ProductTutorSource[]
  sourceStatus?: string
  tutorLoading: boolean
  tutorQuestion?: string
  currentGap?: string
  tutorFailure?: { invocationId: string; code: string; message: string; retryable: boolean } | null
}>()
const emit = defineEmits<{
  'update:sql': [value: string]
  execute: []
  'load-default': []
  'load-create-index': []
  'load-optimized': []
  reset: []
  end: []
  reopen: []
  ask: [message: string]
  retry: []
  pin: [targetType: ProductPracticePin['targetType'], targetId: string]
  unpin: [pinId: string]
  verify: []
}>()
const stageLabel = computed(() => ({ observe: '观察', hypothesize: '假设', inspect: '检查', attempt: '尝试', verify: '验证', resolved: '已解决' } as Record<string, string>)[props.practice.stage] ?? props.practice.stage)
const runStatus = computed(() => props.labRun ? '实验环境已连接' : '需要续开实验环境')
const leaseLabel = computed(() => props.labRun ? new Date(props.labRun.idleExpiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—')
const pinnedIds = computed(() => (props.snapshot?.pins ?? []).map((pin) => pin.targetId))
const contextOpen = computed(() => !props.messages.length)
const resultArtifact = computed(() => {
  const result = props.latestResult
  if (!result || !('executionId' in result) || !props.snapshot) return undefined
  const artifacts = props.snapshot.artifacts.filter((artifact) => artifact.metadata.executionId === result.executionId && ['sql', 'explain', 'benchmark', 'result_set', 'error'].includes(artifact.kind))
  return artifacts.find((artifact) => artifact.kind !== 'sql') ?? artifacts.find((artifact) => artifact.kind === 'sql')
})
const resultPinned = computed(() => Boolean(resultArtifact.value && pinnedIds.value.includes(resultArtifact.value.id)))
function forwardPin(targetType: ProductPracticePin['targetType'], targetId: string) {
  emit('pin', targetType, targetId)
}
function pinResult() {
  if (resultArtifact.value) emit('pin', 'artifact', resultArtifact.value.id)
}
</script>

<template>
  <div class="workspace">
    <header class="workspace-bar">
      <div class="workspace-heading"><span class="workspace-icon"><Database :size="15" aria-hidden="true" /></span><div><div class="eyebrow">Practice workspace · {{ practice.caseId }}</div><h1>MySQL 慢查询与联合索引</h1></div></div>
      <div class="workspace-metrics"><span class="metric-stage"><strong>{{ stageLabel }}</strong><small>阶段</small></span><span><strong>r{{ labRun?.revision ?? '—' }}</strong><small>revision</small></span><span><strong>{{ leaseLabel }}</strong><small>空闲回收</small></span><span class="lab-state" :class="{ ready: labRun }"><CircleCheck :size="12" aria-hidden="true" />{{ runStatus }}</span></div>
      <div class="workspace-actions"><button v-if="!labRun && practice.status !== 'resolved'" type="button" class="secondary-button" :disabled="practiceStarting" @click="emit('reopen')"><RotateCcw :size="12" aria-hidden="true" />{{ practiceStarting ? '续开中…' : '继续实践' }}</button><button v-else-if="labRun" type="button" class="secondary-button" :disabled="labResetting || labEnding" @click="emit('reset')"><RotateCcw :size="12" aria-hidden="true" />{{ labResetting ? '重置中…' : '重置' }}</button><button v-if="labRun" type="button" class="danger-button" :disabled="labResetting || labEnding" @click="emit('end')"><Square :size="11" aria-hidden="true" />{{ labEnding ? '结束中…' : '结束环境' }}</button></div>
    </header>
    <div class="workspace-columns">
      <section class="workbench-column" aria-label="实验工作台">
        <section class="task-context"><details :open="contextOpen"><summary><span><ShieldCheck :size="14" aria-hidden="true" />任务上下文</span><ChevronDown :size="14" aria-hidden="true" /></summary><div class="context-content"><div><strong>先回答一个问题</strong><p>这条慢查询为什么会让 p99 升高？先从脱敏慢日志和表结构中定位 SQL，再用 EXPLAIN 验证你的假设。</p></div><dl><div><dt>表</dt><dd><code>orders</code></dd></div><div><dt>基线索引</dt><dd><code>idx_orders_user_id</code></dd></div><div><dt>可用会话</dt><dd><code>default</code></dd></div></dl></div></details></section>
        <SqlWorkbench :sql="labSql" :result="latestResult" :can-execute="Boolean(labRun && labReady && activeSessionName && practice.status !== 'resolved')" :executing="labExecuting" :session-name="activeSessionName" :result-artifact-id="resultArtifact?.id" :result-pinned="resultPinned" @update:sql="emit('update:sql', $event)" @execute="emit('execute')" @load-default="emit('load-default')" @load-create-index="emit('load-create-index')" @load-optimized="emit('load-optimized')" @pin="pinResult" />
        <section v-if="labError || practiceError" class="workspace-error" role="alert"><AlertCircle :size="14" aria-hidden="true" /><div><strong>当前状态</strong><p>{{ labError || practiceError }}</p></div></section>
        <PracticeCompletionPanel v-if="completion" :completion="completion" :verifying="practiceVerifying" @verify="emit('verify')" />
        <PinnedReferences :items="snapshot?.pins ?? []" @remove="emit('unpin', $event)" />
      </section>
      <aside class="tutor-column"><TutorAgent :messages="messages" :sources="sources" :source-status="sourceStatus" :loading="tutorLoading" :current-question="tutorQuestion" :current-gap="currentGap" :failure="tutorFailure" :pinned-ids="pinnedIds" :disabled="practice.status === 'resolved'" @ask="emit('ask', $event)" @retry="emit('retry')" @pin="forwardPin" /></aside>
    </div>
  </div>
</template>

<style scoped>
.workspace { max-width: 1370px; margin: -4px auto 0; }.workspace-bar { display: grid; grid-template-columns: minmax(250px, 1fr) auto auto; align-items: center; gap: 16px; padding: 11px 0 13px; border-bottom: 2px solid var(--blue); }.workspace-heading { display: flex; align-items: center; gap: 9px; min-width: 0; }.workspace-icon { display: grid; place-items: center; width: 29px; height: 29px; border: 1px solid #b8c1ec; background: var(--blue-soft); color: var(--blue); }.workspace-heading h1 { overflow: hidden; margin: 5px 0 0; color: #2e48cc; font: 400 21px var(--serif); text-overflow: ellipsis; white-space: nowrap; }.workspace-metrics { display: flex; align-items: center; gap: 15px; }.workspace-metrics > span:not(.lab-state) { display: grid; gap: 3px; }.workspace-metrics strong { color: #4b5651; font: 10px var(--mono); }.workspace-metrics small { color: var(--muted); font-size: 8px; }.metric-stage strong { color: var(--blue); }.lab-state { display: inline-flex; align-items: center; gap: 4px; color: var(--orange); font: 9px var(--mono); white-space: nowrap; }.lab-state.ready { color: var(--green); }.workspace-actions { display: flex; gap: 6px; }.workspace-actions button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }.danger-button { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 7px 10px; border: 1px solid #d5aaa3; background: transparent; color: var(--red); font-size: 10px; }.danger-button:hover { background: var(--red-soft); }
.workspace-columns { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 18px; margin-top: 17px; align-items: start; }.workbench-column { display: grid; gap: 13px; min-width: 0; }.tutor-column { position: sticky; top: 14px; height: clamp(560px, calc(100dvh - 120px), 760px); min-width: 0; min-height: 0; }.task-context { border: 1px solid var(--line); background: var(--paper-deep); }.task-context details { margin: 0; }.task-context summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 13px; cursor: pointer; color: #4c5651; font: 10px var(--mono); list-style: none; }.task-context summary::-webkit-details-marker { display: none; }.task-context summary > span { display: inline-flex; align-items: center; gap: 6px; }.task-context summary svg { color: var(--blue); }.task-context details[open] summary > svg { transform: rotate(180deg); }.context-content { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; padding: 0 13px 13px; border-top: 1px solid var(--line-soft); }.context-content strong { display: block; margin-top: 11px; color: var(--ink); font-size: 11px; }.context-content p { max-width: 580px; margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }.context-content dl { display: grid; gap: 6px; min-width: 195px; margin: 11px 0 0; }.context-content dl div { display: flex; justify-content: space-between; gap: 12px; }.context-content dt { color: var(--muted); font-size: 9px; }.context-content dd { margin: 0; color: var(--ink); font: 9px var(--mono); }code { font-family: var(--mono); font-size: 9px; }.workspace-error { display: flex; gap: 8px; padding: 11px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); }.workspace-error strong { font-size: 10px; }.workspace-error p { margin: 4px 0 0; color: #714841; font-size: 10px; line-height: 1.5; }
@media (max-width: 1279px) { .workspace-columns { grid-template-columns: 1fr; }.tutor-column { position: static; }.tutor-agent { min-height: 620px; }.workspace-bar { grid-template-columns: minmax(0, 1fr) auto; }.workspace-metrics { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; order: 3; }.workspace-actions { justify-self: end; } }
@media (max-width: 700px) { .workspace-bar { display: block; }.workspace-actions { margin-top: 11px; }.workspace-metrics { flex-wrap: wrap; margin-top: 12px; gap: 10px 13px; }.workspace-heading h1 { white-space: normal; }.context-content { grid-template-columns: 1fr; }.context-content dl { min-width: 0; }.workspace-columns { margin-top: 12px; } }
</style>
