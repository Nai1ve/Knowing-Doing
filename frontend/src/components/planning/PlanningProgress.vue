<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { PlanningProgress as ServerProgress, PlanningStage } from '@/types/product'
import { baselineProgress, baselineTurnMaximum, baselineTurnMinimum, planningStageLabel, planningStepForStage, planningStepIndex, planningSteps } from '@/utils/planning-flow'

const props = defineProps<{ stage: PlanningStage; progress?: ServerProgress | null }>()
const visibleProgress = () => props.stage === 'baseline' ? baselineProgress(props.progress) : props.progress
</script>

<template>
  <nav class="planning-progress" aria-label="规划进度">
    <ol>
      <li v-for="(step, index) in planningSteps" :key="step.key" :class="{ active: planningStepForStage(props.stage) === step.key, complete: index < planningStepIndex(props.stage) }">
        <span class="step-mark"><Check v-if="index < planningStepIndex(props.stage)" :size="12" aria-hidden="true" /><span v-else>{{ index + 1 }}</span></span>
        <span>{{ step.label }}</span>
      </li>
    </ol>
    <div v-if="visibleProgress()" class="planning-progress-detail" aria-live="polite">
      <span>{{ planningStageLabel(props.stage) }}</span>
      <strong v-if="props.stage === 'baseline'">第 {{ visibleProgress()?.current }} / {{ visibleProgress()?.total }} 轮</strong>
      <strong v-else>{{ visibleProgress()?.completed }} / {{ visibleProgress()?.total }}</strong>
      <small v-if="props.stage === 'baseline'">至少 {{ baselineTurnMinimum }} 轮，最多 {{ Math.max(visibleProgress()?.total ?? baselineTurnMaximum, baselineTurnMaximum) }} 轮；有足够证据时会提前结束</small>
      <small v-else>{{ visibleProgress()?.label ?? '服务端已保存当前进度' }}</small>
    </div>
  </nav>
</template>

<style scoped>
.planning-progress { margin: 22px 0 28px; }.planning-progress ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 0; padding: 0; list-style: none; }.planning-progress li { position: relative; display: flex; align-items: center; gap: 7px; color: var(--muted); font: 9px var(--mono); }.planning-progress li::after { content: ''; position: absolute; top: 9px; left: 23px; right: 8px; height: 1px; background: var(--line); }.planning-progress li:last-child::after { display: none; }.step-mark { z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; border: 1px solid var(--line); border-radius: 50%; background: var(--paper); }.planning-progress li.active { color: var(--blue); }.planning-progress li.active .step-mark { border-color: var(--blue); background: var(--blue-soft); color: var(--blue); }.planning-progress li.complete { color: var(--green); }.planning-progress li.complete .step-mark { border-color: var(--green); background: var(--green-soft); color: var(--green); }.planning-progress li.complete::after { background: var(--green); }
.planning-progress-detail { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 12px; margin-top: 11px; padding: 9px 11px; border-left: 2px solid var(--orange); background: var(--paper-muted); color: var(--muted); font: 9px var(--mono); }.planning-progress-detail span { color: var(--blue); }.planning-progress-detail strong { color: var(--ink); font-weight: 500; }.planning-progress-detail small { flex-basis: 100%; color: var(--muted); line-height: 1.5; }
@media (max-width: 560px) { .planning-progress li { display: grid; justify-items: start; gap: 4px; font-size: 8px; }.planning-progress li::after { top: 9px; left: 20px; }.step-mark { width: 18px; height: 18px; } }
</style>
