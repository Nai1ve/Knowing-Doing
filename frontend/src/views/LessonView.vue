<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowRight, LockKeyhole } from 'lucide-vue-next'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PracticeLauncher from '@/components/learning/PracticeLauncher.vue'
import PracticeWorkspace from '@/components/learning/PracticeWorkspace.vue'
import { useLabStore } from '@/stores/lab'
import { usePracticeStore } from '@/stores/practice'
import { usePlanStore } from '@/stores/plan'
import { isBuildablePractice, isDynamicGym, isFixedMysql } from '@/utils/learning-entry'

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
    if (isDynamicGym(unit)) {
      await practiceStore.startPlanned(planStore.productPlan.id, unit.id)
      if (run !== initialization) return
      if (practiceStore.snapshot?.gymContext?.visibleSql) labStore.sql = practiceStore.snapshot.gymContext.visibleSql
      if (practiceStore.run?.planUnitId === unit.id && labStore.run) {
        labStore.startHeartbeat()
        return
      }
      lessonTitle.value = '知行 Gym 暂时无法进入'
      lessonDescription.value = practiceStore.error ?? '当前动态实践没有可执行的实验环境，请返回 Gym 构建页重试。'
      lessonUnavailable.value = true
      return
    }
    if (isBuildablePractice(unit)) {
      await router.replace({ name: 'gym-build', query: { planId: planStore.productPlan.id, planUnitId: unit.id } })
      return
    }
    if (!isFixedMysql(unit)) {
      lessonTitle.value = unit.learningMode === 'lab' ? '当前实践能力尚未开放' : '当前学习节点不能进入实验'
      lessonDescription.value = unit.learningMode === 'lab' ? '当前节点需要先构建知行 Gym，但对应的实践能力暂未开放。' : '请从路线图进入对应的知识学习或代码实践入口。'
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
  const plan = planStore.productPlan
  const unit = currentUnit.value
  if (plan && unit && isFixedMysql(unit)) void practiceStore.startPlanned(plan.id, unit.id)
  else if (plan && unit && isBuildablePractice(unit)) void router.push({ name: 'gym-build', query: { planId: plan.id, planUnitId: unit.id } })
  else practiceStore.error = '请从当前计划选择一个可用的实践单元。'
}
</script>

<template>
  <div v-if="lessonLoading || labStore.loading || practiceStore.restoring || practiceStore.starting" class="lesson-loading" role="status">正在确认知行 Gym 入口…</div>
  <section v-else-if="lessonUnavailable" class="lesson-unavailable"><LockKeyhole :size="18" aria-hidden="true" /><div><div class="eyebrow">实践入口状态</div><h1>{{ lessonTitle }}</h1><p>{{ lessonDescription }}</p><RouterLink class="primary-button" :to="{ name: planStore.productPlan ? 'overview' : 'start' }">{{ planStore.productPlan ? '返回总览' : '开始建立计划' }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink></div></section>
  <PracticeWorkspace
    v-else-if="currentUnit?.learningMode === 'lab' && (isFixedMysql(currentUnit) || isDynamicGym(currentUnit)) && practiceStore.run?.planUnitId === currentUnit.id && labStore.run"
    :practice="practiceStore.run"
    :snapshot="practiceStore.snapshot"
    :gym-context="practiceStore.snapshot?.gymContext"
    :completion="practiceStore.completion"
    :lab-run="labStore.run"
    :lab-error="labStore.error"
    :practice-error="practiceStore.error"
    :lab-sql="labStore.sql"
    :latest-result="labStore.latestResult"
    :active-session-name="labStore.activeSession?.name"
    :lab-ready="isDynamicGym(currentUnit) || labStore.environmentReady"
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
    v-else-if="isFixedMysql(currentUnit)"
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
