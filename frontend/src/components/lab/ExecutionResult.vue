<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, Clock3, TerminalSquare } from 'lucide-vue-next'
import type { LabExecutionResponse, LabExecutionResult } from '@/types/lab'

const props = defineProps<{ result: LabExecutionResponse | null }>()

const executionResult = computed<LabExecutionResult | null>(() => {
  if (!props.result || 'kind' in props.result) return null
  return props.result
})
</script>

<template>
  <section class="execution-result" aria-labelledby="execution-result-title">
    <div class="section-heading">
      <div><div class="eyebrow">Evidence · Raw output</div><h2 id="execution-result-title">执行结果</h2></div>
      <span v-if="result" class="result-status" :class="result.status">{{ result.status }}</span>
    </div>
    <div v-if="!result" class="empty-result"><TerminalSquare :size="18" aria-hidden="true" /><p>启动实验后，执行结果会显示在这里。</p></div>
    <template v-else>
      <div v-if="executionResult" class="result-meta">
        <span><Clock3 :size="12" aria-hidden="true" />{{ executionResult.durationMs }} ms</span>
        <span>execution {{ executionResult.executionId.slice(0, 8) }}</span>
        <span>revision {{ executionResult.revision }}</span>
      </div>
      <div v-if="result.error" class="result-error" role="alert"><AlertTriangle :size="14" aria-hidden="true" /><div><strong>{{ result.error.code }}</strong><p>{{ result.error.message }}</p></div></div>
      <template v-if="executionResult?.result">
        <div class="output-heading"><span>原始输出</span><small v-if="executionResult.result.truncated">结果已截断</small></div>
        <pre>{{ executionResult.result.rawOutput }}</pre>
        <div v-if="executionResult.result.kind === 'result_set' && executionResult.result.columns?.length" class="table-wrap">
          <table><thead><tr><th v-for="column in executionResult.result.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in executionResult.result.rows ?? []" :key="rowIndex"><td v-for="(value, columnIndex) in row" :key="columnIndex">{{ value === null ? 'NULL' : value }}</td></tr></tbody></table>
        </div>
        <div v-if="executionResult.result.kind === 'command'" class="command-summary"><CheckCircle2 :size="13" aria-hidden="true" />影响行数 {{ executionResult.result.affectedRows ?? 0 }}，警告 {{ executionResult.result.warningCount ?? 0 }}</div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.execution-result { min-width: 0; padding: 16px; border: 1px solid var(--line); background: var(--paper-deep); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 11px; border-bottom: 1px solid var(--line); }
.section-heading h2 { margin: 4px 0 0; color: var(--ink); font: 400 20px var(--serif); }
.result-status { padding: 4px 7px; border: 1px solid var(--line); color: var(--muted); font: 9px var(--mono); }
.result-status.succeeded { border-color: #a8c3ad; background: var(--green-soft); color: #3e7650; }
.result-status.failed, .result-status.timed_out { border-color: #dfb1a9; background: var(--red-soft); color: var(--red); }
.empty-result { display: flex; align-items: center; gap: 8px; min-height: 120px; color: var(--muted); font-size: 11px; }
.empty-result p { margin: 0; }
.result-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; color: var(--muted); font: 9px var(--mono); }
.result-meta span { display: inline-flex; align-items: center; gap: 4px; }
.result-error { display: flex; gap: 8px; margin-top: 12px; padding: 10px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); }
.result-error strong { font: 10px var(--mono); }
.result-error p { margin: 4px 0 0; color: #714841; font-size: 10px; line-height: 1.5; }
.output-heading { display: flex; justify-content: space-between; gap: 10px; margin-top: 14px; color: var(--ink); font-size: 10px; font-weight: 600; }
.output-heading small { color: var(--orange); font-weight: 400; }
pre { max-height: 300px; margin: 7px 0 0; overflow: auto; padding: 11px; border: 1px solid #3b444c; background: #20272e; color: #dbe2db; font: 11px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
.table-wrap { margin-top: 10px; overflow: auto; border: 1px solid var(--line); background: #fff; }
table { width: 100%; border-collapse: collapse; font-size: 10px; white-space: nowrap; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--line-soft); text-align: left; }
th { background: var(--paper-muted); color: var(--muted); font: 9px var(--mono); }
td { color: var(--ink); }
.command-summary { display: flex; align-items: center; gap: 5px; margin-top: 11px; color: #3e7650; font-size: 10px; }
</style>
