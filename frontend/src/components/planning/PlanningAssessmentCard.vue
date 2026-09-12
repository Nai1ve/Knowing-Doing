<script setup lang="ts">
import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck, CircleX, RotateCcw, Save, SkipForward } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { PlanningAssessment, PlanningAssessmentAnswer, PlanningAssessmentReview } from '@/types/product'

const props = defineProps<{ assessment: PlanningAssessment | null; loading?: boolean; saving?: boolean; error?: string | null; review?: PlanningAssessmentReview | null; reviewLoading?: boolean }>()
const emit = defineEmits<{
  retry: []
  save: [answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]]
  complete: [answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]]
  abandon: [answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]]
  review: []
}>()
const draftAnswers = ref<Record<string, PlanningAssessmentAnswer>>({})
const skipped = ref<string[]>([])
const currentIndex = ref(0)
const reviewOpen = ref(false)

watch(() => props.assessment, (value) => {
  if (!value) return
  draftAnswers.value = { ...value.answers }
  skipped.value = [...value.skipped]
  currentIndex.value = Math.min(value.currentQuestionIndex ?? 0, Math.max(0, value.questions.length - 1))
}, { immediate: true })

const question = computed(() => props.assessment?.questions[currentIndex.value] ?? null)
const questionNumber = computed(() => question.value ? currentIndex.value + 1 : 0)
const progressPercent = computed(() => props.assessment?.progress.total ? Math.round((props.assessment.progress.completed / props.assessment.progress.total) * 100) : 0)
const isTerminal = computed(() => props.assessment?.status === 'completed' || props.assessment?.status === 'abandoned')
const isBusyState = computed(() => props.loading || props.assessment?.status === 'preparing' || props.assessment?.status === 'evaluating')

function currentAnswer(): PlanningAssessmentAnswer { return question.value ? draftAnswers.value[question.value.key] ?? null : null }
function setText(event: Event) { if (question.value) draftAnswers.value[question.value.key] = (event.target as HTMLTextAreaElement).value }
function toggleOption(option: string) {
  if (!question.value) return
  const values = Array.isArray(draftAnswers.value[question.value.key]) ? [...draftAnswers.value[question.value.key] as string[]] : []
  const index = values.indexOf(option); if (index >= 0) values.splice(index, 1); else values.push(option)
  draftAnswers.value[question.value.key] = values
}
function isSelected(option: string) { return Array.isArray(currentAnswer()) && (currentAnswer() as string[]).includes(option) }
function payload(): [Record<string, PlanningAssessmentAnswer>, string[]] { return [{ ...draftAnswers.value }, [...skipped.value]] }
function skipCurrent() {
  if (!question.value) return
  if (!skipped.value.includes(question.value.key)) skipped.value.push(question.value.key)
  draftAnswers.value[question.value.key] = null
  const [answers, skippedAnswers] = payload(); emit('save', answers, skippedAnswers)
  if (currentIndex.value < (props.assessment?.questions.length ?? 1) - 1) currentIndex.value += 1
}
function saveAndNext() {
  if (!question.value) return
  skipped.value = skipped.value.filter((key) => key !== question.value?.key)
  const [answers, skippedAnswers] = payload(); emit('save', answers, skippedAnswers)
  if (currentIndex.value < (props.assessment?.questions.length ?? 1) - 1) currentIndex.value += 1
}
function complete() { const [answers, skippedAnswers] = payload(); emit('complete', answers, skippedAnswers) }
function abandon() { const [answers, skippedAnswers] = payload(); emit('abandon', answers, skippedAnswers) }
function toggleReview() { reviewOpen.value = !reviewOpen.value; if (reviewOpen.value && !props.review) emit('review') }
</script>

<template>
  <section class="assessment-card" aria-labelledby="assessment-title">
    <header class="assessment-header"><div><div class="eyebrow">Diagnostic assessment</div><h2 id="assessment-title">把会什么，变成可验证的起点</h2></div><span v-if="assessment" class="assessment-status">{{ assessment.status === 'answering' ? '进行中' : assessment.status === 'completed' ? '已完成' : assessment.status === 'abandoned' ? '已结束' : assessment.status === 'evaluating' ? '正在整理' : '准备中' }}</span></header>
    <div v-if="loading || isBusyState" class="assessment-state" aria-live="polite"><span class="state-pulse" /><div><strong>{{ assessment?.status === 'evaluating' ? '正在整理评估结果…' : '正在准备评估…' }}</strong><p>当前状态会自动保存。若网络中断，可以安全重试。</p></div></div>
    <div v-else-if="error" class="assessment-state error" role="alert"><AlertTriangle :size="16" aria-hidden="true" /><div><strong>评估暂时没有准备好</strong><p>{{ error }}</p><button type="button" class="secondary-button" @click="emit('retry')"><RotateCcw :size="13" aria-hidden="true" />重试评估</button></div></div>
    <template v-else-if="assessment && !isTerminal">
      <div class="assessment-progress"><div><span>第 {{ questionNumber }} / {{ assessment.questions.length }} 题</span><strong>{{ progressPercent }}%</strong></div><div class="progress-track"><span :style="{ width: `${progressPercent}%` }" /></div></div>
      <article v-if="question" class="question"><small>{{ question.difficulty }} · 可明确跳过</small><h3>{{ question.prompt }}</h3>
        <div v-if="question.type === 'single_choice'" class="options"><label v-for="option in question.options ?? []" :key="option.value" class="option" :class="{ selected: currentAnswer() === option.value }"><input v-model="draftAnswers[question.key]" type="radio" :name="question.key" :value="option.value" /><span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span></label></div>
        <div v-else-if="question.type === 'multiple_choice'" class="options"><label v-for="option in question.options ?? []" :key="option.value" class="option" :class="{ selected: isSelected(option.value) }" @click.prevent="toggleOption(option.value)"><input type="checkbox" :checked="isSelected(option.value)" :value="option.value" /><span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span></label></div>
        <textarea v-else :value="typeof currentAnswer() === 'string' ? currentAnswer() : ''" rows="5" placeholder="用一个具体例子说明" @input="setText" />
      </article>
      <div class="assessment-actions"><button type="button" class="text-button" :disabled="saving" @click="skipCurrent"><SkipForward :size="13" aria-hidden="true" />明确跳过</button><div><button type="button" class="text-button" :disabled="saving || currentIndex === 0" @click="currentIndex -= 1">上一题</button><button v-if="currentIndex < assessment.questions.length - 1" type="button" class="secondary-button" :disabled="saving" @click="saveAndNext"><Save :size="13" aria-hidden="true" />{{ saving ? '保存中…' : '保存并继续' }}</button><button v-else type="button" class="primary-button" :disabled="saving" @click="complete"><CircleCheck :size="14" aria-hidden="true" />完成评估</button><button type="button" class="text-button abandon" :disabled="saving" @click="abandon"><CircleX :size="13" aria-hidden="true" />结束评估</button></div></div>
    </template>
    <template v-else-if="assessment && isTerminal">
      <div v-if="assessment.summary?.dimensions.length" class="assessment-result"><div class="result-intro"><CircleCheck :size="17" aria-hidden="true" /><div><strong>评估结果已保存</strong><p>以下是当前证据支持的维度判断，不合并成一个总分。</p></div></div><div class="dimension-list"><article v-for="dimension in assessment.summary.dimensions" :key="dimension.key"><div><strong>{{ dimension.label || dimension.key }}</strong><span>{{ dimension.level }} · 置信度 {{ Math.round(dimension.confidence * 100) }}%</span></div><p v-if="dimension.evidence.length">{{ dimension.evidence[0] }}</p><small>下一步验证：{{ dimension.nextValidation }}</small></article></div></div>
      <div class="review-toggle"><button type="button" class="text-button" @click="toggleReview"><ChevronDown v-if="reviewOpen" :size="14" aria-hidden="true" /><ChevronRight v-else :size="14" aria-hidden="true" />{{ reviewOpen ? '收起逐题复核' : '查看逐题复核' }}</button><span>仅在你主动展开时加载</span></div>
      <div v-if="reviewOpen" class="review-list"><div v-if="reviewLoading">正在加载逐题复核…</div><article v-for="item in review?.items ?? []" :key="item.questionId"><strong>{{ item.question }}</strong><span>{{ item.skipped ? '已明确跳过' : item.answer === null ? '未作答' : Array.isArray(item.answer) ? item.answer.join('、') : item.answer }}</span><small v-if="item.explanation">{{ item.explanation }}</small><small v-if="item.referenceAnswer !== undefined">参考答案：{{ typeof item.referenceAnswer === 'string' ? item.referenceAnswer : JSON.stringify(item.referenceAnswer) }}</small></article></div>
    </template>
  </section>
</template>

<style scoped>
.assessment-card { padding: 18px 0 2px; border-top: 2px solid var(--blue); }.assessment-header, .assessment-progress > div, .assessment-actions, .review-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.assessment-header h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.assessment-status { padding: 4px 7px; background: var(--blue-soft); color: var(--blue); font: 8px var(--mono); }.assessment-state { display: flex; align-items: start; gap: 10px; margin-top: 20px; padding: 13px; border-left: 2px solid var(--blue); background: var(--blue-soft); }.assessment-state.error { border-color: var(--orange); background: var(--orange-soft); }.assessment-state strong { color: var(--ink); font-size: 12px; }.assessment-state p { margin: 5px 0 10px; color: var(--muted); font-size: 10px; line-height: 1.5; }.state-pulse { width: 16px; height: 16px; flex: 0 0 auto; border: 2px solid var(--blue); border-top-color: transparent; border-radius: 50%; animation: spin .9s linear infinite; }.assessment-progress { margin-top: 23px; }.assessment-progress span, .assessment-progress strong { color: var(--muted); font: 9px var(--mono); }.assessment-progress strong { color: var(--blue); }.progress-track { height: 4px; margin-top: 8px; background: var(--line-soft); }.progress-track span { display: block; height: 100%; background: var(--blue); transition: width .2s ease; }.question { margin-top: 22px; }.question > small { color: var(--muted); font: 9px var(--mono); }.question h3 { max-width: 720px; margin: 8px 0 0; color: var(--ink); font: 400 19px/1.35 var(--serif); }.question > p { color: var(--muted); font-size: 11px; line-height: 1.6; }.options { display: grid; gap: 8px; margin-top: 17px; }.option { display: flex; align-items: start; gap: 9px; padding: 11px; border: 1px solid var(--line); background: var(--paper-deep); cursor: pointer; }.option.selected { border-color: var(--blue); background: var(--blue-soft); }.option input { margin-top: 2px; accent-color: var(--blue); }.option strong, .option small { display: block; }.option strong { color: var(--ink); font-size: 11px; font-weight: 500; }.option small { margin-top: 4px; color: var(--muted); font-size: 9px; line-height: 1.4; }.question textarea { width: 100%; box-sizing: border-box; margin-top: 16px; resize: vertical; padding: 10px; border: 1px solid var(--line); font: 11px/1.6 var(--sans); }.scale-options { display: flex; align-items: end; gap: 9px; margin-top: 22px; }.scale-options label { display: grid; justify-items: center; gap: 5px; min-width: 34px; padding: 8px 4px; border: 1px solid var(--line); cursor: pointer; }.scale-options label.selected { border-color: var(--blue); background: var(--blue-soft); }.scale-options input { accent-color: var(--blue); }.scale-options span { max-width: 70px; color: var(--muted); font: 9px/1.3 var(--mono); }.assessment-actions { align-items: end; margin-top: 22px; padding-top: 13px; border-top: 1px solid var(--line); }.assessment-actions > div { display: flex; align-items: center; gap: 9px; }.secondary-button, .primary-button, .text-button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 7px 10px; cursor: pointer; }.assessment-card button:disabled { opacity: .55; cursor: wait; }.abandon { color: var(--red); }.assessment-result { margin-top: 20px; }.result-intro { display: flex; gap: 9px; padding: 12px; background: var(--green-soft); color: var(--green); }.result-intro strong { color: var(--ink); font-size: 12px; }.result-intro p { margin: 4px 0 0; color: var(--muted); font-size: 10px; }.dimension-list { display: grid; gap: 9px; margin-top: 14px; }.dimension-list article { padding: 11px; border: 1px solid var(--line-soft); }.dimension-list article > div { display: flex; justify-content: space-between; gap: 10px; }.dimension-list strong { color: var(--ink); font-size: 11px; font-weight: 500; }.dimension-list span, .dimension-list small { color: var(--muted); font: 9px var(--mono); }.dimension-list p { margin: 7px 0 0; color: #56635b; font-size: 10px; line-height: 1.5; }.dimension-list small { display: block; margin-top: 7px; }.review-toggle { justify-content: start; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); }.review-toggle span { color: var(--muted); font: 9px var(--mono); }.review-list { display: grid; gap: 7px; margin-top: 10px; }.review-list article { display: grid; gap: 5px; padding: 9px 11px; background: var(--paper-muted); }.review-list strong { color: var(--ink); font-size: 10px; font-weight: 500; }.review-list span { color: var(--muted); font-size: 10px; line-height: 1.5; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 580px) { .assessment-actions, .assessment-actions > div, .dimension-list article > div { align-items: stretch; flex-direction: column; }.assessment-actions > div button { justify-content: center; }.scale-options { gap: 4px; }.scale-options span { display: none; } }
</style>
