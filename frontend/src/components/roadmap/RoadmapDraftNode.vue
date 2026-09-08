<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, ChevronDown, ChevronRight, FlaskConical, LockKeyhole } from 'lucide-vue-next'
import type { RoadmapNode } from '@/types/product'

defineOptions({ name: 'RoadmapDraftNode' })

const props = defineProps<{
  node: RoadmapNode
  nodes: RoadmapNode[]
  level?: number
}>()

const level = computed(() => props.level ?? 0)
const children = computed(() => props.nodes.filter((node) => node.parentId === props.node.id).sort((a, b) => a.position - b.position))

function statusLabel(status: RoadmapNode['status']) {
  if (status === 'available') return '可开始'
  if (status === 'completed') return '已完成'
  if (status === 'verified') return '已验证'
  if (status === 'self_reported') return '自报掌握'
  if (status === 'in_progress') return '学习中'
  return '后续开放'
}

function statusIcon(node: RoadmapNode) {
  if (node.status === 'locked') return LockKeyhole
  if (node.learningMode === 'lab') return FlaskConical
  return node.status === 'completed' || node.status === 'verified' ? CheckCircle2 : ChevronRight
}

function typeLabel(node: RoadmapNode) {
  if (node.nodeType === 'domain') return '能力域'
  if (node.nodeType === 'capability') return '能力分支'
  return '学习节点'
}
</script>

<template>
  <details class="draft-node" :class="[`level-${level}`, `status-${node.status}`, `type-${node.nodeType}`]" :open="level < 1">
    <summary>
      <span class="summary-marker" aria-hidden="true"><component :is="children.length ? ChevronDown : statusIcon(node)" :size="14" /></span>
      <span class="summary-copy">
        <span class="node-meta"><span>{{ typeLabel(node) }}</span><span>{{ statusLabel(node.status) }}</span><span v-if="node.learningMode === 'lab'" class="lab-meta">真实实践</span></span>
        <strong>{{ node.title }}</strong>
        <span class="node-summary">{{ node.summary }}</span>
      </span>
      <span class="node-time">{{ node.estimatedMinutes }} 分钟</span>
    </summary>
    <div class="node-detail">
      <div class="node-detail-grid">
        <div><small>完成标准</small><p>{{ node.completionStandard }}</p></div>
        <div v-if="node.knowledgeCard.keyPoints?.length"><small>关键点</small><p>{{ node.knowledgeCard.keyPoints.join(' · ') }}</p></div>
      </div>
      <div v-if="node.evidence.length" class="node-evidence">
        <small>为什么安排这一项</small>
        <p v-for="item in node.evidence.slice(0, 3)" :key="`${item.sourceType}:${item.sourceId}`">{{ item.excerpt }}</p>
      </div>
      <div v-if="children.length" class="child-list">
        <RoadmapDraftNode v-for="child in children" :key="child.id" :node="child" :nodes="nodes" :level="level + 1" />
      </div>
    </div>
  </details>
</template>

<style scoped>
.draft-node { border-top: 1px solid var(--line); }
.draft-node:first-child { border-top: 0; }
.draft-node summary { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 12px 0; color: var(--ink); list-style: none; cursor: pointer; }
.draft-node summary::-webkit-details-marker { display: none; }
.draft-node summary:hover .summary-copy strong { color: #995436; }
.summary-marker { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid var(--line); color: var(--blue); }
.summary-copy { display: grid; min-width: 0; gap: 5px; }
.node-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #89908b; font: 8px var(--mono); text-transform: uppercase; }
.node-meta .lab-meta { color: var(--green); }
.summary-copy strong { color: var(--ink); font: 400 17px/1.25 var(--serif); transition: color .16s ease; }
.node-summary { color: var(--muted); font-size: 10px; line-height: 1.55; }
.node-time { color: #89908b; font: 8px var(--mono); white-space: nowrap; }
.status-available > summary .summary-marker { border-color: #dca889; color: var(--orange); }
.status-completed > summary .summary-marker, .status-verified > summary .summary-marker { border-color: #8eb69d; color: var(--green); }
.status-locked > summary { opacity: .68; }
.node-detail { margin: 0 0 13px 30px; padding: 12px 13px; border-left: 1px solid #d5d9d0; background: rgba(248, 247, 240, .75); }
.node-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
.node-detail small, .node-evidence small { color: #818a84; font: 8px var(--mono); text-transform: uppercase; }
.node-detail p { margin: 5px 0 0; color: #5e6b63; font-size: 10px; line-height: 1.55; }
.node-evidence { display: grid; gap: 5px; margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--line); }
.node-evidence p { margin: 0; }
.child-list { margin-top: 12px; padding-left: 13px; border-left: 1px solid #d5d9d0; }
.child-list .draft-node summary { padding: 10px 0; }
.child-list .summary-copy strong { font-size: 15px; }
@media (max-width: 640px) { .node-detail-grid { grid-template-columns: 1fr; gap: 10px; }.node-time { display: none; }.node-detail { margin-left: 0; }.child-list { padding-left: 9px; } }
</style>
