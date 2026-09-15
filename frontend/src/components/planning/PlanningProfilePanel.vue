<script setup lang="ts">
import { CheckCircle2, FileText } from 'lucide-vue-next'
import { computed } from 'vue'
import ResumeUploadField from '@/components/onboarding/ResumeUploadField.vue'
import type { AgentPlanningSession, ProductResumeAttachment } from '@/types/product'
import { baselineProgress, baselineTurnMaximum, baselineTurnMinimum, planningStageLabel } from '@/utils/planning-flow'

const props = defineProps<{ session: AgentPlanningSession; uploading?: boolean; uploadError?: string | null; resumeNotice?: string | null; resumePolling?: boolean; resumePollExhausted?: boolean; resumePollError?: string | null; degraded?: boolean }>()
const emit = defineEmits<{ upload: [payload: { file: File | null; valid: boolean }] }>()
const sourceLabels: Record<string, string> = { user_message: '对话', resume: '简历', diagnostic_assessment: '诊断评估', 'lab/workspace_verification': '实践验证', 'lab/workspace verification': '实践验证', lab_verification: '实践验证', workspace_verification: '实践验证' }
function resumeStatusLabel(status: ProductResumeAttachment['parseStatus']) {
  return status === 'pending' ? '等待解析' : status === 'processing' ? '解析中' : status === 'ready' ? '完成' : '解析失败'
}
function resumeStatusClass(status: NonNullable<AgentPlanningSession['resume']>['parseStatus']) { return `resume-status-${status}` }
/** Human-readable stage detail. Never exposes provider task ids or raw errors. */
const resumeStatusDetail = computed<{ note: string; kind: string } | null>(() => {
  const resume = props.session.resume
  if (!resume) return null
  if (resume.parseStatus === 'pending') return { kind: 'pending', note: 'PDF 已上传，排队等待解析；刷新页面会继续显示真实进度。' }
  if (resume.parseStatus === 'processing') return { kind: 'processing', note: '正在提取 PDF 文本，通常需要几秒钟。' }
  if (resume.parseStatus === 'ready') {
    if (!resume.includedInPlanningContext) return { kind: 'consolidating', note: '已解析，正在整理画像并纳入规划上下文…' }
    if (props.degraded) return { kind: 'degraded', note: '已用本地备选方案完成解析，内容质量可能低于云端解析。' }
    return { kind: 'ready', note: '已解析并纳入规划上下文。' }
  }
  return { kind: 'failed', note: '未能解析该 PDF，可重新选择文件重试，已保存的学习内容不受影响。' }
})
function progressLabel() {
  const progress = props.session.stage === 'baseline' ? baselineProgress(props.session.progress) : props.session.progress
  if (props.session.stage === 'baseline') return `第 ${progress.current} / ${progress.total} 轮 · 至少 ${baselineTurnMinimum} 轮，最多 ${Math.max(progress.total, baselineTurnMaximum)} 轮`
  return `${progress.completed} / ${progress.total} 已完成`
}
</script>

<template>
  <aside class="profile-panel" aria-labelledby="profile-panel-title"><div class="panel-heading"><CheckCircle2 :size="15" aria-hidden="true" /><span id="profile-panel-title">画像正在形成</span></div><div class="goal"><small>当前目标</small><strong>{{ props.session.goal }}</strong></div><div class="stage-progress"><small>当前阶段</small><strong>{{ planningStageLabel(props.session.stage) }}</strong><span>{{ progressLabel() }}</span></div><div v-if="props.session.profile?.dimensions.length" class="dimensions"><small>能力线索</small><div v-for="dimension in props.session.profile.dimensions" :key="dimension.key" class="dimension"><strong>{{ dimension.key }}</strong><span>{{ dimension.summary }}</span></div></div><div v-if="props.session.profile?.evidence.length" class="evidence-badges"><small>证据来源</small><div class="badge-list"><span v-for="source in props.session.profile.evidence" :key="source.id" class="source-badge">{{ sourceLabels[source.sourceType] ?? source.sourceType }}</span></div></div><div v-if="props.session.resume || props.uploading" class="resume-card" aria-live="polite"><div class="resume-card-heading"><FileText :size="14" aria-hidden="true" /><span>PDF 简历</span><strong v-if="props.uploading" class="resume-status resume-status-uploading">上传中</strong><strong v-else-if="props.session.resume" class="resume-status" :class="resumeStatusClass(props.session.resume.parseStatus)">{{ resumeStatusLabel(props.session.resume.parseStatus) }}</strong></div><div v-if="props.session.resume" class="resume-attached"><span>{{ props.session.resume.originalFilename }}</span><small>第 {{ props.session.resume.version }} 版 · {{ props.session.resume.pageCount || '—' }} 页 · {{ props.session.resume.textLength || '—' }} 字 · {{ props.session.resume.includedInPlanningContext ? '已纳入规划上下文' : '尚未纳入规划上下文' }}</small></div><p v-if="props.resumePolling" class="upload-state">正在等待解析结果…</p><p v-else-if="props.resumePollExhausted" class="resume-notice">自动查询已暂停，稍后刷新页面可继续查询。</p><p v-else-if="props.resumePollError" class="resume-notice">{{ props.resumePollError }}</p><p v-else-if="resumeStatusDetail" class="resume-detail" :class="`resume-detail-${resumeStatusDetail.kind}`">{{ resumeStatusDetail.note }}</p></div><ResumeUploadField :disabled="props.uploading" :current-name="props.session.resume?.originalFilename" @change="emit('upload', $event)" /><p v-if="props.resumeNotice" class="resume-notice" role="status">{{ props.resumeNotice }}</p><p v-if="props.uploadError" class="upload-error" role="alert">{{ props.uploadError }}</p><p class="panel-note">路线生成由服务端门禁控制：测评结束并确认需求摘要后才会开放。</p></aside>
</template>

<style scoped>
.profile-panel { align-self: start; padding: 15px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.panel-heading { display: flex; align-items: center; gap: 8px; color: var(--blue); font: 9px var(--mono); text-transform: uppercase; }.goal { margin-top: 20px; }.goal small, .dimensions > small, .stage-progress small, .evidence-badges > small { color: var(--muted); font: 9px var(--mono); }.goal strong { display: block; margin-top: 7px; color: var(--ink); font: 400 18px/1.35 var(--serif); }.stage-progress { display: grid; gap: 4px; margin-top: 18px; padding: 10px; background: var(--paper-muted); }.stage-progress strong { color: var(--ink); font-size: 11px; font-weight: 500; }.stage-progress span { color: var(--muted); font: 9px var(--mono); }.topic-list { display: grid; gap: 11px; margin-top: 22px; }.topic { display: flex; align-items: start; gap: 8px; }.topic-mark { display: inline-flex; padding-top: 1px; color: var(--muted); }.topic-mark.covered { color: var(--green); }.topic strong { display: block; color: #4d5a53; font-size: 11px; font-weight: 500; }.topic small { display: block; margin-top: 3px; color: var(--muted); font: 8px var(--mono); }.dimensions { display: grid; gap: 8px; margin-top: 22px; padding-top: 13px; border-top: 1px solid var(--line); }.dimension { display: grid; gap: 3px; }.dimension strong { color: #4d5a53; font-size: 10px; }.dimension span { color: var(--muted); font-size: 10px; line-height: 1.5; }.evidence-badges { display: grid; gap: 8px; margin-top: 20px; padding-top: 13px; border-top: 1px solid var(--line); }.badge-list { display: flex; flex-wrap: wrap; gap: 5px; }.source-badge { padding: 4px 6px; background: var(--blue-soft); color: var(--blue); font: 8px var(--mono); }.resume-card { display: grid; gap: 8px; margin-top: 20px; padding-top: 13px; border-top: 1px solid var(--line); }.resume-card-heading { display: flex; align-items: center; gap: 7px; color: var(--ink); font-size: 10px; }.resume-card-heading .resume-status { margin-left: auto; }.resume-status { color: var(--green); font: 8px var(--mono); }.resume-status-pending, .resume-status-processing, .resume-status-uploading { color: var(--blue); }.resume-status-failed { color: var(--red); }.resume-attached { display: grid; gap: 4px; color: var(--ink); font-size: 10px; }.resume-attached span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.resume-attached small { color: var(--muted); font: 8px var(--mono); }.upload-state, .resume-notice, .upload-error, .resume-detail { margin: 0; font: 9px/1.55 var(--mono); }.upload-state { color: var(--blue); }.resume-notice { color: #936c18; }.upload-error { color: var(--red); }.resume-detail { color: var(--muted); }.resume-detail-degraded { color: #936c18; }.resume-detail-failed, .resume-detail-consolidating { color: var(--blue); }.panel-note { margin: 22px 0 0; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font: 10px/1.6 var(--mono); }
</style>
