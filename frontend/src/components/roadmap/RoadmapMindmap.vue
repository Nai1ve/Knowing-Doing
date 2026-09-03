<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, FlaskConical, LockKeyhole, Minus, Plus, RotateCcw } from 'lucide-vue-next'
import type { RoadmapNode } from '@/types/product'

interface Point { x: number; y: number }
interface PositionedNode { node: RoadmapNode; point: Point; direction: Point }

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

const scale = ref(1)
const pan = ref<Point>({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = ref<Point>({ x: 0, y: 0 })
const panStart = ref<Point>({ x: 0, y: 0 })

function outward(point: Point): Point {
  const length = Math.hypot(point.x, point.y) || 1
  return { x: point.x / length, y: point.y / length }
}

function childrenOf(parentId: string): RoadmapNode[] {
  return props.nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position)
}

function placeChildren(parent: PositionedNode, children: RoadmapNode[], result: PositionedNode[]) {
  const direction = parent.direction
  const perpendicular = { x: -direction.y, y: direction.x }
  const spread = Math.min(13, 30 / Math.max(children.length, 2))
  const distance = parent.node.parentId === null ? 16 : 13
  const middle = (children.length - 1) / 2
  children.forEach((node, index) => {
    const point = {
      x: parent.point.x + direction.x * distance + perpendicular.x * (index - middle) * spread,
      y: parent.point.y + direction.y * distance + perpendicular.y * (index - middle) * spread,
    }
    const positioned = { node, point, direction: outward({ x: point.x - 50, y: point.y - 50 }) }
    result.push(positioned)
    if (props.openIds.includes(node.id)) placeChildren(positioned, childrenOf(node.id), result)
  })
}

const positionedNodes = computed<PositionedNode[]>(() => {
  const roots = props.nodes.filter((node) => node.parentId === null).sort((a, b) => a.position - b.position)
  const anchors: Point[] = [{ x: 25, y: 22 }, { x: 75, y: 22 }, { x: 75, y: 78 }, { x: 25, y: 78 }]
  const result: PositionedNode[] = []
  roots.forEach((node, index) => {
    const point = anchors[index] ?? { x: 50 + (index % 2 ? 25 : -25), y: 20 + Math.min(index, 3) * 20 }
    const positioned = { node, point, direction: outward({ x: point.x - 50, y: point.y - 50 }) }
    result.push(positioned)
    if (props.openIds.includes(node.id)) placeChildren(positioned, childrenOf(node.id), result)
  })
  return result
})

const edges = computed(() => positionedNodes.value.flatMap((item) => {
  const start = item.node.parentId
    ? positionedNodes.value.find((candidate) => candidate.node.id === item.node.parentId)?.point
    : { x: 50, y: 50 }
  return start ? [{ start, end: item.point, active: item.node.id === props.selectedId || item.node.parentId === props.selectedId }] : []
}))

function statusLabel(node: RoadmapNode) {
  if (node.status === 'verified') return '已验证'
  if (node.status === 'completed') return '已完成'
  if (node.status === 'self_reported') return '自报掌握'
  if (node.status === 'in_progress') return '学习中'
  if (node.status === 'available') return '可开始'
  return '后续开放'
}

function statusIcon(node: RoadmapNode) {
  if (node.status === 'locked') return LockKeyhole
  if (node.learningMode === 'lab') return FlaskConical
  return node.status === 'completed' || node.status === 'verified' ? CheckCircle2 : BookOpen
}

function nodeStyle(item: PositionedNode) { return { left: item.point.x + '%', top: item.point.y + '%' } }
function zoom(delta: number) { scale.value = Math.min(1.35, Math.max(.72, Number((scale.value + delta).toFixed(2)))) }
function resetView() { scale.value = 1; pan.value = { x: 0, y: 0 } }

function startDrag(event: PointerEvent) {
  if (event.button !== 0) return
  dragging.value = true; dragStart.value = { x: event.clientX, y: event.clientY }; panStart.value = { ...pan.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (!dragging.value) return
  pan.value = { x: panStart.value.x + event.clientX - dragStart.value.x, y: panStart.value.y + event.clientY - dragStart.value.y }
}
function stopDrag(event?: PointerEvent) {
  dragging.value = false
  if (event?.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
}
function wheel(event: WheelEvent) { zoom(event.deltaY > 0 ? -.06 : .06) }
onBeforeUnmount(() => { dragging.value = false })
</script>

<template>
  <section class="mindmap-shell" aria-labelledby="mindmap-title">
    <header class="mindmap-toolbar">
      <div><div class="eyebrow">The learning map</div><h2 id="mindmap-title">从目标出发，沿着能力分支逐步点亮。</h2></div>
      <div class="mindmap-controls" aria-label="路线图视图控制">
        <button type="button" title="缩小路线图" aria-label="缩小路线图" @click="zoom(-.1)"><Minus :size="14" aria-hidden="true" /></button><span>{{ Math.round(scale * 100) }}%</span><button type="button" title="放大路线图" aria-label="放大路线图" @click="zoom(.1)"><Plus :size="14" aria-hidden="true" /></button><button type="button" title="恢复路线图视图" aria-label="恢复路线图视图" @click="resetView"><RotateCcw :size="14" aria-hidden="true" /></button>
      </div>
    </header>
    <div class="mindmap-viewport" :class="{ dragging }" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @wheel.prevent="wheel">
      <div class="mindmap-stage" :style="{ transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + scale + ')' }">
        <svg class="mindmap-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line v-for="(edge, index) in edges" :key="index" :class="{ active: edge.active }" :x1="edge.start.x" :y1="edge.start.y" :x2="edge.end.x" :y2="edge.end.y" /></svg>
        <div class="goal-node"><span class="goal-node-label">LONG-TERM GOAL</span><strong>{{ goal }}</strong><small>能力路线图</small></div>
        <button v-for="item in positionedNodes" :key="item.node.id" type="button" class="mindmap-node" :class="['status-' + item.node.status, 'type-' + item.node.nodeType, { selected: item.node.id === selectedId, current: item.node.id === currentNodeId }]" :style="nodeStyle(item)" :aria-label="item.node.title + '，' + statusLabel(item.node)" @pointerdown.stop @click="emit('select', item.node)">
          <span class="node-status"><component :is="statusIcon(item.node)" :size="13" aria-hidden="true" />{{ statusLabel(item.node) }}</span><strong>{{ item.node.title }}</strong><small>{{ item.node.nodeType === 'domain' ? '能力域' : item.node.nodeType === 'capability' ? '能力分支' : '学习节点' }}<template v-if="item.node.childCount"> · {{ item.node.childCount }} 个子节点</template></small>
          <span v-if="item.node.childCount" class="expand-control" :title="openIds.includes(item.node.id) ? '收起分支' : '展开分支'" :aria-label="openIds.includes(item.node.id) ? '收起分支' : '展开分支'" @click.stop="emit('toggle', item.node)"><component :is="openIds.includes(item.node.id) ? ChevronDown : ChevronRight" :size="13" aria-hidden="true" /></span>
        </button>
      </div>
    </div>
    <footer class="mindmap-legend"><span><i class="legend-dot available" />可开始</span><span><i class="legend-dot completed" />已完成 / 已验证</span><span><i class="legend-dot locked" />后续开放</span><span class="legend-hint">点击节点查看详情，使用右上角控制查看全局</span></footer>
  </section>
</template>

<style scoped>
.mindmap-shell { margin-top: 28px; border-top: 2px solid var(--blue); background: var(--paper-deep); }.mindmap-toolbar { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding: 15px 17px 12px; border-bottom: 1px solid var(--line); }.mindmap-toolbar h2 { margin: 6px 0 0; color: var(--ink); font: 400 20px/1.25 var(--serif); }.mindmap-controls { display: flex; align-items: center; gap: 5px; color: var(--muted); font: 9px var(--mono); }.mindmap-controls button { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; border: 1px solid var(--line); background: var(--paper); color: var(--blue); cursor: pointer; }.mindmap-controls button:hover { border-color: var(--blue); background: var(--blue-soft); }.mindmap-controls span { min-width: 38px; text-align: center; }.mindmap-viewport { height: 590px; overflow: hidden; cursor: grab; background: var(--paper-muted); }.mindmap-viewport.dragging { cursor: grabbing; }.mindmap-stage { position: relative; width: 100%; height: 100%; transform-origin: center; transition: transform .18s ease-out; }.mindmap-edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }.mindmap-edges line { stroke: #c5cbd5; stroke-width: .32; vector-effect: non-scaling-stroke; }.mindmap-edges line.active { stroke: var(--orange); stroke-width: .58; }.goal-node, .mindmap-node { position: absolute; transform: translate(-50%, -50%); }.goal-node { display: grid; place-items: center; width: 220px; min-height: 105px; padding: 16px; border: 1px solid #8c98e5; background: var(--blue); color: var(--white); text-align: center; box-shadow: 0 11px 25px rgba(48,75,210,.18); }.goal-node-label { color: #cdd3ff; font: 8px var(--mono); letter-spacing: .7px; }.goal-node strong { max-width: 190px; margin-top: 7px; font: 400 21px/1.2 var(--serif); }.goal-node small { margin-top: 5px; color: #dfe3ff; font-size: 9px; }.mindmap-node { display: grid; grid-template-columns: 1fr auto; width: 174px; min-height: 86px; padding: 11px 28px 10px 12px; border: 1px solid var(--line); background: rgba(255,255,255,.94); color: #5d6964; text-align: left; cursor: pointer; box-shadow: 0 6px 16px rgba(54,65,76,.06); }.mindmap-node:hover, .mindmap-node.selected { border-color: var(--orange); background: #fffaf2; box-shadow: 0 8px 18px rgba(180,104,68,.13); }.mindmap-node.current { border-color: var(--green); }.mindmap-node.type-domain { width: 192px; min-height: 96px; border-top: 3px solid var(--blue); }.mindmap-node.status-locked { opacity: .68; }.mindmap-node.status-verified, .mindmap-node.status-completed { border-left: 3px solid var(--green); }.node-status { grid-column: 1 / -1; display: flex; align-items: center; gap: 5px; color: #8a928c; font: 8px var(--mono); }.status-available .node-status { color: var(--orange); }.status-verified .node-status, .status-completed .node-status { color: var(--green); }.mindmap-node strong { grid-column: 1 / -1; margin-top: 7px; color: var(--ink); font: 400 15px/1.25 var(--serif); }.mindmap-node > small { grid-column: 1 / -1; margin-top: 5px; color: #8b938e; font: 8px var(--mono); }.expand-control { position: absolute; top: 10px; right: 8px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 1px solid var(--line); background: var(--paper); color: var(--blue); }.mindmap-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 13px; padding: 10px 17px; border-top: 1px solid var(--line); color: #808983; font: 9px var(--mono); }.mindmap-legend span { display: inline-flex; align-items: center; gap: 5px; }.legend-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }.legend-dot.available { background: var(--orange); }.legend-dot.completed { background: var(--green); }.legend-dot.locked { background: #a7adb1; }.legend-hint { margin-left: auto; color: #9a9f9a; }
@media (max-width: 800px) { .mindmap-toolbar { align-items: stretch; flex-direction: column; }.mindmap-controls { align-self: start; }.mindmap-viewport { height: 540px; min-width: 0; }.mindmap-stage { min-width: 820px; left: -150px; }.mindmap-legend { align-items: flex-start; flex-direction: column; gap: 7px; }.legend-hint { margin-left: 0; } }
@media (prefers-reduced-motion: reduce) { .mindmap-stage { transition: none; } }
</style>
