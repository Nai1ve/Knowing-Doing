<script setup lang="ts">
import { Check, Eye, Minus, Sparkles } from 'lucide-vue-next'
import type { ProductWritingCluster } from '@/types/product'

const props = defineProps<{ cluster: ProductWritingCluster; active: boolean; saving: boolean }>()
const emit = defineEmits<{ open: []; accept: []; reject: []; reset: [] }>()
const summary = () => props.cluster.modelSummary || props.cluster.ruleSummary
</script>

<template>
  <article class="cluster-card" :class="{ active, accepted: cluster.status === 'accepted', rejected: cluster.status === 'rejected' }">
    <div class="cluster-card-top"><span class="cluster-number">{{ String(cluster.position).padStart(2, '0') }}</span><span class="cluster-state">{{ cluster.status === 'accepted' ? '已纳入' : cluster.status === 'rejected' ? '暂不纳入' : '待确认' }}</span></div>
    <h3>{{ cluster.title }}</h3>
    <p class="cluster-summary">{{ summary() }}</p>
    <p class="cluster-relevance"><strong>确认重点</strong>{{ cluster.relevance }}</p>
    <div class="cluster-meta"><span>{{ cluster.memberCount }} 条相关记录</span><span v-if="cluster.duplicateCount">已折叠 {{ cluster.duplicateCount }} 次</span><span v-if="cluster.summaryStatus === 'queued' || cluster.summaryStatus === 'running'" class="model-status"><Sparkles :size="11" aria-hidden="true" />摘要润色中</span></div>
    <div class="cluster-actions">
      <button class="secondary-button" type="button" :disabled="saving" @click="emit('open')"><Eye :size="13" aria-hidden="true" />查看证据</button>
      <button v-if="cluster.status !== 'accepted'" class="primary-button" type="button" :disabled="saving" @click="emit('accept')"><Check :size="13" aria-hidden="true" />纳入文章</button>
      <button v-if="cluster.status === 'accepted'" class="secondary-button" type="button" :disabled="saving" @click="emit('reset')"><Minus :size="13" aria-hidden="true" />恢复待确认</button>
      <button v-else-if="cluster.status !== 'rejected'" class="text-button" type="button" :disabled="saving" @click="emit('reject')">暂不纳入</button>
      <button v-else class="text-button" type="button" :disabled="saving" @click="emit('reset')">恢复待确认</button>
    </div>
  </article>
</template>

<style scoped>
.cluster-card { display: grid; gap: 10px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-top: 2px solid var(--line); background: var(--paper-muted); transition: border-color .15s ease, background .15s ease; }
.cluster-card:hover, .cluster-card.active { border-color: #9fa9d9; background: #fff; }.cluster-card.accepted { border-top-color: var(--green); }.cluster-card.rejected { opacity: .7; }
.cluster-card-top, .cluster-meta, .cluster-actions { display: flex; align-items: center; gap: 8px; }.cluster-number, .cluster-state, .cluster-meta { color: var(--muted); font: 9px var(--mono); }.cluster-number { color: var(--blue); }.cluster-state { margin-left: auto; }.cluster-card h3 { margin: 0; color: var(--ink); font-size: 15px; font-weight: 650; }.cluster-summary, .cluster-relevance { margin: 0; color: #58635f; font-size: 11px; line-height: 1.65; }.cluster-relevance { padding-top: 9px; border-top: 1px solid var(--line-soft); color: var(--muted); }.cluster-relevance strong { display: block; margin-bottom: 3px; color: var(--blue); font: 9px var(--mono); font-weight: 500; }.cluster-meta { flex-wrap: wrap; }.model-status { display: inline-flex; align-items: center; gap: 4px; color: var(--blue); }.cluster-actions { flex-wrap: wrap; margin-top: 2px; }.cluster-actions button { display: inline-flex; align-items: center; gap: 5px; }.text-button { padding: 4px 0; border: 0; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }.text-button:hover { color: var(--blue); }
</style>
