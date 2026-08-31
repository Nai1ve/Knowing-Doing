<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, Clock3, FileCode2, Play, RotateCcw, TerminalSquare } from 'lucide-vue-next'
import type { LabExecutionResponse, LabExecutionResult } from '@/types/lab'

const props = defineProps<{
  sql: string
  result: LabExecutionResponse | null
  canExecute: boolean
  executing: boolean
  sessionName?: string
}>()

const emit = defineEmits<{
  'update:sql': [value: string]
  execute: []
  'load-default': []
  'load-create-index': []
  'load-optimized': []
}>()

const executionResult = computed<LabExecutionResult | null>(() => {
  if (!props.result || 'kind' in props.result) return null
  return props.result
})
</script>

<template>
  <section class="terminal-workbench" aria-labelledby="sql-workbench-title">
    <header class="terminal-topbar">
      <div class="terminal-title">
        <span class="terminal-lights" aria-hidden="true"><i /><i /><i /></span>
        <div><div class="terminal-label">SQL Terminal · {{ sessionName ?? 'default' }}</div><h2 id="sql-workbench-title">执行一条实验语句</h2></div>
      </div>
      <span v-if="result" class="result-status" :class="result.status">{{ result.status }}</span>
    </header>

    <div class="terminal-toolbar" aria-label="SQL 示例">
      <span class="terminal-context">mysql://lab/orders</span>
      <div class="reference-actions">
        <button type="button" class="reference-button" @click="emit('load-default')"><FileCode2 :size="12" aria-hidden="true" />加载 EXPLAIN 示例</button>
        <button type="button" class="reference-button" @click="emit('load-create-index')"><FileCode2 :size="12" aria-hidden="true" />加载建索引 SQL</button>
        <button type="button" class="reference-button" @click="emit('load-optimized')"><RotateCcw :size="12" aria-hidden="true" />加载优化 SQL</button>
      </div>
    </div>

    <div class="terminal-input">
      <div class="terminal-prompt" aria-hidden="true">zhixing@mysql:orders $</div>
      <label class="sr-only" for="lab-sql-input">输入 SQL</label>
      <textarea id="lab-sql-input" :value="sql" spellcheck="false" rows="10" @input="emit('update:sql', ($event.target as HTMLTextAreaElement).value)" />
      <div class="terminal-footer">
        <span>单条 SQL · 输出限制 200 行 / 1 MiB</span>
        <button class="primary-button" type="button" :disabled="!canExecute || executing" @click="emit('execute')"><Play :size="13" aria-hidden="true" />{{ executing ? '执行中…' : '执行 SQL' }}</button>
      </div>
    </div>

    <div class="terminal-output" aria-live="polite">
      <div class="output-heading"><span><TerminalSquare :size="13" aria-hidden="true" />执行输出</span><small v-if="executionResult?.result?.truncated">结果已截断</small></div>
      <div v-if="!result" class="empty-result"><p>执行结果会显示在这里。</p></div>
      <template v-else>
        <div v-if="executionResult" class="result-meta">
          <span><Clock3 :size="12" aria-hidden="true" />{{ executionResult.durationMs }} ms</span>
          <span>execution {{ executionResult.executionId.slice(0, 8) }}</span>
          <span>revision {{ executionResult.revision }}</span>
        </div>
        <div v-if="result.error" class="result-error" role="alert"><AlertTriangle :size="14" aria-hidden="true" /><div><strong>{{ result.error.code }}</strong><p>{{ result.error.message }}</p></div></div>
        <template v-if="executionResult?.result">
          <pre>{{ executionResult.result.rawOutput }}</pre>
          <div v-if="executionResult.result.kind === 'result_set' && executionResult.result.columns?.length" class="table-wrap">
            <table><thead><tr><th v-for="column in executionResult.result.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in executionResult.result.rows ?? []" :key="rowIndex"><td v-for="(value, columnIndex) in row" :key="columnIndex">{{ value === null ? 'NULL' : value }}</td></tr></tbody></table>
          </div>
          <div v-if="executionResult.result.kind === 'command'" class="command-summary"><CheckCircle2 :size="13" aria-hidden="true" />影响行数 {{ executionResult.result.affectedRows ?? 0 }}，警告 {{ executionResult.result.warningCount ?? 0 }}</div>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
.terminal-workbench { min-width: 0; overflow: hidden; border: 1px solid #313a42; background: #20272e; color: #dce3dc; }
.terminal-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 13px; border-bottom: 1px solid #3b464e; background: #293139; }
.terminal-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.terminal-lights { display: inline-flex; gap: 4px; flex: 0 0 auto; }
.terminal-lights i { width: 7px; height: 7px; border-radius: 50%; background: #c17c68; }
.terminal-lights i:nth-child(2) { background: #c2a466; }
.terminal-lights i:nth-child(3) { background: #7eae88; }
.terminal-label { overflow: hidden; color: #9ca8aa; font: 9px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.terminal-topbar h2 { margin: 3px 0 0; color: #f0f2ec; font: 400 18px var(--serif); }
.result-status { flex: 0 0 auto; padding: 4px 7px; border: 1px solid #5a6870; color: #b3c0c0; font: 9px var(--mono); }
.result-status.succeeded { border-color: #6a9576; background: #30483a; color: #a8d0ad; }
.result-status.failed, .result-status.rejected, .result-status.timed_out { border-color: #a36b62; background: #4a302d; color: #e7b4ab; }
.terminal-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 13px; border-bottom: 1px solid #3b464e; background: #242c33; }
.terminal-context { color: #90a098; font: 9px var(--mono); }
.reference-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.reference-button { display: inline-flex; align-items: center; gap: 5px; min-height: 27px; padding: 5px 8px; border: 1px solid #536477; background: #303b45; color: #c9d4d0; font-size: 10px; }
.reference-button:hover { border-color: #8798a3; background: #394752; }
.terminal-input { padding: 13px; border-bottom: 1px solid #3b464e; }
.terminal-prompt { color: #9bc39e; font: 10px var(--mono); }
textarea { display: block; width: 100%; margin-top: 7px; resize: vertical; padding: 0; border: 0; outline: 0; background: transparent; color: #e1e7e1; font: 12px/1.7 var(--mono); tab-size: 2; }
textarea:focus { box-shadow: inset 0 -1px 0 #7896a3; }
.terminal-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 9px; color: #94a09e; font-size: 9px; }
.terminal-footer button { display: inline-flex; align-items: center; gap: 5px; }
.terminal-output { min-width: 0; padding: 13px; background: #182026; }
.output-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #b9c7c0; font: 10px var(--mono); }
.output-heading span { display: inline-flex; align-items: center; gap: 5px; }
.output-heading small { color: #d3ac6b; font-size: 9px; }
.empty-result { min-height: 74px; display: flex; align-items: center; color: #718087; font-size: 10px; }
.empty-result p { margin: 0; }
.result-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; color: #89999b; font: 9px var(--mono); }
.result-meta span { display: inline-flex; align-items: center; gap: 4px; }
.result-error { display: flex; gap: 8px; margin-top: 10px; padding: 9px; border-left: 2px solid #c4776e; background: #3d2a28; color: #e7b4ab; }
.result-error strong { font: 10px var(--mono); }
.result-error p { margin: 4px 0 0; color: #d8aaa2; font-size: 10px; line-height: 1.5; }
pre { max-height: 300px; margin: 10px 0 0; overflow: auto; padding: 10px; border: 1px solid #354149; background: #11181d; color: #d8e2da; font: 11px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
.table-wrap { margin-top: 10px; overflow: auto; border: 1px solid #354149; background: #202a30; }
table { width: 100%; border-collapse: collapse; font-size: 10px; white-space: nowrap; }
th, td { padding: 7px 8px; border-bottom: 1px solid #354149; text-align: left; }
th { background: #2b363d; color: #9caeaa; font: 9px var(--mono); }
td { color: #d1dad3; }
.command-summary { display: flex; align-items: center; gap: 5px; margin-top: 10px; color: #a8d0ad; font-size: 10px; }
@media (max-width: 600px) { .terminal-toolbar { display: block; } .reference-actions { margin-top: 8px; } .terminal-footer { align-items: flex-end; } }
</style>
