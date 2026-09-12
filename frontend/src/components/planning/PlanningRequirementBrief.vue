<script setup lang="ts">
import { Check, MessageCircle, RotateCcw } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import type { PlanningRequirementBrief } from '@/types/product'

const props = defineProps<{ brief: PlanningRequirementBrief | null; saving?: boolean; error?: string | null }>()
const emit = defineEmits<{ confirm: [brief: PlanningRequirementBrief]; revise: [] }>()
const draft = ref<PlanningRequirementBrief | null>(null)
watch(() => props.brief, (value) => { draft.value = value ? { ...value, content: { ...value.content, priorities: [...value.content.priorities], constraints: [...value.content.constraints], evidenceNotes: [...value.content.evidenceNotes], openQuestions: [...value.content.openQuestions] } } : null }, { immediate: true })
function lines(value: string[]) { return value.join('\n') }
function updateList(key: 'priorities' | 'constraints' | 'openQuestions', event: Event) { if (draft.value) draft.value.content[key] = (event.target as HTMLTextAreaElement).value.split('\n').map((item) => item.trim()).filter(Boolean) }
function confirm() { if (draft.value) emit('confirm', draft.value) }
</script>

<template>
  <section v-if="draft" class="brief-card" aria-labelledby="requirements-title"><header><div><div class="eyebrow">Requirements brief</div><h2 id="requirements-title">把路线的交付边界说清楚</h2></div><span v-if="draft.status === 'confirmed'" class="confirmed">已确认</span></header><p class="brief-note">这是 Planner 根据对话和评估整理的工作约束。你可以直接修改，也可以在下方对话中继续提出调整。</p><label class="field"><span>目标结果</span><textarea v-model="draft.content.targetOutcome" rows="3" /></label><div class="brief-grid"><label class="field"><span>期限</span><textarea v-model="draft.content.deadline" rows="2" placeholder="未确定可留空" /></label><label class="field"><span>每周投入</span><textarea v-model="draft.content.weeklyCommitment" rows="2" placeholder="未确定可留空" /></label><label class="field"><span>期望产出</span><textarea v-model="draft.content.preferredDeliverable" rows="3" placeholder="例如项目、案例或证书" /></label><label class="field"><span>优先方向</span><textarea :value="lines(draft.content.priorities)" rows="3" @input="updateList('priorities', $event)" /></label><label class="field"><span>现实约束</span><textarea :value="lines(draft.content.constraints)" rows="4" @input="updateList('constraints', $event)" /></label><label class="field"><span>未决项</span><textarea :value="lines(draft.content.openQuestions)" rows="4" @input="updateList('openQuestions', $event)" /></label></div><div class="brief-actions"><button type="button" class="text-button" @click="emit('revise')"><MessageCircle :size="14" aria-hidden="true" />在对话中继续修改</button><button type="button" class="primary-button" :disabled="saving" @click="confirm"><Check :size="14" aria-hidden="true" />{{ saving ? '确认中…' : '确认需求并准备路线' }}</button></div><p v-if="error" class="brief-error"><RotateCcw :size="13" aria-hidden="true" />{{ error }}</p></section>
</template>

<style scoped>
.brief-card { padding: 18px 0 2px; border-top: 2px solid var(--orange); }.brief-card header, .brief-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.brief-card h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.confirmed { padding: 4px 7px; background: var(--green-soft); color: var(--green); font: 8px var(--mono); }.brief-note { margin: 12px 0 18px; color: var(--muted); font-size: 11px; line-height: 1.6; }.brief-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }.field { display: grid; gap: 6px; }.field span { color: var(--muted); font: 9px var(--mono); }.field textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 9px; border: 1px solid var(--line); background: var(--white); color: var(--ink); font: 11px/1.55 var(--sans); }.brief-actions { margin-top: 17px; padding-top: 13px; border-top: 1px solid var(--line); }.primary-button, .text-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; cursor: pointer; }.primary-button:disabled { opacity: .55; cursor: wait; }.brief-error { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; color: var(--red); font-size: 10px; }
@media (max-width: 620px) { .brief-grid { grid-template-columns: 1fr; }.brief-actions { align-items: stretch; flex-direction: column; }.brief-actions button { justify-content: center; } }
</style>
