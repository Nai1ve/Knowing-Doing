<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { uploadPlanningResume } from '@/api/planningService'
import PlanningChat from '@/components/planning/PlanningChat.vue'
import PlanningProfilePanel from '@/components/planning/PlanningProfilePanel.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { usePlanningAgentStore } from '@/stores/planningAgent'

const route = useRoute(); const router = useRouter(); const planning = usePlanningAgentStore(); const session = computed(() => planning.session)
async function restore() {
  const loaded = await planning.load(String(route.params.sessionId))
  if (loaded.roadmapGeneration?.status === 'succeeded' && loaded.roadmapGeneration.roadmapId) await router.replace({ name: 'roadmap-preview', params: { roadmapId: loaded.roadmapGeneration.roadmapId } })
}
onMounted(() => void restore())
watch(() => route.params.sessionId, (id, previous) => { if (id && id !== previous) void restore() })
watch(() => [planning.generation?.status, planning.generation?.roadmapId] as const, ([status, roadmapId]) => { if (status === 'succeeded' && roadmapId && route.name === 'planning') void router.replace({ name: 'roadmap-preview', params: { roadmapId } }) })
async function upload(payload: { file: File | null; valid: boolean }) { if (payload.valid && payload.file && session.value) session.value.resume = await uploadPlanningResume(session.value.id, payload.file) as typeof session.value.resume }
async function generate() { const result = await planning.generate(); if (result?.roadmapId) await router.push({ name: 'roadmap-preview', params: { roadmapId: result.roadmapId } }) }
</script>

<template>
  <div class="page planning-page"><AsyncState :loading="planning.streaming && !session" :error="planning.loadError"><template #default><PageHeader eyebrow="01 · Plan together" title="先聊清楚你想走向哪里。" description="把目标、经验和现实投入告诉 Planner。它会围绕关键未知继续追问，再整理成一张可以展开的能力路线图。" :meta="['自然表达', '动态追问', '随时生成路线']" /><div v-if="session" class="planning-layout"><PlanningChat :messages="session.messages" :streaming-assistant="planning.streamingAssistant" :question="planning.question" :can-generate="planning.canGenerateRoadmap" :loading="planning.streaming" :generating="planning.generating" :generation="planning.generation" :error="planning.error" @send="planning.send" @generate="generate" @retry="planning.retry" @retry-generation="planning.retryGeneration" /><PlanningProfilePanel :session="session" @upload="upload" /></div></template></AsyncState></div>
</template>

<style scoped>
.planning-page { max-width: 1060px; }.planning-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, .75fr); gap: 30px; }
@media (max-width: 760px) { .planning-layout { grid-template-columns: 1fr; gap: 22px; }.profile-panel { order: -1; } }
</style>
