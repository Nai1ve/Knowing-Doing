<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowRight, LockKeyhole } from 'lucide-vue-next'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PracticeLauncher from '@/components/learning/PracticeLauncher.vue'
import PracticeWorkspace from '@/components/learning/PracticeWorkspace.vue'
import { useLabStore } from '@/stores/lab'
import { usePracticeStore } from '@/stores/practice'
import { usePlanStore } from '@/stores/plan'

const labStore = useLabStore()
const practiceStore = usePracticeStore()
const planStore = usePlanStore()
const route = useRoute()
const router = useRouter()
const requestedPlanUnitId = computed(() => typeof route.query.planUnitId === 'string' ? route.query.planUnitId : null)
const currentUnit = computed(() => planStore.productPlan?.units.find((unit) => unit.id === requestedPlanUnitId.value) ?? null)
const lessonUnavailable = ref(false)
const lessonLoading = ref(true)
const lessonTitle = ref('请从路线图选择学习节点')
const lessonDescription = ref('Lesson 只接受明确的计划单元，不会替你猜测应该进入哪个实验。')
let initialization = 0

onMounted(() => { void initialize() })
onUnmounted(() => labStore.dispose())
watch(requestedPlanUnitId, () => { void initialize() })

async function initialize() {
  const run = ++initialization
  lessonLoading.value = true
  lessonUnavailable.value = false
  lessonTitle.value = '正在确认学习入口'
  lessonDescription.value = '正在读取当前计划中的明确学习单元。'
  labStore.dispose()
  try {
    await planStore.loadPlan()
    if (run !== initialization) return
    if (!requestedPlanUnitId.value) {
      lessonTitle.value = '请从路线图选择学习节点'
      lessonDescription.value = '总览和路线图会根据当前计划把你带到具体的学习节点。'
      lessonUnavailable.value = true
      return
    }
    if (!planStore.productPlan) {
      lessonTitle.value = '请先建立学习计划'
      lessonDescription.value = '完成规划并确认路线后，才能进入知行 Gym。'
      lessonUnavailable.value = true
      return
    }
    const unit = currentUnit.value
    if (!unit) {
      lessonTitle.value = '学习单元不存在'
      lessonDescription.value = '这个入口已经不属于当前计划，请从路线图重新选择。'
      lessonUnavailable.value = true
      return
    }
    if (unit.learningMode === 'knowledge' && planStore.productPlan.roadmapId && unit.roadmapNodeId) {
      await router.replace({ name: 'roadmap-node', params: { roadmapId: planStore.productPlan.roadmapId, nodeId: unit.roadmapNodeId } })
      return
    }
    if (unit.learningMode === 'workspace' && planStore.productPlan.roadmapId && unit.roadmapNodeId) {
      await router.replace({ name: 'case-setup', params: { roadmapId: planStore.productPlan.roadmapId, nodeId: unit.roadmapNodeId } })
      return
    }
    if (unit.learningMode !== 'lab' || unit.availability !== 'available' || !unit.caseId) {
      lessonTitle.value = '当前学习内容尚未开放'
      lessonDescription.value = '这份路线已经保存，但当前单元没有可进入的 MySQL 实验室。'
      lessonUnavailable.value = true
      return
    }
    labStore.startHeartbeat()
    await Promise.all([labStore.load(), practiceStore.loadHistory()])
    await practiceStore.restoreActive()
    if (!practiceStore.run || practiceStore.run.planUnitId !== unit.id) await practiceStore.restoreRecord()
  } finally {
    if (run === initialization) lessonLoading.value = false
  }
}

function startCurrentPractice() {
  if (planStore.productPlan && currentUnit.value?.learningMode === 'lab' && currentUnit.value.availability === 'available' && currentUnit.value.caseId) void practiceStore.startPlanned(planStore.productPlan.id, currentUnit.value.id)
  else practiceStore.error = '请从当前计划选择一个可用的实验室单元。'
}
</script>

<template>
  <div v-if="lessonLoading || labStore.loading || practiceStore.restoring" class="lesson-loading" role="status">正在确认知行 Gym 入口…</div>
  <section v-else-if="lessonUnavailable" class="lesson-unavailable"><LockKeyhole :size="18" aria-hidden="true" /><div><div class="eyebrow">Gym entry unavailable</div><h1>{{ lessonTitle }}</h1><p>{{ lessonDescription }}</p><RouterLink class="primary-button" :to="{ name: planStore.productPlan ? 'overview' : 'start' }">{{ planStore.productPlan ? '返回总览' : '开始建立计划' }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink></div></section>
  <PracticeWorkspace
    v-else-if="currentUnit?.learningMode === 'lab' && practiceStore.run?.planUnitId === currentUnit.id"
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
    :plan-unit="currentUnit"
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
