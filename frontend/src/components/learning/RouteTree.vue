<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import type { Milestone } from '@/types/domain'
defineProps<{ milestones: Milestone[]; selectedNodeId?: string }>()
const emit = defineEmits<{ select: [nodeId: string] }>()
</script>

<template>
  <section class="tree-wrap" aria-label="MySQL 学习路线">
    <button class="tree-root" type="button" @click="emit('select', 'goal')"><small>Target outcome · 总目标</small>掌握 MySQL 性能问题的分析与验证</button>
    <div class="tree-branches">
      <section v-for="milestone in milestones" :key="milestone.id" class="tree-branch">
        <button class="tree-phase" :class="milestone.status" type="button" @click="emit('select', milestone.nodes[0]?.id ?? milestone.id)"><small>{{ milestone.index }} · {{ milestone.status === 'completed' ? '已完成' : milestone.status === 'current' ? '进行中' : '未开始' }}</small>{{ milestone.title }}</button>
        <div class="tree-leaves"><button v-for="node in milestone.nodes" :key="node.id" class="tree-leaf" :class="node.status" type="button" @click="emit('select', node.id)">{{ node.title }}<ChevronRight :size="12" aria-hidden="true" /></button></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tree-wrap { margin-top: 18px; padding: 16px 13px 18px; border: 1px solid #aaaec3; background: #f7f6ff; }
.tree-root { display: block; width: min(360px, 100%); margin: 0 auto; padding: 12px 14px; border: 1px solid var(--blue); background: #e8eafe; color: #283caa; font-family: var(--serif); font-size: 16px; font-weight: 400; text-align: center; }
.tree-root small, .tree-phase small { display: block; margin-bottom: 5px; color: #6c65b7; font-family: var(--mono); font-size: 9px; text-transform: uppercase; }
.tree-branches { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 27px; }
.tree-branches::before { position: absolute; top: -14px; right: 12%; left: 12%; height: 1px; background: #9ea5d0; content: ""; }
.tree-branch { position: relative; padding-top: 13px; }
.tree-branch::before { position: absolute; top: -14px; left: 50%; width: 1px; height: 14px; background: #9ea5d0; content: ""; }
.tree-phase { width: 100%; min-height: 60px; padding: 8px; border: 1px solid #bbbfd6; background: #fff; color: #333957; font-size: 11px; text-align: left; }
.tree-phase.current { border-color: var(--blue); background: var(--blue-soft); }
.tree-phase:hover, .tree-leaf:hover { border-color: var(--blue); }
.tree-leaves { display: grid; gap: 5px; margin: 7px 0 0 10px; padding-left: 10px; border-left: 1px solid #b9bed4; }
.tree-leaf { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 5px 7px; border: 1px solid #d0d2dd; background: #fff; color: #67716d; font-size: 10px; text-align: left; }
.tree-leaf.current { border-color: var(--orange); background: #fff4ed; color: #9b4f34; }
@media (max-width: 900px) { .tree-branches { grid-template-columns: 1fr 1fr; } .tree-branches::before { right: 25%; left: 25%; } .tree-branch:nth-child(3)::before, .tree-branch:nth-child(4)::before { display: none; } }
</style>
