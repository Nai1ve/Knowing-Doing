<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, FlaskConical, LockKeyhole } from 'lucide-vue-next'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import type { RoadmapNode } from '@/types/product'

interface MindmapNodeData {
  kind: 'goal' | 'roadmap'
  goal?: string
  node?: RoadmapNode
  selected?: boolean
  current?: boolean
  open?: boolean
}

const props = defineProps<NodeProps<MindmapNodeData>>()
const node = computed(() => props.data.node)
const isGoal = computed(() => props.data.kind === 'goal')

function statusLabel(value: RoadmapNode) {
  if (value.status === 'verified') return '已验证'
  if (value.status === 'completed') return '已完成'
  if (value.status === 'self_reported') return '自报掌握'
  if (value.status === 'in_progress') return '学习中'
  if (value.status === 'available') return '可开始'
  return '后续开放'
}

function statusIcon(value: RoadmapNode) {
  if (value.status === 'locked') return LockKeyhole
  if (value.learningMode === 'lab') return FlaskConical
  return value.status === 'completed' || value.status === 'verified' ? CheckCircle2 : BookOpen
}

function nodeTypeLabel(value: RoadmapNode) {
  if (value.nodeType === 'domain') return '能力域'
  if (value.nodeType === 'capability') return '能力分支'
  return '学习节点'
}

function activate(event: KeyboardEvent) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.click()
}
</script>

<template>
  <div class="node-wrapper">
    <template v-if="isGoal">
      <div class="goal-node">
        <Handle v-for="position in [Position.Top, Position.Right, Position.Bottom, Position.Left]" :id="`source-${position}`" :key="`source-${position}`" type="source" :position="position" :connectable="false" />
        <span class="goal-label">LONG-TERM GOAL</span>
        <strong>{{ data.goal }}</strong>
        <small>能力路线图</small>
      </div>
    </template>
    <template v-else-if="node">
      <Handle v-for="position in [Position.Top, Position.Right, Position.Bottom, Position.Left]" :id="`target-${position}`" :key="`target-${position}`" type="target" :position="position" :connectable="false" />
      <Handle v-for="position in [Position.Top, Position.Right, Position.Bottom, Position.Left]" :id="`source-${position}`" :key="`source-${position}`" type="source" :position="position" :connectable="false" />
      <div class="mindmap-node" :class="['status-' + node.status, 'type-' + node.nodeType, { selected: data.selected, current: data.current }]" role="button" tabindex="0" :aria-label="`${node.title}，${statusLabel(node)}`" @keydown.enter="activate" @keydown.space.prevent="activate">
        <span class="node-status"><component :is="statusIcon(node)" :size="13" aria-hidden="true" />{{ statusLabel(node) }}</span>
        <strong>{{ node.title }}</strong>
        <small>{{ nodeTypeLabel(node) }}<template v-if="node.childCount"> · {{ node.childCount }} 个子节点</template></small>
        <button v-if="node.childCount" type="button" class="expand-control" data-action="expand" :title="data.open ? '收起分支' : '展开分支'" :aria-label="data.open ? '收起分支' : '展开分支'"><component :is="data.open ? ChevronDown : ChevronRight" :size="13" aria-hidden="true" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.node-wrapper, .goal-node, .mindmap-node { position: relative; width: 100%; height: 100%; }
.goal-node { display: grid; place-items: center; padding: 18px; border: 1px solid #8794e2; background: var(--blue); color: var(--white); text-align: center; box-shadow: 0 12px 26px rgba(48, 75, 210, .2); }
.goal-label { color: #cdd3ff; font: 8px var(--mono); letter-spacing: .7px; }
.goal-node strong { max-width: 230px; margin-top: 6px; font: 400 22px/1.2 var(--serif); }
.goal-node small { margin-top: 4px; color: #dfe3ff; font-size: 9px; }
.mindmap-node { display: grid; grid-template-columns: 1fr auto; padding: 12px 30px 11px 13px; border: 1px solid #cbd1d1; background: rgba(255, 255, 255, .96); color: #5d6964; text-align: left; cursor: pointer; box-shadow: 0 7px 16px rgba(54, 65, 76, .08); transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease; }
.mindmap-node:hover, .mindmap-node.selected { border-color: var(--orange); background: #fffaf2; box-shadow: 0 10px 20px rgba(180, 104, 68, .15); transform: translateY(-2px); }
.mindmap-node.current { border-color: var(--green); }
.mindmap-node.type-domain { border-top: 3px solid var(--blue); }
.mindmap-node.status-locked { opacity: .68; }
.mindmap-node.status-verified, .mindmap-node.status-completed { border-left: 3px solid var(--green); }
.node-status { grid-column: 1 / -1; display: flex; align-items: center; gap: 5px; color: #8a928c; font: 8px var(--mono); }
.status-available .node-status { color: var(--orange); }
.status-verified .node-status, .status-completed .node-status { color: var(--green); }
.mindmap-node strong { grid-column: 1 / -1; margin-top: 7px; color: var(--ink); font: 400 15px/1.25 var(--serif); }
.mindmap-node > small { grid-column: 1 / -1; margin-top: 5px; color: #8b938e; font: 8px var(--mono); }
.expand-control { position: absolute; top: 10px; right: 8px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 1px solid var(--line); background: var(--paper); color: var(--blue); }
@media (prefers-reduced-motion: reduce) { .mindmap-node { transition: none; } }
</style>
