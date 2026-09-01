<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next'
import { RouterLink, useRoute } from 'vue-router'

interface StageItem { name: string; label: string; detail: string }

const props = defineProps<{ stages: StageItem[]; activeName: string }>()
const route = useRoute()

function isPassed(index: number): boolean {
  return index < props.stages.findIndex((stage) => stage.name === props.activeName)
}
</script>

<template>
  <nav class="stage-nav" aria-label="写作阶段">
    <RouterLink v-for="(stage, index) in stages" :key="stage.name" :to="{ name: stage.name, query: route.query }" class="stage-link" :class="{ active: activeName === stage.name, passed: isPassed(index) }" :aria-current="activeName === stage.name ? 'step' : undefined" :title="stage.detail">
      <span class="stage-marker"><CheckCircle2 v-if="isPassed(index)" :size="13" aria-hidden="true" /><span v-else>{{ String(index + 1).padStart(2, '0') }}</span></span>
      <span class="stage-copy"><strong>{{ stage.label }}</strong><small>{{ activeName === stage.name ? '当前' : isPassed(index) ? '已完成' : '待处理' }}</small></span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.stage-nav { display: flex; align-items: stretch; overflow-x: auto; border-bottom: 1px solid var(--line); background: var(--paper-muted); }
.stage-link { display: flex; align-items: center; gap: 8px; min-width: 132px; padding: 9px 14px; border-inline-end: 1px solid var(--line); color: var(--muted); text-decoration: none; }.stage-link:hover, .stage-link.active { background: #fff; color: var(--blue); }.stage-link.passed { color: var(--green); }.stage-marker { display: grid; place-items: center; width: 21px; height: 21px; border: 1px solid currentColor; flex: 0 0 auto; font: 8px var(--mono); }.stage-copy { display: grid; gap: 3px; }.stage-copy strong { font-size: 11px; font-weight: 600; }.stage-copy small { color: var(--muted); font: 8px var(--mono); }
@media (min-width: 761px) { .stage-link { flex: 1 1 0; min-width: 0; justify-content: center; } }
@media (max-width: 460px) { .stage-link { min-width: 112px; padding-inline: 10px; } }
</style>
