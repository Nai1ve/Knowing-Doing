<script setup lang="ts">
import { ArrowLeft, ChevronDown, Clock3, RefreshCw, X } from 'lucide-vue-next'
import type { ProductPracticeHistoryItem } from '@/types/product'

const props = defineProps<{
  currentPractice: ProductPracticeHistoryItem | null
  history: ProductPracticeHistoryItem[]
  historyLoading: boolean
  historyOpen: boolean
  stageLabel: string
}>()

const emit = defineEmits<{
  toggleHistory: []
  select: [practiceId: string]
  back: []
  refresh: []
}>()

function caseLabel(item: ProductPracticeHistoryItem): string {
  if (item.caseId === 'mysql-order-list-index-001') return 'MySQL 慢查询'
  if (item.caseId === 'mysql-deadlock-lock-order-001') return 'MySQL 死锁'
  return 'MySQL 深分页'
}

function statusLabel(item: ProductPracticeHistoryItem): string {
  if (item.status === 'resolved') return '已完成'
  if (item.status === 'ready_to_close') return '待收束'
  if (item.status === 'ended') return '已结束'
  return '进行中'
}

function labLabel(item: ProductPracticeHistoryItem): string {
  if (item.labState === 'active') return 'Lab 可用'
  if (item.labState === 'reopen_required') return 'Lab 已结束'
  return '无 Lab'
}

function updatedAt(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="workspace-header-wrap">
    <header class="workspace-header">
      <div class="workspace-identity">
        <span class="workspace-kicker">写作沉淀</span>
        <button class="practice-picker" type="button" :aria-expanded="historyOpen" aria-haspopup="dialog" @click="emit('toggleHistory')">
          <span class="practice-picker-copy">
            <strong>{{ currentPractice ? caseLabel(currentPractice) : '选择一条实践' }}</strong>
            <small>{{ currentPractice ? `${statusLabel(currentPractice)} · ${stageLabel}` : '从历史实践中进入文章工作区' }}</small>
          </span>
          <ChevronDown :size="15" aria-hidden="true" />
        </button>
      </div>
      <div class="workspace-actions">
        <span v-if="currentPractice" class="workspace-updated"><Clock3 :size="12" aria-hidden="true" />最近更新 {{ updatedAt(currentPractice.lastActivityAt) }}</span>
        <button class="secondary-button back-button" type="button" @click="emit('back')"><ArrowLeft :size="13" aria-hidden="true" />回到实践</button>
        <button class="icon-button" type="button" title="刷新当前写作内容" aria-label="刷新当前写作内容" @click="emit('refresh')"><RefreshCw :size="14" aria-hidden="true" /></button>
      </div>
    </header>

    <section v-if="historyOpen" class="practice-menu" role="dialog" aria-label="选择实践">
      <div class="practice-menu-heading"><div><strong>实践历史</strong><span>选择后只加载当前阶段内容</span></div><button class="menu-close" type="button" title="关闭实践历史" aria-label="关闭实践历史" @click="emit('toggleHistory')"><X :size="14" aria-hidden="true" /></button></div>
      <div v-if="historyLoading" class="practice-menu-state" role="status">正在读取实践历史…</div>
      <div v-else-if="history.length === 0" class="practice-menu-state">还没有可整理的实践记录。</div>
      <div v-else class="practice-menu-list">
        <button v-for="item in history" :key="item.id" type="button" class="practice-menu-item" :class="{ active: currentPractice?.id === item.id }" @click="emit('select', item.id)">
          <span class="practice-menu-main"><strong>{{ caseLabel(item) }}</strong><small>{{ statusLabel(item) }} · {{ updatedAt(item.lastActivityAt) }}</small></span>
          <span class="practice-menu-lab">{{ labLabel(item) }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.workspace-header-wrap { position: relative; z-index: 5; }
.workspace-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 64px; padding: 8px 0 12px; border-bottom: 1px solid var(--line); }
.workspace-identity, .workspace-actions, .practice-picker, .practice-picker-copy, .workspace-updated, .back-button { display: flex; align-items: center; }
.workspace-identity { gap: 16px; min-width: 0; }
.workspace-kicker { flex: 0 0 auto; color: var(--blue); font: 10px var(--mono); letter-spacing: .2px; }
.practice-picker { gap: 12px; min-width: min(360px, 52vw); padding: 4px 0; border: 0; background: transparent; color: var(--ink); text-align: left; }
.practice-picker:hover { color: var(--blue); }
.practice-picker-copy { display: grid; min-width: 0; gap: 4px; }
.practice-picker-copy strong { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.practice-picker-copy small, .workspace-updated { color: var(--muted); font: 9px var(--mono); }
.workspace-actions { flex: 0 0 auto; gap: 10px; }
.workspace-updated { gap: 5px; white-space: nowrap; }
.back-button { gap: 6px; white-space: nowrap; }
.icon-button, .menu-close { display: grid; place-items: center; border: 1px solid #b8c1ec; background: transparent; color: var(--blue); cursor: pointer; }
.icon-button { width: 30px; height: 30px; }
.practice-menu { position: absolute; top: calc(100% + 8px); left: 92px; width: min(430px, calc(100vw - 34px)); border: 1px solid var(--line); background: #fff; box-shadow: 0 14px 30px rgb(33 43 40 / 12%); }
.practice-menu-heading { display: flex; align-items: start; justify-content: space-between; gap: 14px; padding: 14px 16px 11px; border-bottom: 1px solid var(--line); }
.practice-menu-heading div { display: grid; gap: 4px; }.practice-menu-heading strong { color: var(--ink); font-size: 12px; }.practice-menu-heading span { color: var(--muted); font: 9px var(--mono); }.menu-close { width: 25px; height: 25px; }
.practice-menu-list { display: grid; gap: 1px; max-height: 340px; overflow-y: auto; background: var(--line-soft); }
.practice-menu-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 12px 16px; border: 0; background: #fff; color: var(--muted); text-align: left; cursor: pointer; }.practice-menu-item:hover, .practice-menu-item.active { background: var(--blue-soft); color: var(--blue); }.practice-menu-main { display: grid; min-width: 0; gap: 4px; }.practice-menu-main strong { overflow: hidden; color: var(--ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.practice-menu-main small, .practice-menu-lab, .practice-menu-state { color: var(--muted); font: 9px var(--mono); }.practice-menu-lab { flex: 0 0 auto; }.practice-menu-state { padding: 20px 16px; }
@media (max-width: 760px) { .workspace-header { align-items: start; flex-direction: column; gap: 11px; padding-bottom: 13px; }.workspace-identity { width: 100%; align-items: start; flex-direction: column; gap: 6px; }.practice-picker { min-width: 0; width: 100%; justify-content: space-between; }.workspace-actions { width: 100%; }.workspace-updated { margin-inline-end: auto; }.practice-menu { top: calc(100% + 8px); left: 0; width: 100%; } }
@media (max-width: 460px) { .workspace-updated { display: none; }.back-button { padding-inline: 8px; }.practice-menu-item { align-items: start; flex-direction: column; gap: 6px; } }
</style>
