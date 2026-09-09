<script setup lang="ts">
import { CheckCircle2, Circle, Play } from 'lucide-vue-next'
import type { ProductCaseSpec, ProductWorkspaceExecution } from '@/types/product'

defineProps<{ spec: ProductCaseSpec; executions: ProductWorkspaceExecution[]; disabled?: boolean }>()
const emit = defineEmits<{ execute: [command: string] }>()
</script>

<template>
  <aside class="task-rail" aria-labelledby="task-rail-title">
    <div class="rail-heading"><div><span class="eyebrow">Practice path</span><h2 id="task-rail-title">按顺序完成</h2></div><span>{{ spec.tasks.length }} 个任务</span></div>
    <article v-for="(task, index) in spec.tasks" :key="task.key" class="rail-task"><div class="rail-task-head"><span class="task-index">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ task.key }}</strong><CheckCircle2 v-if="executions.some((item) => item.status === 'succeeded') && index === spec.tasks.length - 1" :size="14" class="done" aria-label="已有成功执行" /><Circle v-else :size="14" class="pending" aria-hidden="true" /></div><p>{{ task.instruction }}</p><small>观察：{{ task.expectedObservation }}</small><button v-for="command in task.recommendedCommands" :key="command" type="button" :disabled="disabled" @click="emit('execute', command)"><Play :size="11" aria-hidden="true" />{{ command }}</button></article>
  </aside>
</template>

<style scoped>
.task-rail { display: grid; gap: 11px; padding: 15px; border: 1px solid var(--line); background: var(--paper-deep); }.rail-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.rail-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 21px var(--serif); }.rail-heading > span { color: var(--muted); font: 9px var(--mono); }.rail-task { display: grid; gap: 7px; padding: 11px; border-left: 2px solid var(--line); background: var(--paper); }.rail-task:first-of-type { border-left-color: var(--orange); }.rail-task-head { display: flex; align-items: center; gap: 7px; }.task-index { color: var(--orange); font: 9px var(--mono); }.rail-task strong { color: var(--ink); font: 11px var(--mono); }.done { margin-left: auto; color: var(--green); }.pending { margin-left: auto; color: var(--line); }.rail-task p { margin: 0; color: #58645e; font-size: 10px; line-height: 1.55; }.rail-task small { color: var(--muted); font-size: 9px; line-height: 1.45; }.rail-task button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 26px; border: 1px solid var(--line); background: var(--paper-muted); color: var(--blue); font: 9px var(--mono); cursor: pointer; }.rail-task button:disabled { cursor: wait; opacity: .55; }
</style>
