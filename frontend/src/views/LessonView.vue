<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import PracticeLauncher from '@/components/learning/PracticeLauncher.vue'
import PracticeWorkspace from '@/components/learning/PracticeWorkspace.vue'
import { useLabStore } from '@/stores/lab'
import { usePracticeStore } from '@/stores/practice'

const labStore = useLabStore()
const practiceStore = usePracticeStore()

onMounted(() => {
  void initialize()
  labStore.startHeartbeat()
})
onUnmounted(() => labStore.dispose())

async function initialize() {
  await Promise.all([labStore.load(), practiceStore.loadHistory()])
  await practiceStore.restoreActive()
  if (!practiceStore.run) await practiceStore.restoreRecord()
}
</script>

<template>
  <div v-if="labStore.loading || practiceStore.restoring" class="lesson-loading" role="status">正在恢复知行实验空间…</div>
  <PracticeWorkspace
    v-else-if="practiceStore.run"
    :practice="practiceStore.run"
    :snapshot="practiceStore.snapshot"
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
    @start="practiceStore.start(labStore.selectedCaseId)"
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
</style>
