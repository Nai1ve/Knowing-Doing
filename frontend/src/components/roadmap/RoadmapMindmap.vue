<script setup lang="ts">
import { computed, markRaw, nextTick, watch } from 'vue'
import { Panel, VueFlow, useVueFlow, type Edge, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Minus, Plus, RotateCcw } from 'lucide-vue-next'
import type { RoadmapNode } from '@/types/product'
import RoadmapMindmapNode from './RoadmapMindmapNode.vue'

interface FlowNodeData {
  kind: 'goal' | 'roadmap'
  goal?: string
  node?: RoadmapNode
  selected?: boolean
  current?: boolean
  open?: boolean
}

type MindmapNode = Node<FlowNodeData>

const props = defineProps<{
  goal: string
  nodes: RoadmapNode[]
  selectedId: string
  openIds: string[]
  currentNodeId?: string | null
}>()

const emit = defineEmits<{
  select: [node: RoadmapNode]
  toggle: [node: RoadmapNode]
}>()

const nodeTypes = markRaw({ goal: RoadmapMindmapNode, roadmap: RoadmapMindmapNode })
const flow = useVueFlow('roadmap-mindmap')
const nodeMap = computed(() => new Map(props.nodes.map((node) => [node.id, node])))

function childrenOf(parentId: string) {
  return props.nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position)
}

function outward(x: number, y: number) {
  const length = Math.hypot(x, y) || 1
  return { x: x / length, y: y / length }
}

function positionForRoot(index: number) {
  return [
    { x: -430, y: -180 },
    { x: 430, y: -180 },
    { x: 0, y: 350 },
  ][index] ?? { x: index % 2 ? 500 : -500, y: 200 + Math.floor(index / 2) * 190 }
}

function childPosition(parent: { x: number; y: number }, index: number, total: number) {
  const direction = outward(parent.x, parent.y)
  const perpendicular = { x: -direction.y, y: direction.x }
  const middle = (total - 1) / 2
  const spread = total > 3 ? 150 : 175
  return {
    x: parent.x + direction.x * 250 + perpendicular.x * (index - middle) * spread,
    y: parent.y + direction.y * 250 + perpendicular.y * (index - middle) * spread,
  }
}

function buildPositions() {
  const positions = new Map<string, { x: number; y: number }>()
  const roots = props.nodes.filter((node) => node.parentId === null).sort((a, b) => a.position - b.position)

  function placeBranch(node: RoadmapNode, position: { x: number; y: number }) {
    positions.set(node.id, position)
    const children = childrenOf(node.id)
    children.forEach((child, index) => placeBranch(child, childPosition(position, index, children.length)))
  }

  roots.forEach((node, index) => placeBranch(node, positionForRoot(index)))
  return positions
}

function handlePair(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { sourceHandle: 'source-right', targetHandle: 'target-left' } : { sourceHandle: 'source-left', targetHandle: 'target-right' }
  return dy >= 0 ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' } : { sourceHandle: 'source-top', targetHandle: 'target-bottom' }
}

const positions = computed(() => buildPositions())
const flowNodes = computed<MindmapNode[]>(() => [
  {
    id: 'goal',
    type: 'goal' as const,
    position: { x: 0, y: 0 },
    width: 280,
    height: 130,
    selectable: false,
    draggable: false,
    connectable: false,
    data: { kind: 'goal' as const, goal: props.goal },
  },
  ...props.nodes.map((node): MindmapNode => ({
    id: node.id,
    type: 'roadmap' as const,
    position: positions.value.get(node.id) ?? { x: 0, y: 0 },
    width: node.nodeType === 'domain' ? 224 : 196,
    height: node.nodeType === 'domain' ? 112 : 98,
    selectable: false,
    draggable: false,
    connectable: false,
    ariaLabel: `${node.title}，${statusLabel(node)}`,
    data: {
      kind: 'roadmap' as const,
      node,
      selected: node.id === props.selectedId,
      current: node.id === props.currentNodeId,
      open: props.openIds.includes(node.id),
    },
  })),
])

const flowEdges = computed<Edge[]>(() => {
  const visible = nodeMap.value
  const result: Edge[] = []
  props.nodes.forEach((node) => {
    const targetPosition = positions.value.get(node.id)
    const parentPosition = node.parentId ? positions.value.get(node.parentId) : { x: 0, y: 0 }
    if (!targetPosition || !parentPosition) return
    const pair = handlePair(parentPosition, targetPosition)
    const active = node.id === props.selectedId || node.parentId === props.selectedId
    result.push({
      id: `edge-${node.parentId ?? 'goal'}-${node.id}`,
      source: node.parentId ?? 'goal',
      target: node.id,
      sourceHandle: pair.sourceHandle,
      targetHandle: pair.targetHandle,
      type: 'bezier',
      selectable: false,
      style: { stroke: active ? '#d27b50' : '#aeb8c4', strokeWidth: active ? 2.5 : 1.35, opacity: active ? 1 : .8 },
      data: { visible: visible.has(node.id) },
    })
  })
  return result
})

const zoomLabel = computed(() => `${Math.round(flow.viewport.value.zoom * 100)}%`)

function statusLabel(node: RoadmapNode) {
  if (node.status === 'verified') return '已验证'
  if (node.status === 'completed') return '已完成'
  if (node.status === 'self_reported') return '自报掌握'
  if (node.status === 'in_progress') return '学习中'
  if (node.status === 'available') return '可开始'
  return '后续开放'
}

function zoomIn() { void flow.zoomIn({ duration: 180 }) }
function zoomOut() { void flow.zoomOut({ duration: 180 }) }
function fitView() { void flow.fitView({ padding: .2, duration: 240 }) }

function handleNodeClick({ node, event }: NodeMouseEvent) {
  const data = node.data as FlowNodeData
  if (!data.node) return
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const target = event.target instanceof HTMLElement ? event.target : null
  const clickedExpand = path.some((item) => item instanceof HTMLElement && item.dataset.action === 'expand') || Boolean(target?.closest('[data-action="expand"]'))
  if (clickedExpand) emit('toggle', data.node)
  else emit('select', data.node)
}

watch(() => props.nodes.map((node) => node.id).join(','), () => {
  void nextTick(() => fitView())
})
</script>

<template>
  <section class="mindmap-shell" aria-labelledby="mindmap-title">
    <header class="mindmap-toolbar">
      <div>
        <div class="eyebrow">The learning map</div>
        <h2 id="mindmap-title">从目标出发，沿着能力分支逐步点亮。</h2>
      </div>
      <div class="mindmap-status"><span class="map-dot" />{{ nodes.length }} 个已载入节点 · 可展开分支</div>
    </header>
    <div class="mindmap-viewport">
      <VueFlow id="roadmap-mindmap" :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" :nodes-draggable="false" :nodes-connectable="false" :elements-selectable="false" :zoom-on-double-click="false" :pan-on-scroll="true" :min-zoom=".35" :max-zoom="1.5" :fit-view-on-init="true" :fit-view-on-init-options="{ padding: .2 }" aria-label="学习路线脑图" @node-click="handleNodeClick">
        <Panel position="top-right" class="mindmap-controls" aria-label="路线图视图控制">
          <button type="button" title="缩小路线图" aria-label="缩小路线图" @click="zoomOut"><Minus :size="14" aria-hidden="true" /></button>
          <span>{{ zoomLabel }}</span>
          <button type="button" title="放大路线图" aria-label="放大路线图" @click="zoomIn"><Plus :size="14" aria-hidden="true" /></button>
          <button type="button" title="适配全部节点" aria-label="适配全部节点" @click="fitView"><RotateCcw :size="14" aria-hidden="true" /></button>
        </Panel>
      </VueFlow>
    </div>
    <footer class="mindmap-legend"><span><i class="legend-dot available" />可开始</span><span><i class="legend-dot completed" />已完成 / 已验证</span><span><i class="legend-dot locked" />后续开放</span><span class="legend-hint">拖动画布浏览 · 滚轮缩放 · 点击节点查看详情</span></footer>
  </section>
</template>

<style scoped>
.mindmap-shell { margin-top: 28px; border-top: 2px solid var(--blue); background: var(--paper-deep); }
.mindmap-toolbar { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding: 15px 17px 12px; border-bottom: 1px solid var(--line); }
.mindmap-toolbar h2 { margin: 6px 0 0; color: var(--ink); font: 400 20px/1.25 var(--serif); }
.mindmap-status { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font: 9px var(--mono); }
.map-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.mindmap-viewport { height: 610px; overflow: hidden; background-color: #f3f3ed; background-image: radial-gradient(#dfe2dc 1px, transparent 1px); background-size: 24px 24px; }
.mindmap-viewport :deep(.vue-flow) { width: 100%; height: 100%; }
.mindmap-viewport :deep(.vue-flow__pane) { cursor: grab; }
.mindmap-viewport :deep(.vue-flow__pane.dragging) { cursor: grabbing; }
.mindmap-viewport :deep(.vue-flow__edge path) { transition: stroke .16s ease, stroke-width .16s ease; }
.mindmap-viewport :deep(.vue-flow__handle) { width: 1px; height: 1px; border: 0; opacity: 0; pointer-events: none; }
.mindmap-controls { display: flex; align-items: center; gap: 4px; margin: 14px 14px 0 0; padding: 4px; border: 1px solid #cfd3cc; background: rgba(251, 250, 244, .94); box-shadow: 0 5px 14px rgba(54, 65, 76, .08); }
.mindmap-controls button { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; border: 1px solid transparent; background: transparent; color: var(--blue); cursor: pointer; }
.mindmap-controls button:hover { border-color: #bec5ea; background: var(--blue-soft); }
.mindmap-controls span { min-width: 40px; color: var(--muted); text-align: center; font: 9px var(--mono); }
.mindmap-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 13px; padding: 10px 17px; border-top: 1px solid var(--line); color: #808983; font: 9px var(--mono); }
.mindmap-legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }
.legend-dot.available { background: var(--orange); }
.legend-dot.completed { background: var(--green); }
.legend-dot.locked { background: #a7adb1; }
.legend-hint { margin-left: auto; color: #9a9f9a; }
@media (max-width: 800px) {
  .mindmap-toolbar { align-items: stretch; flex-direction: column; }
  .mindmap-viewport { height: 540px; }
  .mindmap-legend { align-items: flex-start; flex-direction: column; gap: 7px; }
  .legend-hint { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .mindmap-viewport :deep(.vue-flow__edge path) { transition: none; }
}
</style>
