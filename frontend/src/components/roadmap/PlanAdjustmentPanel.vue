<script setup lang="ts">
import { ref } from 'vue'
import { Check, GitPullRequest, Send } from 'lucide-vue-next'
import { useRoadmapStore } from '@/stores/roadmap'

const props = defineProps<{ selectedId: string; currentNodeId?: string | null }>()
const roadmap = useRoadmapStore()
const requestText = ref('')
const submitting = ref(false)
const selected = () => roadmap.nodeById[props.selectedId] ?? null
const isEligible = () => Boolean(roadmap.current?.currentPlan && selected() && selected()!.id !== props.currentNodeId && ['concept', 'lab', 'project'].includes(selected()!.nodeType))

async function submit() {
  if (!roadmap.current?.currentPlan || !requestText.value.trim() || !isEligible()) return
  submitting.value = true
  try { await roadmap.requestAdjustment(roadmap.current.currentPlan.id, requestText.value.trim()); requestText.value = '' } finally { submitting.value = false }
}
async function confirm() { if (roadmap.adjustment) await roadmap.confirmAdjustment(roadmap.adjustment.id) }
</script>

<template>
  <section v-if="isEligible()" class="adjustment-panel" aria-labelledby="adjustment-title">
    <div class="adjustment-heading"><div><span class="adjustment-eyebrow"><GitPullRequest :size="14" aria-hidden="true" />规划助手调整</span><h2 id="adjustment-title">想从这里开始？先让规划助手评估</h2></div><span class="adjustment-note">当前单元仍是唯一直接入口</span></div>
    <p class="adjustment-copy">你可以描述希望改变的方向。系统会先生成调整 diff，确认后才会更新计划。</p>
    <form class="adjustment-form" @submit.prevent="submit"><textarea v-model="requestText" rows="2" maxlength="2000" placeholder="例如：我想先加强数据与性能，再进入 AI 应用工程。" aria-label="告诉规划助手希望如何调整计划" /><button type="submit" :disabled="submitting || !requestText.trim()"><Send :size="14" aria-hidden="true" />{{ submitting ? '生成中' : '生成调整草案' }}</button></form>
    <div v-if="roadmap.adjustment" class="adjustment-diff"><strong>调整草案已生成</strong><span>{{ roadmap.adjustment.diff.before.join(' → ') }} → {{ roadmap.adjustment.diff.after.join(' → ') }}</span><button type="button" @click="confirm"><Check :size="14" aria-hidden="true" />确认调整</button></div>
    <p v-if="roadmap.error" class="adjustment-error">{{ roadmap.error }}</p>
  </section>
</template>

<style scoped>
.adjustment-panel { margin-top: 16px; padding: 15px 17px; border-top: 2px solid var(--green); background: var(--paper); }.adjustment-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }.adjustment-eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--green); font: 9px var(--mono); text-transform: uppercase; }.adjustment-heading h2 { margin: 7px 0 0; color: var(--ink); font: 400 19px var(--serif); }.adjustment-note, .adjustment-copy, .adjustment-error { color: var(--muted); font-size: 10px; }.adjustment-note { font-family: var(--mono); }.adjustment-copy { margin: 8px 0 11px; }.adjustment-form { display: flex; gap: 8px; }.adjustment-form textarea { flex: 1; min-width: 0; padding: 8px; resize: vertical; border: 1px solid var(--line); background: var(--paper-deep); color: var(--ink); font: 11px/1.5 var(--sans); }.adjustment-form button, .adjustment-diff button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 8px 10px; border: 1px solid #8dad99; background: var(--green-soft); color: #3e7650; font-size: 10px; cursor: pointer; }.adjustment-form button:disabled { cursor: wait; opacity: .55; }.adjustment-diff { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }.adjustment-diff strong { color: var(--green); }.adjustment-diff span { flex: 1 1 260px; font-family: var(--mono); }.adjustment-error { color: #a45f48; }
@media (max-width: 680px) { .adjustment-heading, .adjustment-form { align-items: stretch; flex-direction: column; }.adjustment-form button { justify-content: center; } }
</style>
