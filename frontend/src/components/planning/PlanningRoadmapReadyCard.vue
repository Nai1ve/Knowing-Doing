<script setup lang="ts">
import { ArrowRight, Pencil } from 'lucide-vue-next'
import type { PlanningRequirementBrief } from '@/types/product'

defineProps<{ brief: PlanningRequirementBrief; generating?: boolean }>()
const emit = defineEmits<{ generate: []; revise: [] }>()
</script>

<template>
  <section class="roadmap-ready-card" aria-labelledby="roadmap-ready-title">
    <header><div><div class="eyebrow">Route ready</div><h2 id="roadmap-ready-title">你的学习要求已经确认</h2></div><span>已锁定</span></header>
    <p>这些要求将决定路线的起点、节奏与实践形式。生成前仍可返回修改，修改后需要重新确认。</p>
    <dl><div><dt>目标结果</dt><dd>{{ brief.content.targetOutcome || brief.content.goal }}</dd></div><div><dt>期限</dt><dd>{{ brief.content.deadline || '尚未设定' }}</dd></div><div><dt>每周投入</dt><dd>{{ brief.content.weeklyCommitment || '尚未设定' }}</dd></div><div><dt>期望产出</dt><dd>{{ brief.content.preferredDeliverable || '尚未设定' }}</dd></div><div><dt>优先方向</dt><dd>{{ brief.content.priorities.length ? brief.content.priorities.join('、') : '尚未设定' }}</dd></div><div><dt>现实约束</dt><dd>{{ brief.content.constraints.length ? brief.content.constraints.join('、') : '尚未设定' }}</dd></div></dl>
    <div class="actions"><button type="button" class="text-button" :disabled="generating" @click="emit('revise')"><Pencil :size="14" aria-hidden="true" />返回修改需求</button><button type="button" class="primary-button" :disabled="generating" @click="emit('generate')">{{ generating ? '正在开始生成…' : '开始生成我的路线' }}<ArrowRight :size="14" aria-hidden="true" /></button></div>
  </section>
</template>

<style scoped>
.roadmap-ready-card { padding: 19px 0 2px; border-top: 2px solid var(--green); }.roadmap-ready-card header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.roadmap-ready-card h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.roadmap-ready-card header span { padding: 4px 7px; background: var(--green-soft); color: var(--green); font: 8px var(--mono); }.roadmap-ready-card > p { max-width: 620px; margin: 13px 0 18px; color: var(--muted); font-size: 11px; line-height: 1.6; }.roadmap-ready-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin: 0; }.roadmap-ready-card dl div { padding: 10px 11px; border: 1px solid var(--line-soft); background: var(--paper-deep); }.roadmap-ready-card dt { color: var(--muted); font: 8px var(--mono); }.roadmap-ready-card dd { margin: 5px 0 0; color: var(--ink); font-size: 11px; line-height: 1.45; }.actions { margin-top: 18px; padding-top: 13px; border-top: 1px solid var(--line); }.actions button { min-height: 34px; }
@media (max-width: 620px) { .roadmap-ready-card dl { grid-template-columns: 1fr; }.actions { align-items: stretch; flex-direction: column; }.actions button { justify-content: center; } }
</style>
