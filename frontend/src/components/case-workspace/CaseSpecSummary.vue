<script setup lang="ts">
import { ArrowRight, CheckCircle2, RotateCcw } from 'lucide-vue-next'
import type { ProductLearningCase } from '@/types/product'

defineProps<{ learningCase: ProductLearningCase; starting?: boolean }>()
const emit = defineEmits<{ start: []; retry: [] }>()
</script>

<template>
  <section class="case-summary" aria-labelledby="case-summary-title">
    <div class="summary-header"><div><span class="eyebrow">Generated case · {{ learningCase.provider }}</span><h2 id="case-summary-title">{{ learningCase.spec?.title }}</h2></div><span class="ready-mark"><CheckCircle2 :size="14" aria-hidden="true" />已准备</span></div>
    <p class="scenario">{{ learningCase.spec?.scenario }}</p>
    <div class="summary-grid"><div><small>学习目标</small><p>{{ learningCase.spec?.learningGoal }}</p></div><div><small>环境</small><p><code>{{ learningCase.templateKey }}</code> · {{ learningCase.spec?.environment.services.length ? learningCase.spec.environment.services.join('、') : '无额外服务' }}</p></div></div>
    <div v-if="learningCase.spec" class="task-list"><div class="section-label">实践任务</div><article v-for="(task, index) in learningCase.spec.tasks" :key="task.key" class="task-item"><span class="task-number">{{ String(index + 1).padStart(2, '0') }}</span><div><strong>{{ task.instruction }}</strong><p>预期观察：{{ task.expectedObservation }}</p><small>{{ task.recommendedCommands.join(' · ') }}</small></div></article></div>
    <div v-if="learningCase.spec" class="starter-list"><div class="section-label">初始文件</div><span v-for="file in learningCase.spec.starterFiles" :key="file.path"><code>{{ file.path }}</code></span></div>
    <div class="summary-actions"><button class="secondary-button" type="button" @click="emit('retry')"><RotateCcw :size="13" aria-hidden="true" />重新生成</button><button class="primary-button" type="button" :disabled="starting" @click="emit('start')"><ArrowRight :size="13" aria-hidden="true" />{{ starting ? '启动工作区…' : '进入 Python 工作区' }}</button></div>
  </section>
</template>

<style scoped>
.case-summary { display: grid; gap: 16px; padding: 18px; border-top: 2px solid var(--green); background: var(--paper-deep); }.summary-header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }.summary-header h2 { margin: 7px 0 0; color: var(--ink); font: 400 26px/1.2 var(--serif); }.ready-mark { display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px; border: 1px solid #a8c3ad; background: var(--green-soft); color: #3e7650; font: 9px var(--mono); white-space: nowrap; }.scenario { max-width: 820px; margin: 0; color: #5f6a64; font-size: 12px; line-height: 1.7; }.summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, .6fr); gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }.summary-grid small, .section-label { color: #7c8580; font: 9px var(--mono); }.summary-grid p { margin: 6px 0 0; color: #56615b; font-size: 11px; line-height: 1.55; }.task-list, .starter-list { display: grid; gap: 8px; }.section-label { margin-bottom: 1px; }.task-item { display: grid; grid-template-columns: 27px minmax(0, 1fr); gap: 10px; padding: 10px; border: 1px solid var(--line-soft); background: var(--paper); }.task-number { color: var(--orange); font: 10px var(--mono); }.task-item strong { color: var(--ink); font-size: 11px; font-weight: 500; }.task-item p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.task-item small { display: block; margin-top: 6px; color: var(--blue); font: 9px var(--mono); }.starter-list { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }.starter-list .section-label { flex-basis: 100%; }.starter-list span { padding: 5px 7px; border: 1px solid var(--line); background: var(--paper); }.summary-actions { display: flex; justify-content: space-between; gap: 10px; padding-top: 2px; }.summary-actions button { display: inline-flex; align-items: center; gap: 6px; }.summary-actions button:disabled { opacity: .55; cursor: wait; }
@media (max-width: 680px) { .summary-header { align-items: stretch; flex-direction: column; }.summary-grid { grid-template-columns: 1fr; }.summary-actions { align-items: stretch; flex-direction: column; }.summary-actions button { justify-content: center; } }
</style>
