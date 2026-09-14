<script setup lang="ts">
import { computed, onUnmounted, reactive, watch } from 'vue'
import { CheckCircle2, CircleAlert, FlaskConical, LoaderCircle, RefreshCw, Save, Send, Sparkles } from 'lucide-vue-next'
import { useLearningGymStore } from '@/stores/learningGym'
import type { PracticeActivity } from '@/types/learningExperience'
import PracticeCardSources from '@/components/learning/PracticeCardSources.vue'

const props = defineProps<{ planUnitId: string; mode?: 'knowledge_only' | 'mixed'; title?: string }>()
const gym = useLearningGymStore()
const answers = reactive<Record<string, string>>({})
const feedback = reactive<Record<string, string>>({})
const mode = computed(() => props.mode ?? 'mixed')
const reflection = computed({ get: () => gym.session?.reflection ?? answers[reflectionActivity.value?.id ?? ''] ?? '', set: (value: string) => { if (reflectionActivity.value) answers[reflectionActivity.value.id] = value } })
const reflectionActivity = computed(() => gym.session?.activities.find((activity) => activity.type === 'reflection'))
const activityLabel: Record<PracticeActivity['type'], string> = { concept: '理解', knowledge_check: '检查', scenario_reasoning: '推理', runtime_practice: '实践', reflection: '反思' }

watch(() => gym.session, (session) => { session?.activityStates.forEach((state) => { answers[state.activityId] = Array.isArray(state.answer) ? state.answer.join(',') : state.answer ?? ''; if (state.feedback) feedback[state.activityId] = state.feedback }) }, { immediate: true, deep: true })
watch(() => `${props.planUnitId}:${mode.value}`, () => { void gym.open(props.planUnitId, mode.value) }, { immediate: true })
const refreshTimer = window.setInterval(() => { if (gym.session && gym.session.stage !== 'completed') void gym.refreshSession() }, 3000)
onUnmounted(() => window.clearInterval(refreshTimer))

function state(activity: PracticeActivity) { return gym.stateFor(activity.id) }
function isReady(activity: PracticeActivity) { return Boolean(answers[activity.id]?.trim()) }
async function save(activity: PracticeActivity) { if (!isReady(activity)) return; await gym.saveAnswer(activity.id, answers[activity.id]) }
async function submit(activity: PracticeActivity) { if (!isReady(activity)) return; const result = await gym.submitAnswer(activity.id); if (result) feedback[activity.id] = result.feedback }
async function finish() { if (reflection.value.trim().length < 12) return; await gym.complete(reflection.value) }
</script>

<template>
  <div class="unified-gym" aria-live="polite">
    <header class="gym-header">
      <div><span class="eyebrow">{{ mode === 'mixed' ? 'MIXED GYM' : 'PRACTICE CARD' }} · {{ gym.session?.stage ?? 'orienting' }}<template v-if="gym.card?.isFixture"> · FIXTURE</template></span><h1>{{ title ?? gym.card?.title ?? '统一知行 Gym' }}</h1><p>{{ gym.card?.objective ?? '正在准备一次可验证的练习。' }}</p></div>
      <div class="gym-progress"><strong>{{ gym.progress.completed }} / {{ gym.progress.total }}</strong><span>已完成活动</span><div class="progress-track"><i :style="{ width: `${gym.progress.total ? gym.progress.completed / gym.progress.total * 100 : 0}%` }" /></div></div>
    </header>

    <section v-if="gym.loading && !gym.session" class="gym-state"><LoaderCircle class="spin" :size="17" /><span>正在恢复 Practice Card 与 Gym Session…</span></section>
    <section v-else-if="gym.cardError" class="gym-state error"><CircleAlert :size="17" /><div><strong>Practice Card 暂时不可用</strong><p>{{ gym.cardError }}</p><button type="button" @click="gym.retryCard">重试生成卡片</button></div></section>
    <template v-else-if="gym.session">
      <section class="gym-context"><Sparkles :size="16" aria-hidden="true" /><div><strong>先做判断，再进入实践</strong><p>{{ gym.card?.summary }}</p></div><span class="attempts">每题最多两次尝试</span></section>
      <PracticeCardSources :sources="gym.card?.sourceReferences" />
      <section class="activity-list" aria-label="Gym activities">
        <article v-for="activity in gym.session.activities" :key="activity.id" class="activity-card" :class="{ active: gym.currentActivity?.id === activity.id, done: ['correct', 'completed'].includes(state(activity)?.status ?? '') }">
          <div class="activity-heading"><span class="activity-index">{{ activityLabel[activity.type] }}</span><div><h2>{{ activity.title }}</h2><p v-if="activity.context">{{ activity.context }}</p></div><CheckCircle2 v-if="['correct', 'completed'].includes(state(activity)?.status ?? '')" class="done-icon" :size="17" aria-label="已完成" /></div>
          <p class="activity-prompt">{{ activity.prompt }}</p>
          <div v-if="activity.type === 'runtime_practice'" class="runtime-card"><FlaskConical :size="18" /><div><strong>受限运行时</strong><p>{{ gym.session.runtime?.label ?? '运行时的输入、执行和完成信号由服务端控制；前端不持有答案或评分规则。' }}</p></div><button v-if="['not_started', 'ready'].includes(gym.session.runtime?.status ?? '')" type="button" class="primary-button" :disabled="gym.saving" @click="gym.startRuntime">{{ gym.session.runtime?.status === 'ready' ? '创建实践实例' : '准备环境' }}</button><RouterLink v-else-if="gym.session.runtime?.status === 'active' && gym.session.runtime.kind === 'docker_workspace' && gym.session.runtime.workspaceRunId" class="primary-button" :to="{ name: 'code-workspace', params: { workspaceRunId: gym.session.runtime.workspaceRunId } }">进入 Python 工作台</RouterLink><RouterLink v-else-if="gym.session.runtime?.status === 'active' && gym.session.runtime.kind === 'mysql_lab'" class="primary-button" :to="{ name: 'lesson', query: { planUnitId, runtime: 'legacy' } }">进入 MySQL 工作台</RouterLink><button v-else type="button" class="secondary-button" :disabled="gym.loading" @click="gym.refreshSession"><RefreshCw :size="13" />刷新验证状态</button></div>
          <div v-else-if="activity.type === 'concept'" class="concept-note">阅读完成后继续下面的知识检查；本活动不要求提交答案。</div>
          <template v-else-if="activity.type !== 'reflection'">
            <div v-if="activity.options?.length" class="options"><label v-for="option in activity.options" :key="option.value" :class="{ selected: answers[activity.id] === option.value }"><input v-model="answers[activity.id]" type="radio" :name="activity.id" :value="option.value" />{{ option.label }}</label></div>
            <textarea v-else v-model="answers[activity.id]" rows="3" placeholder="说明证据、判断与下一步动作…" :aria-label="activity.title" />
            <div class="activity-actions"><span v-if="state(activity)?.attempts">第 {{ state(activity)?.attempts }} 次尝试 · 还可尝试 {{ Math.max(0, 2 - (state(activity)?.attempts ?? 0)) }} 次</span><button type="button" class="secondary-button" :disabled="gym.saving || !isReady(activity)" @click="save(activity)"><Save :size="13" />保存</button><button type="button" class="primary-button" :disabled="gym.submitting || !isReady(activity)" @click="submit(activity)"><Send :size="13" />{{ gym.submitting ? '提交中…' : '提交检查' }}</button></div>
          </template>
          <template v-else><textarea v-model="answers[activity.id]" rows="4" placeholder="至少 12 个字：写下判断变化与下一步验证…" aria-label="反思" /><div class="activity-actions"><span>完成后会记录本次 Gym 的结果</span><button type="button" class="primary-button" :disabled="gym.completing || answers[activity.id]?.trim().length < 12" @click="finish">{{ gym.completing ? '完成中…' : '完成 Gym' }}</button></div></template>
          <p v-if="feedback[activity.id]" class="activity-feedback" :class="state(activity)?.status === 'incorrect' ? 'incorrect' : 'correct'"><CircleAlert v-if="state(activity)?.status === 'incorrect'" :size="13" /><CheckCircle2 v-else :size="13" />{{ feedback[activity.id] }}</p>
        </article>
      </section>
      <section v-if="gym.session.stage === 'completed'" class="completion-banner"><CheckCircle2 :size="18" /><div><strong>这次 Gym 已完成</strong><p>结果：{{ gym.session.outcome === 'verified' ? '已验证' : gym.session.outcome === 'completed_with_gaps' ? '完成但仍有间隙' : '未完成' }}。可以回到路线继续积累证据。</p></div></section>
    </template>
    <p v-if="gym.error" class="gym-error" role="alert">{{ gym.error }}</p>
  </div>
</template>

<style scoped>
.unified-gym { max-width: 1000px; margin: 0 auto; }.gym-header { display: flex; justify-content: space-between; gap: 28px; padding-bottom: 20px; border-bottom: 2px solid var(--orange); }.gym-header h1 { margin: 8px 0 0; color: var(--ink); font: 400 30px/1.2 var(--serif); }.gym-header p { max-width: 640px; margin: 9px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; }.gym-progress { flex: 0 0 150px; align-self: end; color: var(--muted); font: 9px var(--mono); }.gym-progress strong { display: block; color: var(--ink); font: 22px var(--serif); }.progress-track { height: 4px; margin-top: 8px; background: var(--line); }.progress-track i { display: block; height: 100%; background: var(--green); transition: width .2s ease; }.gym-state, .gym-context, .completion-banner { display: flex; align-items: flex-start; gap: 10px; margin-top: 22px; padding: 15px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--blue); }.gym-state.error { border-top-color: var(--red); color: var(--red); }.gym-state p, .gym-context p, .completion-banner p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.gym-state button { margin-top: 10px; padding: 7px 10px; border: 1px solid var(--line); background: transparent; color: var(--blue); cursor: pointer; }.gym-context { border-top-color: var(--green); color: var(--green); }.gym-context > div { flex: 1; }.attempts { color: var(--muted); font: 9px var(--mono); }.activity-list { display: grid; gap: 13px; margin-top: 18px; }.activity-card { padding: 17px; border: 1px solid var(--line); background: var(--paper); }.activity-card.active { border-color: var(--orange); box-shadow: 0 7px 16px rgba(180,104,68,.08); }.activity-card.done { border-left: 3px solid var(--green); }.activity-heading { display: flex; align-items: flex-start; gap: 10px; }.activity-index { flex: 0 0 auto; padding: 4px 6px; background: var(--blue-soft); color: var(--blue); font: 8px var(--mono); }.activity-heading h2 { margin: 0; color: var(--ink); font: 400 20px var(--serif); }.activity-heading p { margin: 4px 0 0; color: var(--muted); font-size: 10px; }.done-icon { margin-left: auto; color: var(--green); }.activity-prompt { margin: 14px 0 10px; color: #53615a; font-size: 11px; line-height: 1.6; }.options { display: grid; gap: 7px; }.options label { display: flex; gap: 8px; align-items: center; padding: 9px; border: 1px solid var(--line); color: #58665e; font-size: 10px; cursor: pointer; }.options label.selected { border-color: var(--blue); background: var(--blue-soft); color: var(--blue); }.options input { accent-color: var(--blue); }.activity-card textarea { width: 100%; box-sizing: border-box; padding: 9px; resize: vertical; border: 1px solid var(--line); background: var(--paper-deep); color: var(--ink); font: 11px/1.55 var(--sans); }.activity-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }.activity-actions > span { flex: 1; color: var(--muted); font: 9px var(--mono); }.primary-button, .secondary-button { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 7px 10px; border: 1px solid #b66844; background: var(--orange-soft); color: #995436; font-size: 10px; cursor: pointer; }.secondary-button { border-color: var(--line); background: var(--paper); color: var(--blue); }.primary-button:disabled, .secondary-button:disabled { cursor: wait; opacity: .55; }.runtime-card { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--paper-deep); color: var(--orange); }.runtime-card > div { flex: 1; }.runtime-card p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.runtime-ready { color: var(--green); font: 9px var(--mono); }.activity-feedback { display: flex; align-items: center; gap: 5px; margin: 11px 0 0; padding: 8px; background: var(--green-soft); color: var(--green); font-size: 10px; }.activity-feedback.incorrect { background: var(--red-soft); color: var(--red); }.completion-banner { border-top-color: var(--green); color: var(--green); }.gym-error { margin: 15px 0 0; padding: 9px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); font-size: 10px; }
.concept-note { padding: 10px; background: var(--green-soft); color: var(--green); font-size: 10px; line-height: 1.55; }
@media (max-width: 700px) { .gym-header { flex-direction: column; gap: 14px; }.gym-progress { flex-basis: auto; }.activity-actions, .runtime-card { align-items: stretch; flex-direction: column; }.activity-actions > span { min-height: 15px; }.activity-actions button { justify-content: center; width: 100%; } }
</style>
