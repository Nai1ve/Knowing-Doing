<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowRight, LockKeyhole } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import PracticeLauncher from '@/components/learning/PracticeLauncher.vue'
import PracticeWorkspace from '@/components/learning/PracticeWorkspace.vue'
import { useLabStore } from '@/stores/lab'
import { usePracticeStore } from '@/stores/practice'
import { usePlanStore } from '@/stores/plan'

const labStore = useLabStore()
const practiceStore = usePracticeStore()
const planStore = usePlanStore()
const nextUnit = computed(() => planStore.productPlan?.units.find((unit) => unit.status === 'current') ?? planStore.productPlan?.units.find((unit) => unit.status === 'upcoming') ?? null)
const currentUnit = computed(() => planStore.productPlan?.units.find((unit) => unit.status === 'current' && unit.availability === 'available') ?? null)
const lessonUnavailable = ref(false)

onMounted(() => {
  void initialize()
  labStore.startHeartbeat()
})
onUnmounted(() => labStore.dispose())

async function initialize() {
  await planStore.loadPlan()
  if (!planStore.productPlan) { lessonUnavailable.value = true; return }
  if (planStore.productPlan.planState !== 'active' || !currentUnit.value) { lessonUnavailable.value = true; return }
  await Promise.all([labStore.load(), practiceStore.loadHistory()])
  await practiceStore.restoreActive()
  if (!practiceStore.run) await practiceStore.restoreRecord()
}

function startCurrentPractice() {
  if (planStore.productPlan && currentUnit.value) void practiceStore.startPlanned(planStore.productPlan.id, currentUnit.value.id)
  else practiceStore.error = '请先在总览创建学习计划。'
}
</script>

<template>
  <div v-if="labStore.loading || practiceStore.restoring" class="lesson-loading" role="status">正在恢复知行实验空间…</div>
  <section v-else-if="lessonUnavailable" class="lesson-unavailable"><LockKeyhole :size="18" aria-hidden="true" /><div><div class="eyebrow">Practice unavailable</div><h1>{{ planStore.productPlan ? '当前学习内容尚未开放' : '请先建立学习计划' }}</h1><p>{{ planStore.productPlan ? '这份路线已经保存，但当前节点还没有可进入的实验环境。' : '完成目标诊断并确认计划后，才能进入真实实践。' }}</p><RouterLink class="primary-button" :to="{ name: planStore.productPlan ? 'overview' : 'start' }">{{ planStore.productPlan ? '返回总览' : '开始建立计划' }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink></div></section>
  <PracticeWorkspace
    v-else-if="practiceStore.run"
    :practice="practiceStore.run"
    :snapshot="practiceStore.snapshot"
    :completion="practiceStore.completion"
    :lab-run="labStore.run"
    :lab-error="labStore.error"
    :practice-error="practiceStore.error"
    :lab-sql="labStore.sql"
    :latest-result="labStore.latestResult"
    :active-session-name="labStore.activeSession?.name"
    :lab-ready="labStore.environmentReady"
    :lab-executing="labStore.executing"
    :practice-starting="practiceStore.starting"
    :lab-resetting="labStore.resetting"
    :lab-ending="labStore.ending"
    :practice-verifying="practiceStore.verifying"
    :messages="practiceStore.messages"
    :sources="practiceStore.sources"
    :source-status="practiceStore.lastTutor?.sourceStatus"
    :tutor-loading="practiceStore.tutorLoading"
    :tutor-question="practiceStore.lastTutor?.nextQuestion"
    :current-gap="practiceStore.currentGap"
    :tutor-failure="practiceStore.tutorFailure"
    @update:sql="labStore.sql = $event"
    @execute="practiceStore.execute"
    @load-default="labStore.loadDefaultSql"
    @load-create-index="labStore.loadCreateIndexSql"
    @load-optimized="labStore.loadOptimizedSql"
    @reset="labStore.reset"
    @end="labStore.end"
    @reopen="practiceStore.reopen()"
    @ask="practiceStore.ask"
    @retry="practiceStore.retryTutor"
    @pin="practiceStore.pin"
    @unpin="practiceStore.unpin"
    @verify="practiceStore.verify"
  />
  <PracticeLauncher
    v-else
    :history="practiceStore.history"
    :cases="labStore.cases"
    :health="labStore.health"
    :selected-case-id="labStore.selectedCaseId"
    :run="labStore.run"
    :ticket="labStore.ticket"
    :loading="labStore.loading"
    :starting="labStore.starting || practiceStore.starting"
    :restoring="practiceStore.restoring"
    :polling="labStore.polling"
    :resetting="labStore.resetting"
    :ending="labStore.ending"
    :error="labStore.error || practiceStore.error"
    :plan-unit="currentUnit ?? nextUnit"
    @start="startCurrentPractice"
    @reset="labStore.reset"
    @end="labStore.end"
    @cancel="labStore.cancelQueue"
    @select="labStore.selectedCaseId = $event"
    @history="practiceStore.selectHistory"
    @reopen="practiceStore.reopen"
  />
</template>

<style scoped>
.lesson-loading { min-height: 260px; display: grid; place-items: center; color: var(--muted); font: 11px var(--mono); }
.lesson-unavailable { display: flex; align-items: flex-start; gap: 13px; max-width: 720px; margin: 60px auto; padding: 20px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); color: var(--orange); }.lesson-unavailable h1 { margin: 7px 0 0; color: var(--ink); font: 400 24px var(--serif); }.lesson-unavailable p { margin: 8px 0 15px; color: var(--muted); font-size: 11px; line-height: 1.6; }.lesson-unavailable a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
</style>
