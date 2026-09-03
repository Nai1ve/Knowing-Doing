<script setup lang="ts">
import { Check, CircleDashed, LockKeyhole } from 'lucide-vue-next'
import type { ProductPlanProposalUnit } from '@/types/product'
defineProps<{ units: ProductPlanProposalUnit[] }>()
</script>

<template>
  <ol class="unit-list"><li v-for="unit in units" :key="unit.position" :class="unit.status"><span class="unit-index"><Check v-if="unit.status === 'completed'" :size="13" aria-hidden="true" /><CircleDashed v-else-if="unit.availability === 'available'" :size="13" aria-hidden="true" /><LockKeyhole v-else :size="12" aria-hidden="true" /></span><div class="unit-copy"><div class="unit-meta"><span>0{{ unit.position }}</span><span>{{ unit.estimatedMinutes }} 分钟</span><span>{{ unit.availability === 'available' ? '可进入实践' : '即将开放' }}</span></div><h3>{{ unit.title }}</h3><p>{{ unit.objective }}</p><small>{{ unit.rationale }}</small></div></li></ol>
</template>

<style scoped>
.unit-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }.unit-list li { display: grid; grid-template-columns: 28px 1fr; gap: 10px; padding: 15px 0; border-bottom: 1px solid var(--line-soft); }.unit-index { display: grid; place-items: center; width: 25px; height: 25px; border: 1px solid var(--line); color: var(--muted); }.current .unit-index { border-color: var(--orange); color: var(--orange); background: var(--orange-soft); }.completed .unit-index { border-color: var(--green); color: var(--green); background: var(--green-soft); }.unit-meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); font: 9px var(--mono); }.unit-copy h3 { margin: 6px 0 0; color: #3b4643; font: 400 18px var(--serif); }.unit-copy p { max-width: 630px; margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }.unit-copy small { display: block; margin-top: 7px; color: #8a918d; font-size: 9px; line-height: 1.5; }
</style>
