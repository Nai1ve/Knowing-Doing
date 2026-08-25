<script setup lang="ts">
import { ArrowRight, CheckCircle2, CircleDot, Clock3 } from 'lucide-vue-next'
import type { LearningPlan, LearningNode, Milestone } from '@/types/domain'

defineProps<{
  plan: LearningPlan
  milestone?: Milestone
  node?: LearningNode
}>()
</script>

<template>
  <section class="progress-summary" aria-label="学习进度摘要">
    <div class="progress-main">
      <div class="summary-kicker">WEEK {{ String(plan.week).padStart(2, '0') }} / {{ String(plan.totalWeeks).padStart(2, '0') }}</div>
      <strong>{{ plan.progress }}<small>%</small></strong>
      <span>整体完成度</span>
      <div class="progress-track" aria-hidden="true"><span :style="{ width: `${plan.progress}%` }" /></div>
    </div>
    <dl class="progress-facts">
      <div><dt><CheckCircle2 :size="13" aria-hidden="true" />已完成</dt><dd>{{ plan.completedUnits }} / {{ plan.totalUnits }} 单元</dd></div>
      <div><dt><Clock3 :size="13" aria-hidden="true" />每周投入</dt><dd>{{ plan.weeklyMinutes }} 分钟</dd></div>
      <div><dt><CircleDot :size="13" aria-hidden="true" />当前节点</dt><dd>{{ node?.title ?? '尚未选择' }}</dd></div>
    </dl>
    <RouterLink class="summary-action" :to="{ name: 'lesson' }">继续当前学习 <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
  </section>
</template>

<style scoped>
.progress-summary { display: grid; grid-template-columns: minmax(180px, .95fr) minmax(220px, 1.35fr) auto; gap: 22px; align-items: end; margin-top: 22px; padding: 15px 16px; border-top: 2px solid var(--blue); background: var(--paper-deep); }
.summary-kicker { color: #6c65b7; font: 9px var(--mono); letter-spacing: .5px; }
.progress-main strong { display: block; margin-top: 6px; color: var(--blue); font: 400 34px/1 var(--serif); }
.progress-main strong small { font-size: 16px; }
.progress-main > span { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.progress-track { height: 4px; margin-top: 11px; background: #d7d9d3; }
.progress-track span { display: block; height: 100%; background: var(--blue); }
.progress-facts { display: grid; gap: 8px; margin: 0; }
.progress-facts div { display: grid; grid-template-columns: 100px 1fr; align-items: center; gap: 8px; padding-bottom: 7px; border-bottom: 1px solid var(--line-soft); }
.progress-facts dt { display: flex; align-items: center; gap: 5px; color: #77807b; font: 9px var(--mono); }
.progress-facts dd { margin: 0; color: #424d49; font-size: 11px; }
.summary-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; padding: 7px 10px; border: 1px solid var(--blue); background: var(--blue); color: #fff; font-size: 10px; text-decoration: none; white-space: nowrap; }
.summary-action:hover { background: var(--blue-deep); }
@media (max-width: 950px) { .progress-summary { grid-template-columns: 1fr 1fr; } .summary-action { grid-column: 1 / -1; justify-self: start; } }
@media (max-width: 620px) { .progress-summary { grid-template-columns: 1fr; gap: 15px; } .summary-action { grid-column: auto; width: 100%; } }
</style>
