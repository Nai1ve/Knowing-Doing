<script setup lang="ts">
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import PlanProposalUnits from '@/components/onboarding/PlanProposalUnits.vue'
import { useDiagnosticStore } from '@/stores/diagnostic'
import { usePlanStore } from '@/stores/plan'

const route = useRoute(); const router = useRouter(); const diagnostic = useDiagnosticStore(); const planStore = usePlanStore(); const proposalId = String(route.params.proposalId)
const proposal = computed(() => diagnostic.proposal); const pending = computed(() => proposal.value?.planSnapshot.planState === 'pending_content')
onMounted(() => void diagnostic.loadProposal(proposalId))
async function confirm() { await diagnostic.confirm(proposalId); await planStore.loadPlan(true); await router.push({ name: 'overview' }) }
</script>

<template>
  <div class="page preview-page"><AsyncState :loading="diagnostic.loading" :error="diagnostic.error"><template #default><template v-if="proposal"><PageHeader eyebrow="02 · Review" title="这是一份可以确认的学习计划。" :description="pending ? '这份路线先保存你的学习方向；匹配的学习内容接入后，才会开放具体实践。' : '先看看路线如何安排，再决定是否把它加入你的学习计划。'" :meta="[proposal.planSnapshot.title, `规则 ${proposal.rulesVersion}`, pending ? '待实施' : '可进入学习']" /><section class="proposal-head"><div><span class="eyebrow">Learning goal</span><h2 id="proposal-title">{{ proposal.planSnapshot.goal }}</h2></div><span class="proposal-state"><LockKeyhole v-if="pending" :size="13" aria-hidden="true" /><CheckCircle2 v-else :size="13" aria-hidden="true" />{{ pending ? '内容筹备中' : '首个单元可实践' }}</span></section><section class="proposal-grid"><div><div class="section-label">学习路线</div><PlanProposalUnits :units="proposal.planSnapshot.units" /></div><aside id="proposal-rationale"><div class="section-label">安排依据</div><ul><li v-for="item in proposal.rationale" :key="item.key"><strong>{{ item.label }}</strong><p>{{ item.effect }}</p></li></ul></aside></section><footer class="preview-actions"><RouterLink class="ghost-button" :to="{ name: 'diagnostic', params: { sessionId: proposal.diagnosticSessionId } }"><ArrowLeft :size="13" aria-hidden="true" />返回修改输入</RouterLink><button class="primary-button" type="button" :disabled="diagnostic.submitting" @click="confirm"><ArrowRight :size="14" aria-hidden="true" />{{ diagnostic.submitting ? '确认中…' : '确认这份计划' }}</button></footer></template></template></AsyncState></div>
</template>

<style scoped>
.preview-page { max-width: 950px; }.proposal-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-top: 25px; padding-bottom: 17px; border-bottom: 1px solid var(--line); }.proposal-head h2 { max-width: 720px; margin: 8px 0 0; color: var(--ink); font: 400 25px var(--serif); }.proposal-state { display: inline-flex; align-items: center; gap: 5px; color: var(--orange); font: 9px var(--mono); white-space: nowrap; }.proposal-state svg { color: var(--orange); }.proposal-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(240px, .65fr); gap: 35px; margin-top: 24px; }.section-label { margin-bottom: 8px; color: var(--muted); font: 9px var(--mono); text-transform: uppercase; }.proposal-grid aside { padding-left: 20px; border-left: 1px solid var(--line); }.proposal-grid ul { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }.proposal-grid li { padding: 11px 0; border-bottom: 1px solid var(--line-soft); }.proposal-grid li strong { color: #48514e; font-size: 11px; font-weight: 500; }.proposal-grid li p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.preview-actions { display: flex; justify-content: space-between; gap: 15px; margin-top: 25px; padding-top: 15px; border-top: 1px solid var(--line); }.preview-actions a, .preview-actions button { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
@media (max-width: 720px) { .proposal-grid { grid-template-columns: 1fr; gap: 20px; }.proposal-grid aside { padding: 18px 0 0; border-top: 1px solid var(--line); border-left: 0; } }.preview-actions { flex-wrap: wrap; }
</style>
