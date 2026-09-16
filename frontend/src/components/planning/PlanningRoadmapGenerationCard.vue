<script setup lang="ts">
import { AlertTriangle, CircleCheck, LoaderCircle, RotateCcw } from 'lucide-vue-next'
import type { AgentRoadmapGeneration } from '@/types/product'

const props = defineProps<{ generation: AgentRoadmapGeneration | null; error?: string | null; retrying?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const labels: Record<AgentRoadmapGeneration['phase'], string> = { domain: '整理能力域', module: '组织能力模块', unit: '安排近期单元', critic: '校验路线结构', completed: '路线已生成', failed: '生成失败' }
const failed = () => props.generation?.status === 'failed' || props.generation?.status === 'interrupted'
</script>

<template>
  <section class="roadmap-generation-card" aria-live="polite" aria-labelledby="roadmap-generation-title">
    <template v-if="failed()"><AlertTriangle :size="18" aria-hidden="true" /><div><div class="eyebrow">Route generation</div><h2 id="roadmap-generation-title">路线暂时没有生成完成</h2><p>{{ generation?.failureMessage || error || '已确认的需求仍然保留，可以安全重试。' }}</p><button type="button" class="secondary-button" :disabled="retrying" @click="emit('retry')"><RotateCcw :size="14" aria-hidden="true" />{{ retrying ? '正在重试…' : '重试生成路线' }}</button></div></template>
    <template v-else><LoaderCircle class="spinner" :size="19" aria-hidden="true" /><div><div class="eyebrow">Route generation</div><h2 id="roadmap-generation-title">正在生成你的学习路线</h2><p>正在依据已确认的要求组织能力域、学习单元和实践安排。刷新页面后仍可恢复查看进度。</p><div class="phase"><span>{{ generation ? labels[generation.phase] : '正在创建生成任务' }}</span><strong v-if="generation">第 {{ generation.attemptCount || 1 }} 次</strong></div></div></template>
  </section>
</template>

<style scoped>
.roadmap-generation-card { display: flex; align-items: start; gap: 11px; padding: 20px 0; border-top: 2px solid var(--blue); }.roadmap-generation-card > svg { flex: 0 0 auto; margin-top: 2px; color: var(--blue); }.roadmap-generation-card h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.roadmap-generation-card p { max-width: 600px; margin: 10px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }.phase { display: flex; align-items: center; gap: 8px; margin-top: 16px; color: var(--blue); font: 9px var(--mono); }.phase strong { color: var(--muted); font-weight: 400; }.spinner { animation: spin .9s linear infinite; }.roadmap-generation-card .secondary-button { margin-top: 13px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
