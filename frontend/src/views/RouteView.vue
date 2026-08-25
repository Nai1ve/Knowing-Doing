<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, CheckCircle2 } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/shared/PageHeader.vue'
import RouteTree from '@/components/learning/RouteTree.vue'
import { usePlanStore } from '@/stores/plan'

const planStore = usePlanStore()
const selectedId = ref(planStore.currentNode?.id ?? 'replicaset')
const selectedNode = computed(() => planStore.milestones.flatMap((milestone) => milestone.nodes).find((node) => node.id === selectedId.value) ?? planStore.currentNode)
const selectedMilestone = computed(() => planStore.milestones.find((milestone) => milestone.nodes.some((node) => node.id === selectedId.value)) ?? planStore.currentMilestone)
</script>

<template>
  <div class="page route-page">
    <PageHeader eyebrow="02 · Map" title="整体路线是一棵树。" description="线性学习只代表你今天的入口，知识树保留技术之间的依赖、分支和迁移关系。点击任意节点查看它在系统中的位置。" :meta="['Kubernetes', `${planStore.milestones.length} 个里程碑`, '树形路线']" />
    <section id="route-tree" class="route-tree-section"><RouteTree :milestones="planStore.milestones" :selected-node-id="selectedId" @select="selectedId = $event" /></section>
    <section id="route-selected" class="selected-node" aria-labelledby="selected-node-title"><div class="selected-copy"><div class="eyebrow">Selected node · {{ selectedMilestone?.index }}</div><h2 id="selected-node-title">{{ selectedNode?.title }}</h2><p>{{ selectedMilestone?.summary }}。这个节点要回答的是：当前状态为什么会这样，以及哪个控制器或证据能说明下一步。</p><div class="node-state"><span :class="selectedNode?.status"><CheckCircle2 :size="13" aria-hidden="true" />{{ selectedNode?.status === 'completed' ? '已完成' : selectedNode?.status === 'current' ? '当前学习' : '后续节点' }}</span><span>预计 {{ selectedNode?.duration }}</span></div></div><RouterLink v-if="selectedNode?.status === 'current'" :to="{ name: 'lesson' }">进入当前节点 <ArrowRight :size="14" aria-hidden="true" /></RouterLink><span v-else class="route-hint">当前学习从橙色节点开始</span></section>
  </div>
</template>

<style scoped>
.route-page { max-width: 970px; } .route-tree-section { margin-top: 26px; } .selected-node { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 21px; padding: 16px; border-top: 2px solid var(--orange); background: var(--orange-soft); } .selected-copy h2 { margin: 7px 0 0; color: #3e4844; font: 400 24px var(--serif); } .selected-copy p { max-width: 650px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; } .node-state { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 11px; color: #7b837e; font: 9px var(--mono); } .node-state span { display: inline-flex; align-items: center; gap: 5px; } .node-state .completed { color: var(--green); } .node-state .current { color: var(--orange); } .selected-node a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid #b66844; color: #995436; font-size: 10px; text-decoration: none; white-space: nowrap; } .selected-node a:hover { background: #f6e5db; } .route-hint { color: #8c776b; font-size: 10px; white-space: nowrap; }
@media (max-width: 650px) { .selected-node { align-items: stretch; flex-direction: column; } .selected-node a { justify-content: center; } .route-hint { white-space: normal; } }
</style>
