<script setup lang="ts">
import { ArrowRight, Clock3, FileCheck2 } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import GoalCaptureForm from '@/components/onboarding/GoalCaptureForm.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { usePlanningConversationStore } from '@/stores/planningConversation'

const router = useRouter(); const onboarding = useOnboardingStore(); const planning = usePlanningConversationStore()
const state = computed(() => onboarding.state)
const pageLoading = computed(() => onboarding.loading || planning.loading)
const pageError = computed(() => onboarding.error || planning.error)
onMounted(() => void onboarding.load())
async function start(input: { targetKey: 'mysql_performance' | 'general'; goal: string; resume?: File }) { const session = await planning.start(input.goal || '成为高级后端 + AI 应用工程师', input.resume); await router.push({ name: 'planning', params: { sessionId: session.id } }) }
async function startDefault() { const session = await planning.start(state.value?.currentPlan?.goal ?? '成为高级后端 + AI 应用工程师'); await router.push({ name: 'planning', params: { sessionId: session.id } }) }
async function regenerate() { const session = await planning.start(state.value?.currentPlan?.goal ?? '成为高级后端 + AI 应用工程师'); await router.push({ name: 'planning', params: { sessionId: session.id } }) }
</script>

<template>
  <div class="page start-page"><AsyncState :loading="pageLoading" :error="pageError"><template #default><PageHeader eyebrow="00 · Begin" title="先从一个目标开始。" description="知行会把你想学的内容、当前起点和可投入时间整理成一份可以确认的学习计划。" :meta="['无需登录', '规则生成', '可随时返回']" />
    <section v-if="state?.status === 'has_plan'" class="existing-state"><div><div class="eyebrow">Current plan</div><h2>{{ state.currentPlan?.title }}</h2><p>{{ state.currentPlan?.planState === 'pending_content' ? '这份计划已保存，相关学习内容正在准备中。' : '你已经有一份进行中的学习计划。' }}</p><small>重新生成会保留当前实践记录，并从新的诊断输入开始。</small></div><div class="existing-actions"><RouterLink class="primary-button" :to="{ name: 'overview' }">进入总览 <ArrowRight :size="14" aria-hidden="true" /></RouterLink><button class="ghost-button" type="button" :disabled="onboarding.loading" @click="regenerate">重新生成计划</button></div></section>
    <section v-else-if="state?.status === 'diagnostic_in_progress'" class="resume-state"><FileCheck2 :size="18" aria-hidden="true" /><div><strong>发现一份旧版诊断记录</strong><p>新版规划会话已经改为路线引导对话，原记录仍保留。</p></div><button class="ghost-button" type="button" :disabled="planning.loading" @click="startDefault">开始新版规划 <ArrowRight :size="13" aria-hidden="true" /></button></section>
    <section v-else-if="state?.status === 'proposal_ready'" class="resume-state"><Clock3 :size="18" aria-hidden="true" /><div><strong>你还有一份旧计划草案</strong><p>新路线使用规划对话生成，旧草案仍保留作兼容记录。</p></div><RouterLink class="ghost-button" to="/start">重新开始规划 <ArrowRight :size="13" aria-hidden="true" /></RouterLink></section>
    <GoalCaptureForm v-else :submitting="pageLoading" :error="pageError" @submit="start" />
    <div class="start-note"><span>目标</span><span>诊断</span><span>计划草案</span><span>确认后才会进入学习</span></div>
    </template></AsyncState></div>
</template>

<style scoped>
.start-page { max-width: 900px; }.existing-state, .resume-state { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 28px; padding: 18px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.existing-state h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.existing-state p, .existing-state small, .resume-state p { display: block; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }.existing-state small { font-size: 9px; }.existing-state a, .existing-state button, .resume-state a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; white-space: nowrap; }.existing-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }.resume-state { justify-content: start; border-top-color: var(--blue); }.resume-state > svg { flex: 0 0 auto; color: var(--blue); }.resume-state > a { margin-left: auto; }.resume-state strong { color: var(--ink); font-size: 12px; font-weight: 500; }.start-note { display: flex; flex-wrap: wrap; gap: 13px; margin-top: 25px; color: var(--muted); font: 9px var(--mono); }.start-note span + span::before { content: '→'; margin-right: 13px; color: var(--orange); }
@media (max-width: 600px) { .existing-state, .resume-state { align-items: stretch; flex-direction: column; }.existing-actions { align-items: stretch; flex-direction: column; }.existing-actions a, .existing-actions button { justify-content: center; }.resume-state > a { margin-left: 0; } }
</style>
