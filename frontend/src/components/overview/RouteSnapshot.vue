<script setup lang="ts">
import { ArrowUpRight, Check, Circle } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import type { Milestone } from '@/types/domain'

defineProps<{ milestones: Milestone[] }>()
</script>

<template>
  <section id="overview-route" class="route-snapshot" aria-labelledby="route-snapshot-title">
    <div class="snapshot-heading"><div><div class="eyebrow">The whole route</div><h2 id="route-snapshot-title">整体学习路线</h2></div><RouterLink :to="{ name: 'route' }">查看完整知识树 <ArrowUpRight :size="13" aria-hidden="true" /></RouterLink></div>
    <div class="route-line" aria-label="学习里程碑">
      <article v-for="milestone in milestones" :key="milestone.id" class="route-stop" :class="milestone.status">
        <div class="stop-mark"><Check v-if="milestone.status === 'completed'" :size="12" aria-hidden="true" /><Circle v-else :size="11" aria-hidden="true" /></div>
        <div class="stop-copy"><small>{{ milestone.index }} · {{ milestone.progress }}</small><h3>{{ milestone.title }}</h3><p>{{ milestone.summary }}</p></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.route-snapshot { margin-top: 27px; }
.snapshot-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.snapshot-heading h2 { margin: 7px 0 0; color: #303738; font: 400 22px var(--serif); }
.snapshot-heading a { display: inline-flex; align-items: center; gap: 5px; color: var(--blue); font-size: 10px; text-decoration: none; }
.route-line { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; padding-top: 18px; }
.route-stop { position: relative; min-height: 110px; padding: 0 13px 0 20px; border-left: 1px solid var(--line); }
.route-stop:first-child { border-left: 0; padding-inline-start: 0; }
.route-stop::before { position: absolute; top: 5px; right: 0; left: 18px; height: 1px; background: var(--line); content: ""; }
.route-stop:first-child::before { left: 0; }
.stop-mark { position: relative; z-index: 1; display: grid; place-items: center; width: 11px; height: 11px; color: #aab0aa; background: var(--paper); }
.route-stop.completed .stop-mark { color: var(--green); }
.route-stop.current .stop-mark { color: var(--orange); }
.stop-copy { margin-top: 14px; }
.stop-copy small { color: #7c66a5; font: 9px var(--mono); }
.stop-copy h3 { margin: 6px 0 0; color: #3f4946; font-size: 12px; font-weight: 500; }
.stop-copy p { margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 780px) { .route-line { grid-template-columns: 1fr 1fr; row-gap: 20px; } .route-stop:nth-child(3) { border-left: 0; padding-inline-start: 0; } .route-stop:nth-child(3)::before { left: 0; } }
@media (max-width: 500px) { .snapshot-heading { align-items: start; flex-direction: column; } .route-line { grid-template-columns: 1fr; } .route-stop, .route-stop:nth-child(3) { min-height: auto; padding: 0 0 16px 20px; border-left: 1px solid var(--line); } .route-stop:first-child { padding-inline-start: 20px; border-left: 1px solid var(--line); } .route-stop::before, .route-stop:first-child::before, .route-stop:nth-child(3)::before { top: 5px; left: 0; } }
</style>
