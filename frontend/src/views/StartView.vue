<script setup lang="ts">
import { ArrowRight, Clock3, FileCheck2 } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import GoalCaptureForm from '@/components/onboarding/GoalCaptureForm.vue'
import { useOnboardingStore } from '@/stores/onboarding'

const router = useRouter(); const onboarding = useOnboardingStore()
const state = computed(() => onboarding.state)
onMounted(() => void onboarding.load())
async function start(input: { targetKey: 'mysql_performance' | 'general'; goal: string }) { const session = await onboarding.start(input.targetKey, input.goal); await router.push({ name: 'diagnostic', params: { sessionId: session.id } }) }
</script>

<template>
  <div class="page start-page"><AsyncState :loading="onboarding.loading" :error="onboarding.error"><template #default><PageHeader eyebrow="00 · Begin" title="先从一个目标开始。" description="知行会把你想学的内容、当前起点和可投入时间整理成一份可以确认的学习计划。" :meta="['无需登录', '规则生成', '可随时返回']" />
    <section v-if="state?.status === 'has_plan'" class="existing-state"><div><div class="eyebrow">Current plan</div><h2>{{ state.currentPlan?.title }}</h2><p>{{ state.currentPlan?.planState === 'pending_content' ? '这份计划已保存，相关学习内容正在准备中。' : '你已经有一份进行中的学习计划。' }}</p></div><RouterLink class="primary-button" :to="{ name: 'overview' }">进入总览 <ArrowRight :size="14" aria-hidden="true" /></RouterLink></section>
    <section v-else-if="state?.status === 'diagnostic_in_progress'" class="resume-state"><FileCheck2 :size="18" aria-hidden="true" /><div><strong>你的诊断还没有完成</strong><p>已保存目标，可以继续填写剩余信息。</p></div><RouterLink class="ghost-button" :to="{ name: 'diagnostic', params: { sessionId: state.diagnosticSession?.id } }">继续诊断 <ArrowRight :size="13" aria-hidden="true" /></RouterLink></section>
    <section v-else-if="state?.status === 'proposal_ready'" class="resume-state"><Clock3 :size="18" aria-hidden="true" /><div><strong>你的计划草案已准备好</strong><p>确认前可以回看安排理由和每个学习单元。</p></div><RouterLink class="ghost-button" :to="{ name: 'plan-preview', params: { proposalId: state.proposal?.id } }">查看草案 <ArrowRight :size="13" aria-hidden="true" /></RouterLink></section>
    <GoalCaptureForm v-else :submitting="onboarding.loading" :error="onboarding.error" @submit="start" />
    <div class="start-note"><span>目标</span><span>诊断</span><span>计划草案</span><span>确认后才会进入学习</span></div>
    </template></AsyncState></div>
</template>

<style scoped>
.start-page { max-width: 900px; }.existing-state, .resume-state { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 28px; padding: 18px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.existing-state h2 { margin: 7px 0 0; color: var(--ink); font: 400 23px var(--serif); }.existing-state p, .resume-state p { margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }.existing-state a, .resume-state a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; white-space: nowrap; }.resume-state { justify-content: start; border-top-color: var(--blue); }.resume-state > svg { flex: 0 0 auto; color: var(--blue); }.resume-state > a { margin-left: auto; }.resume-state strong { color: var(--ink); font-size: 12px; font-weight: 500; }.start-note { display: flex; flex-wrap: wrap; gap: 13px; margin-top: 25px; color: var(--muted); font: 9px var(--mono); }.start-note span + span::before { content: '→'; margin-right: 13px; color: var(--orange); }
@media (max-width: 600px) { .existing-state, .resume-state { align-items: stretch; flex-direction: column; }.resume-state > a { margin-left: 0; } }
</style>
