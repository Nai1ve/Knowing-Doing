<script setup lang="ts">
import { ArrowRight, FileCheck2 } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import GoalCaptureForm from '@/components/onboarding/GoalCaptureForm.vue'
import { usePlanningAgentStore } from '@/stores/planningAgent'

const router = useRouter(); const planning = usePlanningAgentStore()
const state = computed(() => planning.state)
const pageLoading = computed(() => planning.stateLoading || planning.streaming)
const pageError = computed(() => planning.loadError || planning.error)
const agentState = computed(() => planning.state)
const agentGeneration = computed(() => agentState.value?.generation ?? null)
const agentResumeLabel = computed(() => {
  if (agentGeneration.value?.status === 'succeeded' && agentGeneration.value.roadmapId) return '路线草案已生成，等待确认'
  if (agentGeneration.value && ['queued', 'running'].includes(agentGeneration.value.status)) return '正在生成你的学习路线'
  if (agentGeneration.value && ['failed', 'interrupted'].includes(agentGeneration.value.status)) return '上次生成未完成，继续处理'
  return '继续你的规划对话'
})
onMounted(() => { void planning.loadState(true) })
async function start(input: { goal: string; resume?: File }) { const session = await planning.start(input.goal || '成为高级后端 + AI 应用工程师', input.resume); if (session) await router.push({ name: 'planning', params: { sessionId: session.id } }) }
async function regenerate() { const session = await planning.start(state.value?.currentPlan?.goal ?? '我想成为高级后端 + AI 应用工程师'); if (session) await router.push({ name: 'planning', params: { sessionId: session.id } }) }
</script>

<template>
  <div class="page start-page"><AsyncState :loading="pageLoading" :error="pageError"><template #default><PageHeader eyebrow="00 · Begin" title="先从一个目标开始。" description="知行会通过一段可恢复的规划对话，逐步确认你的方向、经验和投入，再生成一份可以确认的学习路线。" :meta="['无需登录', '规划对话', '可随时返回']" />
    <section v-if="state?.currentPlan" class="existing-state"><div><div class="eyebrow">Current plan</div><h2>{{ state.currentPlan.title }}</h2><p>{{ state.currentPlan.planState === 'pending_content' ? '这份计划已保存，相关学习内容正在准备中。' : '你已经有一份进行中的学习计划。' }}</p><small>重新规划会保留当前实践记录，并从新的对话开始。</small></div><div class="existing-actions"><RouterLink class="primary-button" :to="{ name: 'overview' }">进入总览 <ArrowRight :size="14" aria-hidden="true" /></RouterLink><button class="ghost-button" type="button" :disabled="planning.streaming" @click="regenerate">重新规划</button></div></section>
    <section v-else-if="state?.session" class="resume-state"><FileCheck2 :size="18" aria-hidden="true" /><div><strong>{{ agentResumeLabel }}</strong><p>{{ agentGeneration?.status === 'failed' || agentGeneration?.status === 'interrupted' ? (agentGeneration.failureMessage || '对话和已确认信息仍然保留，可以重新生成路线。') : '历史消息和已整理的信息已经保存，可以从上次位置继续。' }}</p></div><RouterLink v-if="agentGeneration?.status === 'succeeded' && agentGeneration.roadmapId" class="ghost-button" :to="{ name: 'roadmap-preview', params: { roadmapId: agentGeneration.roadmapId } }">查看路线草案 <ArrowRight :size="13" aria-hidden="true" /></RouterLink><RouterLink v-else class="ghost-button" :to="{ name: 'planning', params: { sessionId: state.session.id } }">{{ agentGeneration?.status === 'failed' || agentGeneration?.status === 'interrupted' ? '继续处理' : agentGeneration?.status === 'running' || agentGeneration?.status === 'queued' ? '查看进度' : '继续对话' }} <ArrowRight :size="13" aria-hidden="true" /></RouterLink></section>
    <GoalCaptureForm v-else :submitting="pageLoading" :error="pageError" @submit="start" />
    <div class="start-note"><span>目标</span><span>规划对话</span><span>路线草案</span><span>确认后才会进入学习</span></div>
    </template></AsyncState></div>
</template>

<style scoped>
.start-page { max-width: 900px; }.existing-state, .resume-state { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 28px; padding: 18px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.existing-state h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.existing-state p, .existing-state small, .resume-state p { display: block; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }.existing-state small { font-size: 9px; }.existing-state a, .existing-state button, .resume-state a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; white-space: nowrap; }.existing-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }.resume-state { justify-content: start; border-top-color: var(--blue); }.resume-state > svg { flex: 0 0 auto; color: var(--blue); }.resume-state > a { margin-left: auto; }.resume-state strong { color: var(--ink); font-size: 12px; font-weight: 500; }.start-note { display: flex; flex-wrap: wrap; gap: 13px; margin-top: 25px; color: var(--muted); font: 9px var(--mono); }.start-note span + span::before { content: '→'; margin-right: 13px; color: var(--orange); }
@media (max-width: 600px) { .existing-state, .resume-state { align-items: stretch; flex-direction: column; }.existing-actions { align-items: stretch; flex-direction: column; }.existing-actions a, .existing-actions button { justify-content: center; }.resume-state > a { margin-left: 0; } }
</style>
