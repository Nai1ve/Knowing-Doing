<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { PlanningStage } from '@/types/product'
import { planningStepForStage, planningStepIndex, planningSteps } from '@/utils/planning-flow'

defineProps<{ stage: PlanningStage }>()
</script>

<template>
  <nav class="planning-progress" aria-label="规划进度">
    <ol>
      <li v-for="(step, index) in planningSteps" :key="step.key" :class="{ active: planningStepForStage(stage) === step.key, complete: index < planningStepIndex(stage) }">
        <span class="step-mark"><Check v-if="index < planningStepIndex(stage)" :size="12" aria-hidden="true" /><span v-else>{{ index + 1 }}</span></span>
        <span>{{ step.label }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.planning-progress { margin: 22px 0 28px; }.planning-progress ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 0; padding: 0; list-style: none; }.planning-progress li { position: relative; display: flex; align-items: center; gap: 7px; color: var(--muted); font: 9px var(--mono); }.planning-progress li::after { content: ''; position: absolute; top: 9px; left: 23px; right: 8px; height: 1px; background: var(--line); }.planning-progress li:last-child::after { display: none; }.step-mark { z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; border: 1px solid var(--line); border-radius: 50%; background: var(--paper); }.planning-progress li.active { color: var(--blue); }.planning-progress li.active .step-mark { border-color: var(--blue); background: var(--blue-soft); color: var(--blue); }.planning-progress li.complete { color: var(--green); }.planning-progress li.complete .step-mark { border-color: var(--green); background: var(--green-soft); color: var(--green); }.planning-progress li.complete::after { background: var(--green); }
@media (max-width: 560px) { .planning-progress li { display: grid; justify-items: start; gap: 4px; font-size: 8px; }.planning-progress li::after { top: 9px; left: 20px; }.step-mark { width: 18px; height: 18px; } }
</style>
