<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowRight, BookOpen, CheckCircle2, FlaskConical, LockKeyhole } from 'lucide-vue-next'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import RoadmapMindmap from '@/components/roadmap/RoadmapMindmap.vue'
import { useRoadmapStore } from '@/stores/roadmap'
import type { RoadmapNode } from '@/types/product'

const route = useRoute(); const router = useRouter(); const roadmap = useRoadmapStore(); const selectedId = ref(String(route.params.nodeId ?? '')); const openIds = ref<string[]>([])
const current = computed(() => roadmap.current); const roots = computed(() => current.value?.roots ?? [])
const visibleNodes = computed(() => {
  const result: RoadmapNode[] = []
  function append(nodes: RoadmapNode[]) {
    nodes.forEach((node) => { result.push(node); if (openIds.value.includes(node.id)) append(roadmap.children[node.id] ?? []) })
  }
  append(roots.value)
  return result
})
const selected = computed(() => visibleNodes.value.find((node) => node.id === selectedId.value) ?? roots.value[0] ?? null)
const currentNodeId = computed(() => current.value?.currentPlan?.units.find((item) => item.status === 'current')?.roadmapNodeId ?? null)

onMounted(async () => { await roadmap.loadCurrent(); if (!selectedId.value && roots.value[0]) selectedId.value = roots.value[0].id })
watch(() => route.params.nodeId, (id) => { if (typeof id === 'string' && id) selectedId.value = id })

async function selectNode(node: RoadmapNode) {
  selectedId.value = node.id
  if (current.value?.roadmap && route.params.nodeId !== node.id) await router.push({ name: 'roadmap-node', params: { roadmapId: current.value.roadmap.id, nodeId: node.id } })
}
async function toggleNode(node: RoadmapNode) {
  await selectNode(node)
  if (!current.value?.roadmap || !node.childCount) return
  if (openIds.value.includes(node.id)) openIds.value = openIds.value.filter((id) => id !== node.id)
  else { await roadmap.loadChildren(current.value.roadmap.id, node.id); openIds.value = [...openIds.value, node.id] }
}
function statusLabel(node: RoadmapNode) { if (node.status === 'verified') return '已验证'; if (node.status === 'completed') return '已完成'; if (node.status === 'self_reported') return '自报掌握'; if (node.status === 'in_progress') return '学习中'; if (node.status === 'available') return '可开始'; return '后续开放' }
function statusIcon(node: RoadmapNode) { return node.status === 'locked' ? LockKeyhole : node.learningMode === 'lab' ? FlaskConical : node.status === 'completed' || node.status === 'verified' ? CheckCircle2 : BookOpen }
async function complete() { if (selected.value && current.value?.roadmap && selected.value.learningMode !== 'lab') await roadmap.complete(current.value.roadmap.id, selected.value) }
</script>

<template>
  <div class="page roadmap-page"><AsyncState :loading="roadmap.loading" :error="roadmap.error"><template #default><PageHeader eyebrow="02 · Roadmap" title="一张会随着实践点亮的能力地图。" description="路线图保留长期方向，当前计划会在其中标出下一步。展开一个分支，沿着能力之间的关系继续看下去。" :meta="[current?.roadmap?.goal ?? '尚未建立路线', (current?.roadmap?.progress.completed ?? 0) + ' / ' + (current?.roadmap?.progress.total ?? 0) + ' 已完成', '按需展开']" />
    <template v-if="current?.roadmap"><RoadmapMindmap :goal="current.roadmap.goal" :nodes="visibleNodes" :selected-id="selected?.id ?? ''" :open-ids="openIds" :current-node-id="currentNodeId" @select="selectNode" @toggle="toggleNode" />
      <aside v-if="selected" class="node-inspector" aria-labelledby="route-selected"><div class="inspector-heading"><div><span class="node-eyebrow"><component :is="statusIcon(selected)" :size="14" aria-hidden="true" />{{ selected.nodeType === 'domain' ? '能力域' : selected.nodeType === 'capability' ? '能力分支' : '学习节点' }} · {{ statusLabel(selected) }}</span><h2 id="route-selected">{{ selected.title }}</h2></div><span v-if="selected.id === currentNodeId" class="current-tag">当前学习</span></div><p class="node-summary">{{ selected.summary }}</p><div class="node-facts"><div><small>完成标准</small><p>{{ selected.completionStandard }}</p></div><div><small>预计投入</small><p>{{ selected.estimatedMinutes }} 分钟</p></div></div><div v-if="selected.knowledgeCard.keyPoints?.length" class="knowledge-card"><small>知识卡</small><ul><li v-for="point in selected.knowledgeCard.keyPoints" :key="point">{{ point }}</li></ul></div><div class="node-action"><RouterLink v-if="selected.learningMode === 'lab' && current.currentPlan?.units.find((unit) => unit.roadmapNodeId === selected.id || unit.caseId === selected.caseId)" :to="{ name: 'lesson', query: { planUnitId: current.currentPlan.units.find((unit) => unit.roadmapNodeId === selected.id || unit.caseId === selected.caseId)?.id } }"><FlaskConical :size="14" aria-hidden="true" />进入真实实践 <ArrowRight :size="13" aria-hidden="true" /></RouterLink><button v-else-if="['concept', 'project'].includes(selected.nodeType) && selected.learningMode !== 'lab' && selected.status === 'available'" class="primary-button" type="button" @click="complete"><CheckCircle2 :size="14" aria-hidden="true" />确认我已完成</button><span v-else class="node-hint">{{ selected.status === 'locked' ? '完成前置节点后开放' : selected.status === 'self_reported' ? '这是用户自报掌握，不等同于验证' : selected.status === 'completed' || selected.status === 'verified' ? '节点已完成，可以继续展开下一分支' : selected.nodeType === 'domain' || selected.nodeType === 'capability' ? '展开分支查看具体学习节点' : '关联实践完成后会自动验证' }}</span></div></aside></template><section v-else class="empty-roadmap"><h2>还没有路线图</h2><p>先完成规划对话，路线图会在这里展开。</p><RouterLink to="/start">开始规划 <ArrowRight :size="14" aria-hidden="true" /></RouterLink></section>
  </template></AsyncState></div>
</template>

<style scoped>
.roadmap-page { max-width: 1180px; }.node-inspector { display: grid; gap: 14px; margin-top: 20px; padding: 17px 18px; border-top: 2px solid var(--orange); background: var(--paper); }.inspector-heading { display: flex; align-items: start; justify-content: space-between; gap: 18px; }.node-eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--blue); font: 9px var(--mono); text-transform: uppercase; }.node-inspector h2 { margin: 9px 0 0; color: var(--ink); font: 400 27px/1.2 var(--serif); }.current-tag { flex: 0 0 auto; padding: 4px 7px; background: var(--green-soft); color: var(--green); font: 8px var(--mono); }.node-summary { max-width: 760px; margin: 0; color: #66716b; font-size: 12px; line-height: 1.7; }.node-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; padding: 13px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }.node-facts small, .knowledge-card > small { color: #818a84; font: 9px var(--mono); }.node-facts p { margin: 6px 0 0; color: #56635b; font-size: 11px; line-height: 1.55; }.knowledge-card ul { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 9px 0 0; padding-left: 17px; color: #56635b; font-size: 11px; line-height: 1.6; }.node-action { display: flex; align-items: center; gap: 14px; }.node-action a, .primary-button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 8px 11px; border: 1px solid #b66844; background: var(--orange-soft); color: #995436; font-size: 10px; text-decoration: none; cursor: pointer; }.node-hint { color: #838c85; font: 10px/1.6 var(--mono); }.empty-roadmap { margin-top: 28px; padding: 20px 0; border-top: 2px solid var(--orange); }.empty-roadmap h2 { margin: 0; color: var(--ink); font: 400 22px var(--serif); }.empty-roadmap p { color: var(--muted); font-size: 11px; }.empty-roadmap a { display: inline-flex; align-items: center; gap: 6px; color: var(--blue); font-size: 10px; text-decoration: none; }
@media (max-width: 800px) { .node-inspector { margin-top: 15px; }.inspector-heading { align-items: stretch; flex-direction: column; gap: 9px; }.current-tag { align-self: start; }.node-facts { grid-template-columns: 1fr; gap: 12px; }.node-inspector h2 { font-size: 24px; } }
</style>
