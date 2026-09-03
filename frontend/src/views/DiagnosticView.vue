<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import DiagnosticForm from '@/components/onboarding/DiagnosticForm.vue'
import { useDiagnosticStore } from '@/stores/diagnostic'

const route = useRoute(); const router = useRouter(); const diagnostic = useDiagnosticStore(); const sessionId = String(route.params.sessionId)
onMounted(() => void diagnostic.loadSession(sessionId))
async function submit(input: { goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }) { await diagnostic.save(sessionId, input); const proposal = await diagnostic.generateProposal(sessionId); await router.push({ name: 'plan-preview', params: { proposalId: proposal!.id } }) }
</script>

<template>
  <div class="page diagnostic-page"><AsyncState :loading="diagnostic.loading" :error="diagnostic.error"><template #default><PageHeader eyebrow="01 · Diagnose" title="用几项回答，校准你的学习起点。" description="知行不会替你猜测能力。你提供的信息会原样进入诊断记录，并影响后续路线的节奏和入口。" :meta="['5 项输入', '规则版本 diagnostic-v1']" /><DiagnosticForm v-if="diagnostic.session" :session="diagnostic.session" :submitting="diagnostic.submitting" :error="diagnostic.error" @back="router.push({ name: 'start' })" @submit="submit" /></template></AsyncState></div>
</template>

<style scoped>.diagnostic-page { max-width: 900px; }</style>
