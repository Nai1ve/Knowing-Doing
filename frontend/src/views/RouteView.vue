<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowRight, CheckCircle2 } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/shared/PageHeader.vue'
import RouteTree from '@/components/learning/RouteTree.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import { usePlanStore } from '@/stores/plan'

const planStore = usePlanStore()
const selectedId = ref(planStore.currentNode?.id ?? '')
const selectedNode = computed(() => planStore.milestones.flatMap((milestone) => milestone.nodes).find((node) => node.id === selectedId.value) ?? planStore.currentNode)
const selectedMilestone = computed(() => planStore.milestones.find((milestone) => milestone.nodes.some((node) => node.id === selectedId.value)) ?? planStore.currentMilestone)
const selectedAvailability = computed(() => planStore.productPlan?.units.find((unit) => unit.id === selectedNode.value?.id)?.availability ?? 'available')
onMounted(() => void planStore.loadPlan())
watch(() => planStore.currentNode?.id, (id) => { if (id) selectedId.value = id }, { immediate: true })
</script>

<template>
  <div class="page route-page">
    <AsyncState :loading="planStore.loading" :error="planStore.error">
    <template #default>
    <PageHeader eyebrow="02 · Map" title="整体路线是一条可回看的路径。" description="路线显示已经完成、当前可操作和后续开放的学习节点。每个节点都对应一份可回看的学习动作。" :meta="[planStore.productPlan?.title ?? '尚未建立计划', `${planStore.milestones.length} 个学习节点`, planStore.productPlan?.planState === 'pending_content' ? '内容筹备中' : '真实计划']" />
    <section v-if="planStore.productPlan" id="route-tree" class="route-tree-section"><RouteTree :milestones="planStore.milestones" :selected-node-id="selectedId" :goal="planStore.productPlan.goal" @select="selectedId = $event" /></section>
    <section v-else class="route-empty"><h2>还没有学习计划</h2><p>先完成诊断并确认一份路线，整体学习路径会显示在这里。</p><RouterLink to="/start">开始建立计划 <ArrowRight :size="14" aria-hidden="true" /></RouterLink></section>
    <section v-if="planStore.productPlan" id="route-selected" class="selected-node" aria-labelledby="selected-node-title"><div class="selected-copy"><div class="eyebrow">Selected node · {{ selectedMilestone?.index }}</div><h2 id="selected-node-title">{{ selectedNode?.title }}</h2><p>{{ selectedMilestone?.summary }}</p><div class="node-state"><span :class="selectedNode?.status"><CheckCircle2 :size="13" aria-hidden="true" />{{ selectedNode?.status === 'completed' ? '已完成' : selectedAvailability === 'coming_soon' ? '即将开放' : selectedNode?.status === 'current' ? '当前学习' : '后续节点' }}</span><span>预计 {{ selectedNode?.duration }}</span></div></div><RouterLink v-if="selectedNode?.status === 'current' && selectedAvailability === 'available'" :to="{ name: 'lesson', query: { planUnitId: selectedNode.id } }">进入当前节点 <ArrowRight :size="14" aria-hidden="true" /></RouterLink><span v-else class="route-hint">{{ selectedAvailability === 'coming_soon' ? '即将开放' : '当前节点完成后开放' }}</span></section>
    </template>
    </AsyncState>
  </div>
</template>

<style scoped>
.route-page { max-width: 970px; } .route-tree-section { margin-top: 26px; } .route-empty { margin-top: 28px; padding: 20px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); } .route-empty h2 { margin: 0; color: var(--ink); font: 400 23px var(--serif); } .route-empty p { margin: 8px 0 14px; color: var(--muted); font-size: 11px; } .route-empty a { display: inline-flex; align-items: center; gap: 6px; color: var(--blue); font-size: 10px; text-decoration: none; } .selected-node { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 21px; padding: 16px; border-top: 2px solid var(--orange); background: var(--orange-soft); } .selected-copy h2 { margin: 7px 0 0; color: #3e4844; font: 400 24px var(--serif); } .selected-copy p { max-width: 650px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; } .node-state { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 11px; color: #7b837e; font: 9px var(--mono); } .node-state span { display: inline-flex; align-items: center; gap: 5px; } .node-state .completed { color: var(--green); } .node-state .current { color: var(--orange); } .selected-node a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid #b66844; color: #995436; font-size: 10px; text-decoration: none; white-space: nowrap; } .selected-node a:hover { background: #f6e5db; } .route-hint { color: #8c776b; font-size: 10px; white-space: nowrap; }
@media (max-width: 650px) { .selected-node { align-items: stretch; flex-direction: column; } .selected-node a { justify-content: center; } .route-hint { white-space: normal; } }
</style>
