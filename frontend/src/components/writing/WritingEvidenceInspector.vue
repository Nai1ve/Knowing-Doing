<script setup lang="ts">
import { FileCode2, FileText, MessageCircle, Quote, TriangleAlert } from 'lucide-vue-next'
import type { ProductWritingClusterDetail } from '@/types/product'

defineProps<{ detail: ProductWritingClusterDetail | null; loading: boolean; filter: string }>()
const emit = defineEmits<{ 'update:filter': [value: string]; 'load-more': [] }>()
const filters = [
  { key: 'key', label: '关键节点' }, { key: 'user', label: '我的判断' }, { key: 'tutor', label: 'Tutor' },
  { key: 'evidence', label: 'SQL / 证据' }, { key: 'error', label: '错误' }, { key: 'zhihu', label: '知乎来源' },
]
function icon(kind: string) { if (kind === 'user_message') return MessageCircle; if (kind === 'tutor_reply') return Quote; if (kind === 'error') return TriangleAlert; if (kind === 'sql' || kind === 'explain') return FileCode2; return FileText }
</script>

<template>
  <aside class="evidence-inspector" aria-label="证据检查器">
    <div v-if="!detail && !loading" class="inspector-empty"><FileText :size="18" aria-hidden="true" /><strong>选择一个聚类</strong><span>展开后查看原始对话、SQL 和验证证据。</span></div>
    <template v-else>
      <header class="inspector-header"><span class="eyebrow">Evidence inspector</span><h2>{{ detail?.cluster.title ?? '正在加载证据' }}</h2><p>{{ detail?.cluster.memberCount ?? 0 }} 条记录 · 重复内容已折叠</p></header>
      <div class="filter-strip" role="tablist" aria-label="证据筛选"><button v-for="item in filters" :key="item.key" type="button" :class="{ active: filter === item.key }" :aria-selected="filter === item.key" role="tab" @click="emit('update:filter', item.key)">{{ item.label }}</button></div>
      <div v-if="loading" class="inspector-loading" role="status">正在打开证据…</div>
      <div v-else-if="detail" class="member-list">
        <article v-for="member in detail.members" :key="member.id" class="member-item" :class="member.role"><component :is="icon(member.kind)" :size="14" aria-hidden="true" /><div><div class="member-title"><strong>{{ member.title }}</strong><span>{{ member.role === 'duplicate' ? '重复记录' : member.verificationStatus }}</span></div><p>{{ member.excerpt || '没有可展示的内容' }}</p></div></article>
        <p v-if="detail.members.length === 0" class="inspector-empty compact">这个筛选条件下没有记录。</p>
        <button v-if="detail.nextCursor" class="load-more" type="button" :disabled="loading" @click="emit('load-more')">{{ loading ? '正在加载…' : '加载更多证据' }}</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.evidence-inspector { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); background: #fff; }.inspector-header { padding: 17px 17px 14px; border-bottom: 1px solid var(--line); }.inspector-header h2 { margin: 7px 0 5px; color: var(--ink); font: 400 20px/1.25 var(--serif); }.inspector-header p { margin: 0; color: var(--muted); font: 9px var(--mono); }.filter-strip { display: flex; gap: 5px; overflow-x: auto; padding: 9px 12px; border-bottom: 1px solid var(--line); background: var(--paper-muted); }.filter-strip button { flex: 0 0 auto; padding: 5px 7px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }.filter-strip button:hover, .filter-strip button.active { border-color: #b8c1ec; background: #fff; color: var(--blue); }.member-list { min-height: 0; overflow-y: auto; padding: 4px 0; }.member-item { display: grid; grid-template-columns: 17px minmax(0, 1fr); gap: 9px; padding: 12px 15px; border-bottom: 1px solid var(--line-soft); color: var(--muted); }.member-item svg { margin-top: 2px; color: var(--blue); }.member-item.duplicate { opacity: .62; }.member-title { display: flex; align-items: baseline; gap: 7px; min-width: 0; }.member-title strong { overflow: hidden; color: var(--ink); font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.member-title span { flex: 0 0 auto; color: var(--muted); font: 8px var(--mono); }.member-item p { max-height: 90px; overflow: hidden; margin: 5px 0 0; color: #68716d; font: 10px/1.6 var(--sans); white-space: pre-wrap; }.inspector-empty { display: grid; justify-items: center; gap: 8px; min-height: 220px; padding: 40px 20px; color: var(--muted); text-align: center; }.inspector-empty strong { color: var(--ink); font-size: 12px; }.inspector-empty span { max-width: 210px; font-size: 10px; line-height: 1.5; }.inspector-empty.compact { min-height: 100px; }.inspector-loading { padding: 25px; color: var(--muted); font: 10px var(--mono); }
.load-more { margin: 10px 15px 14px; padding: 7px; border: 1px solid var(--line); background: var(--paper-muted); color: var(--blue); font-size: 10px; cursor: pointer; }.load-more:disabled { opacity: .6; cursor: wait; }
</style>
