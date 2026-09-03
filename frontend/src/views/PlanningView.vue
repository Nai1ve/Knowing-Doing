<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, Check, CircleHelp, UserRound } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { usePlanningConversationStore } from '@/stores/planningConversation'

const route = useRoute(); const router = useRouter(); const planning = usePlanningConversationStore(); const answer = ref(''); const selected = ref('')
const session = computed(() => planning.session); const question = computed(() => session.value?.nextQuestion ?? null); const answered = computed(() => Object.entries(session.value?.answers ?? {}).filter(([key]) => key !== 'goal'))
const labels: Record<string, string> = { experience: '已有经验', priority_domain: '优先方向', weekly_minutes: '每周投入', outcome: '预期产出' }
onMounted(() => void planning.load(String(route.params.sessionId)))
function choose(value: string) { selected.value = value; answer.value = value }
function structuredValue(): unknown {
  if (question.value?.key === 'weekly_minutes') return answer.value.includes('少于') ? 90 : answer.value.includes('4 小时以上') ? 300 : 180
  return answer.value
}
async function submit() {
  if (!question.value || !answer.value.trim()) return
  const updated = await planning.answer({ stepKey: question.value.key, answer: answer.value, structuredValue: structuredValue() }); answer.value = ''; selected.value = ''
  if (updated.status === 'ready' && updated.draftRoadmapId) await router.push({ name: 'roadmap-preview', params: { roadmapId: updated.draftRoadmapId } })
}
</script>

<template>
  <div class="page planning-page"><AsyncState :loading="planning.loading" :error="planning.error"><template #default>
    <PageHeader eyebrow="01 · Plan together" title="先把想去的方向说清楚。" description="这是规则引导的规划对话。你的原话会被保存，路线只根据已经确认的信息调整。" :meta="['一次一个问题', '可随时返回', '规则路线 senior-backend-ai-v1']" />
    <div v-if="session" class="planning-layout">
      <section class="conversation-panel" aria-labelledby="planning-question"><div class="conversation-kicker"><CircleHelp :size="15" aria-hidden="true" /><span>当前问题 · {{ (session.currentStep + 1).toString().padStart(2, '0') }}</span></div><div class="question-bubble"><h2 id="planning-question">{{ question?.prompt ?? '信息已经收集完成。' }}</h2><p>只回答眼前这一项，后面的安排会基于你的选择生成。</p></div><div v-if="question?.options.length" class="option-list"><button v-for="option in question.options" :key="option" type="button" :class="{ selected: selected === option }" @click="choose(option)">{{ option }}<Check v-if="selected === option" :size="14" aria-hidden="true" /></button></div><textarea v-if="question && question.key !== 'summary'" v-model="answer" rows="3" :placeholder="question.key === 'goal' ? '用自己的话描述目标' : '也可以补充一句具体背景'" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit" /><button class="primary-button next-button" type="button" :disabled="planning.loading || !answer.trim()" @click="submit">{{ question?.key === 'summary' ? '生成路线草案' : '继续' }} <ArrowRight :size="14" aria-hidden="true" /></button></section>
      <aside class="confirmed-panel" aria-labelledby="confirmed-title"><div class="confirmed-heading"><UserRound :size="15" aria-hidden="true" /><span id="confirmed-title">已确认的信息</span></div><div class="goal-note"><small>目标</small><strong>{{ session.goal }}</strong></div><div v-if="answered.length" class="answer-list"><div v-for="[key, value] in answered" :key="key"><small>{{ labels[key] ?? key }}</small><span>{{ value }}</span></div></div><div v-else class="empty-confirmed">对话会从你的目标开始，逐步补齐路线输入。</div><div class="rule-note">规则只使用受控回答生成路线，不把自由文本包装成能力判断。</div></aside>
    </div>
  </template></AsyncState></div>
</template>

<style scoped>
.planning-page { max-width: 1040px; }.planning-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, .75fr); gap: 30px; margin-top: 30px; }.conversation-panel { min-width: 0; padding-top: 8px; }.conversation-kicker, .confirmed-heading { display: flex; align-items: center; gap: 8px; color: var(--blue); font: 9px var(--mono); letter-spacing: .35px; text-transform: uppercase; }.question-bubble { margin-top: 20px; padding: 22px 0 19px; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.question-bubble h2 { max-width: 650px; margin: 0; color: var(--ink); font: 400 28px/1.25 var(--serif); }.question-bubble p { margin: 11px 0 0; color: var(--muted); font-size: 11px; }.option-list { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px; }.option-list button { display: inline-flex; align-items: center; gap: 8px; min-height: 35px; padding: 8px 11px; border: 1px solid var(--line); background: var(--paper); color: #52605a; font-size: 11px; cursor: pointer; }.option-list button:hover, .option-list button.selected { border-color: #b66844; background: var(--orange-soft); color: #965134; }.conversation-panel textarea { display: block; width: 100%; margin-top: 18px; padding: 12px; border: 1px solid var(--line); outline: none; background: #fbfaf6; color: var(--ink); font: 12px/1.65 var(--sans); resize: vertical; }.conversation-panel textarea:focus { border-color: var(--blue); }.next-button { margin-top: 12px; }.confirmed-panel { align-self: start; padding: 15px 0; border-top: 2px solid var(--blue); border-bottom: 1px solid var(--line); }.goal-note { margin-top: 22px; }.goal-note small, .answer-list small { display: block; color: #828984; font: 9px var(--mono); }.goal-note strong { display: block; margin-top: 7px; color: var(--ink); font: 400 18px/1.35 var(--serif); }.answer-list { display: grid; gap: 14px; margin-top: 22px; }.answer-list span { display: block; margin-top: 5px; color: #56625d; font-size: 11px; line-height: 1.5; }.empty-confirmed { margin-top: 20px; color: var(--muted); font-size: 11px; line-height: 1.6; }.rule-note { margin-top: 25px; padding-top: 12px; border-top: 1px solid var(--line); color: #858b86; font: 10px/1.6 var(--mono); }
@media (max-width: 760px) { .planning-layout { grid-template-columns: 1fr; gap: 24px; }.confirmed-panel { order: -1; }.question-bubble h2 { font-size: 24px; } }
</style>
