<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { uploadPlanningResume } from '@/api/planningService'
import PlanningChat from '@/components/planning/PlanningChat.vue'
import PlanningProfilePanel from '@/components/planning/PlanningProfilePanel.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { usePlanningAgentStore } from '@/stores/planningAgent'

const route = useRoute(); const router = useRouter(); const planning = usePlanningAgentStore(); const session = computed(() => planning.session)
onMounted(() => void planning.load(String(route.params.sessionId)))
async function upload(payload: { file: File | null; valid: boolean }) { if (payload.valid && payload.file && session.value) session.value.resume = await uploadPlanningResume(session.value.id, payload.file) as typeof session.value.resume }
async function generate() { const result = await planning.generate(); if (result?.roadmapId) await router.push({ name: 'roadmap-preview', params: { roadmapId: result.roadmapId } }) }
</script>

<template>
  <div class="page planning-page"><AsyncState :loading="planning.streaming && !session" :error="planning.error"><template #default><PageHeader eyebrow="01 · Plan together" title="先聊清楚你想走向哪里。" description="把目标、经验和现实投入告诉 Planner。它会围绕关键未知继续追问，再整理成一张可以展开的能力路线图。" :meta="['自然表达', '动态追问', '随时生成路线']" /><div v-if="session" class="planning-layout"><PlanningChat :messages="session.messages" :streaming-assistant="planning.streamingAssistant" :question="planning.question" :loading="planning.streaming" :generating="planning.generating" @send="planning.send" @generate="generate" @retry="planning.retry" /><PlanningProfilePanel :session="session" @upload="upload" /></div></template></AsyncState></div>
</template>

<style scoped>
.planning-page { max-width: 1060px; }.planning-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, .75fr); gap: 30px; }
@media (max-width: 760px) { .planning-layout { grid-template-columns: 1fr; gap: 22px; }.profile-panel { order: -1; } }
</style>
