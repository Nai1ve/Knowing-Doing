<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hasApiErrorCode } from '@/api/client'
import { uploadPlanningResume } from '@/api/planningService'
import PlanningChat from '@/components/planning/PlanningChat.vue'
import PlanningAssessmentCard from '@/components/planning/PlanningAssessmentCard.vue'
import PlanningProgress from '@/components/planning/PlanningProgress.vue'
import PlanningProfilePanel from '@/components/planning/PlanningProfilePanel.vue'
import PlanningRequirementBrief from '@/components/planning/PlanningRequirementBrief.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { usePlanningAgentStore } from '@/stores/planningAgent'
import type { PlanningAssessmentAnswer, PlanningRequirementBrief as RequirementBrief } from '@/types/product'
import { isAssessmentStage } from '@/utils/planning-flow'

const route = useRoute(); const router = useRouter(); const planning = usePlanningAgentStore(); const session = computed(() => planning.session); const uploadingResume = ref(false); const resumeUploadError = ref<string | null>(null); const requirementsTarget = ref<HTMLElement | null>(null); const assessmentStage = computed(() => Boolean(session.value && isAssessmentStage(session.value.stage))); const showAssessment = computed(() => assessmentStage.value || Boolean(planning.assessment && ['completed', 'abandoned'].includes(planning.assessment.status))); const requirementsStage = computed(() => Boolean(session.value && ['requirements', 'requirements_review', 'ready'].includes(session.value.stage)))
async function restore() {
  const loaded = await planning.load(String(route.params.sessionId))
  if (loaded?.roadmapGeneration?.status === 'succeeded' && loaded.roadmapGeneration.roadmapId) await router.replace({ name: 'roadmap-preview', params: { roadmapId: loaded.roadmapGeneration.roadmapId } })
}
onMounted(() => void restore())
watch(() => route.params.sessionId, (id, previous) => { if (id && id !== previous) void restore() })
watch(() => [planning.generation?.status, planning.generation?.roadmapId] as const, ([status, roadmapId]) => { if (status === 'succeeded' && roadmapId && route.name === 'planning') void router.replace({ name: 'roadmap-preview', params: { roadmapId } }) })
async function focusRequirements() { await nextTick(); requirementsTarget.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }); requirementsTarget.value?.focus({ preventScroll: true }) }
watch(() => session.value?.stage, (stage, previous) => { if (previous && isAssessmentStage(previous) && (stage === 'requirements' || stage === 'requirements_review')) void focusRequirements() })
async function upload(payload: { file: File | null; valid: boolean }) {
  if (!payload.valid || !payload.file || !session.value) return
  uploadingResume.value = true; resumeUploadError.value = null
  try {
    session.value.resume = await uploadPlanningResume(session.value.id, payload.file)
    planning.clearResumeNotice()
    void planning.pollResumeStatus(session.value.id)
  } catch (error) {
    if (hasApiErrorCode(error, 'resume_text_unavailable')) planning.resumeNotice = 'PDF 中没有可提取的文本，已跳过简历内容。你可以继续对话补充经历，或稍后上传含可复制文本的 PDF。'
    else resumeUploadError.value = error instanceof Error ? error.message : '简历上传失败，请重试。'
  } finally { uploadingResume.value = false }
}
async function generate() { const result = await planning.generate(); if (result?.roadmapId) await router.push({ name: 'roadmap-preview', params: { roadmapId: result.roadmapId } }) }
async function saveAssessment(answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]) { await planning.saveAssessmentAnswers(answers, skipped) }
async function completeAssessment(answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]) { await planning.saveAssessmentAnswers(answers, skipped); await planning.finalizeAssessment('complete') }
async function abandonAssessment(answers: Record<string, PlanningAssessmentAnswer>, skipped: string[]) { await planning.saveAssessmentAnswers(answers, skipped); await planning.finalizeAssessment('abandon') }
async function confirmBrief(brief: RequirementBrief) { await planning.confirmRequirementBrief(brief) }
</script>

<template>
  <div class="page planning-page"><AsyncState :loading="planning.streaming && !session" :error="planning.loadError"><template #default><PageHeader eyebrow="01 · Plan together" title="先聊清楚你想走向哪里。" description="把目标、经验和现实投入告诉 Planner。它会围绕关键未知继续追问，再整理成一张可以展开的能力路线图。" :meta="['基线 → 评估 → 需求 → 路线', '可恢复', '服务端判断是否可生成']" /><PlanningProgress v-if="session" :stage="session.stage" :progress="session.progress" /><div v-if="session" class="planning-layout"><main class="planning-main"><p v-if="planning.assessmentRecoveryNotice && showAssessment" class="recovery-notice" role="status">{{ planning.assessmentRecoveryNotice }}</p><PlanningAssessmentCard v-if="showAssessment" :assessment="planning.assessment" :compact="requirementsStage" :loading="planning.assessmentLoading" :saving="planning.assessmentSaving" :error="planning.assessmentError" :review="planning.assessmentReview" :review-loading="planning.reviewLoading" @retry="planning.retryAssessment" @save="saveAssessment" @complete="completeAssessment" @abandon="abandonAssessment" @review="planning.loadAssessmentReview" /><section v-if="requirementsStage" ref="requirementsTarget" class="requirements-flow" tabindex="-1" aria-label="需求确认"><div v-if="session.stage !== 'ready'" class="next-step-banner" role="status"><div class="eyebrow">Next step</div><strong>下一步：确认你的学习要求</strong><span>检查下方摘要；需要补充时直接继续对话，确认后才能生成路线。</span></div><PlanningRequirementBrief v-if="session.requirementBrief" :brief="session.requirementBrief" :saving="planning.requirementSaving" :error="planning.error" @confirm="confirmBrief" @revise="() => undefined" /></section><PlanningChat v-if="!assessmentStage" :messages="session.messages" :streaming-assistant="planning.streamingAssistant" :question="planning.question" :can-generate="session.readiness.canGenerateRoadmap" :readiness="session.readiness" :loading="planning.streaming" :generating="planning.generating" :generation="planning.generation" :error="planning.error" @send="planning.send" @generate="generate" @retry="planning.retry" @retry-generation="planning.retryGeneration" /></main><PlanningProfilePanel :session="session" :uploading="uploadingResume" :upload-error="resumeUploadError" :resume-notice="planning.resumeNotice" :resume-polling="planning.resumeParsing" :resume-poll-exhausted="planning.resumePollExhausted" :resume-poll-error="planning.resumePollError" @upload="upload" /></div></template></AsyncState></div>
</template>

<style scoped>
.planning-page { max-width: 1060px; }.planning-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, .75fr); gap: 30px; }.planning-main { min-width: 0; display: grid; gap: 22px; }.recovery-notice { margin: 0; padding: 9px 11px; border-left: 2px solid var(--blue); background: var(--blue-soft); color: var(--muted); font-size: 10px; line-height: 1.5; }.requirements-flow { scroll-margin-top: 24px; outline: none; }.next-step-banner { display: grid; gap: 5px; padding: 12px 13px; border-left: 2px solid var(--orange); background: var(--orange-soft); }.next-step-banner strong { color: var(--ink); font-size: 12px; }.next-step-banner span { color: var(--muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 760px) { .planning-layout { grid-template-columns: 1fr; gap: 22px; }.profile-panel { order: -1; } }
</style>
