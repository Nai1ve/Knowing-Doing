<script setup lang="ts">
import { computed } from 'vue'
import { Clock3, History, LoaderCircle, Play, RotateCcw } from 'lucide-vue-next'
import type { LabCaseId, LabCaseSummary, LabHealth, LabQueueTicket, LabRun } from '@/types/lab'
import type { ProductPlanUnit, ProductPracticeHistoryItem } from '@/types/product'

const props = defineProps<{
  history: ProductPracticeHistoryItem[]
  cases: LabCaseSummary[]
  health: LabHealth | null
  selectedCaseId: LabCaseId
  run: LabRun | null
  ticket: LabQueueTicket | null
  loading: boolean
  starting: boolean
  restoring: boolean
  polling: boolean
  resetting: boolean
  ending: boolean
  error?: string | null
  planUnit: ProductPlanUnit | null
}>()
const emit = defineEmits<{
  start: []
  reset: []
  end: []
  cancel: []
  select: [caseId: LabCaseId]
  history: [id: string]
  reopen: [id: string]
}>()
const caseTitle = (caseId: string) => caseId === 'mysql-order-list-index-001' ? 'MySQL 慢查询与联合索引' : caseId === 'mysql-deadlock-lock-order-001' ? 'MySQL 死锁与锁等待' : 'MySQL 深分页优化'
const stageLabel = (stage: string) => ({ observe: '观察', hypothesize: '假设', inspect: '检查', attempt: '尝试', verify: '验证', resolved: '已解决' } as Record<string, string>)[stage] ?? stage
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const hasHistory = computed(() => props.history.length > 0)
const planUnitAvailable = computed(() => props.planUnit?.status === 'current' && props.planUnit.availability === 'available')
</script>

<template>
  <div class="launcher">
    <header class="launcher-header"><div class="eyebrow">03 · MySQL Lab / choose a practice</div><h1>从一个真实问题开始</h1><p>选择一个案例，先观察证据，再把判断带进 SQL 实验。实践、Tutor 对话和固定内容会归档在同一个学习记录里。</p></header>
    <section class="launcher-grid">
      <div class="launcher-main">
        <div class="section-heading"><div><div class="eyebrow">Start here</div><h2>选择一个实践案例</h2></div><span class="step-note">01 / 选择</span></div>
        <div v-if="loading" class="launcher-state" role="status"><LoaderCircle class="spin" :size="15" aria-hidden="true" />正在检查实验环境…</div>
        <div v-else class="planned-entry">
          <div class="planned-entry-icon"><Play :size="17" aria-hidden="true" /></div>
          <div class="planned-entry-copy"><small>{{ planUnit?.availability === 'coming_soon' ? '路线中的下一节点' : '当前计划节点' }}</small><strong>{{ planUnit?.title ?? '尚未选择学习计划' }}</strong><p>{{ planUnit?.objective ?? '请先在总览创建学习计划，再从当前节点进入实践。' }}</p><span :class="{ ready: health?.ready && planUnitAvailable }">{{ !planUnit ? '尚未选择学习计划' : !planUnitAvailable ? '即将开放' : health?.ready ? '实验环境已就绪' : '正在等待实验环境' }}</span></div>
          <button type="button" :disabled="!planUnitAvailable || !health?.ready || starting" @click="emit('start')"><Play :size="13" aria-hidden="true" />{{ starting ? '启动中…' : '开始实践' }}</button>
        </div>
        <div v-if="error" class="launcher-error" role="alert">{{ error }}</div>
      </div>
      <aside class="history-rail">
        <div class="section-heading"><div><div class="eyebrow">Your practice archive</div><h2>继续已有实践</h2></div><History :size="16" aria-hidden="true" /></div>
        <div v-if="restoring" class="launcher-state"><LoaderCircle class="spin" :size="14" aria-hidden="true" />正在恢复实践…</div>
        <div v-else-if="hasHistory" class="history-list">
          <article v-for="item in history" :key="item.id" class="history-card">
            <button type="button" class="history-open" @click="emit('history', item.id)"><strong>{{ caseTitle(item.caseId) }}</strong><span>{{ stageLabel(item.stage) }} · {{ dateLabel(item.lastActivityAt) }}</span><small>{{ item.lastTutorProvider ? '已有 Tutor 记录' : '等待第一次讨论' }} · {{ item.labState === 'active' ? 'Lab 可用' : '可续开 Lab' }}</small></button>
            <button v-if="item.labState === 'reopen_required' || item.labState === 'none'" type="button" class="history-reopen" :aria-label="'继续实践：' + caseTitle(item.caseId)" title="续开实验环境" @click="emit('reopen', item.id)"><RotateCcw :size="13" aria-hidden="true" />继续</button>
          </article>
        </div>
        <div v-else class="history-empty"><Clock3 :size="17" aria-hidden="true" /><p>完成一次实践后，这里会保留你的问题、证据、路径和 Tutor 记录。</p></div>
        <div class="archive-note"><Play :size="13" aria-hidden="true" /><span>选择历史记录后进入同一个工作空间；Lab 失效只影响执行权限，不会丢失学习轨迹。</span></div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.launcher { max-width: 1180px; margin: 0 auto; }.launcher-header { max-width: 760px; padding: 10px 0 25px; border-bottom: 2px solid var(--blue); }.launcher-header h1 { margin: 11px 0 0; color: #2e48cc; font: 400 clamp(28px, 3vw, 40px)/1.18 var(--serif); }.launcher-header p { max-width: 700px; margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }.launcher-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(290px, .75fr); gap: 24px; margin-top: 25px; align-items: start; }.launcher-main, .history-rail { min-width: 0; }.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 21px var(--serif); }.section-heading > svg { color: var(--orange); }.step-note { color: var(--muted); font: 9px var(--mono); }
.launcher-lab { margin-top: 18px; }.launcher-state { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 15px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--muted); font-size: 11px; }.launcher-error { margin-top: 12px; padding: 10px 12px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); font-size: 10px; line-height: 1.5; }
.planned-entry { display: flex; align-items: center; gap: 14px; margin-top: 18px; padding: 20px 16px; border: 1px solid var(--line); border-top: 2px solid var(--orange); background: var(--paper-deep); }.planned-entry-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; background: var(--orange-soft); color: var(--orange); }.planned-entry-copy { min-width: 0; flex: 1; }.planned-entry-copy small, .planned-entry-copy strong, .planned-entry-copy p, .planned-entry-copy span { display: block; }.planned-entry-copy small { color: var(--muted); font: 9px var(--mono); }.planned-entry-copy strong { margin-top: 5px; color: var(--ink); font: 400 18px var(--serif); }.planned-entry-copy p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.planned-entry-copy span { margin-top: 9px; color: var(--orange); font: 9px var(--mono); }.planned-entry-copy span.ready { color: var(--green); }.planned-entry button { display: inline-flex; align-items: center; gap: 5px; min-height: 34px; padding: 8px 11px; border: 1px solid #b66844; background: var(--orange-soft); color: #995436; font-size: 10px; white-space: nowrap; }.planned-entry button:disabled { cursor: wait; opacity: .55; }
.history-rail { padding-left: 17px; border-left: 1px solid var(--line); }.history-list { display: grid; gap: 7px; margin-top: 14px; }.history-card { display: flex; align-items: stretch; gap: 2px; border: 1px solid var(--line); background: #fff; }.history-open { min-width: 0; flex: 1; padding: 11px 10px; border: 0; background: transparent; color: var(--ink); text-align: left; }.history-open:hover { background: var(--blue-soft); }.history-open strong, .history-open span, .history-open small { display: block; }.history-open strong { overflow: hidden; font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.history-open span { margin-top: 5px; color: #58645f; font: 9px var(--mono); }.history-open small { margin-top: 5px; color: var(--muted); font-size: 9px; }.history-reopen { display: inline-flex; align-items: center; gap: 4px; align-self: center; margin-right: 6px; padding: 5px 6px; border: 1px solid #d5b294; background: #fffaf4; color: #a45836; font: 9px var(--mono); }.history-reopen:hover { background: var(--orange-soft); }.history-empty { display: grid; justify-items: start; gap: 8px; margin: 14px 0 0; padding: 18px 0; color: var(--muted); }.history-empty p { margin: 0; font-size: 10px; line-height: 1.6; }.archive-note { display: flex; gap: 8px; margin-top: 20px; padding-top: 13px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; line-height: 1.55; }.archive-note svg { flex: 0 0 auto; color: var(--blue); }
@media (max-width: 900px) { .launcher-grid { grid-template-columns: 1fr; }.history-rail { padding: 0; border: 0; } }
@media (max-width: 600px) { .planned-entry { align-items: stretch; flex-wrap: wrap; }.planned-entry-copy { flex-basis: calc(100% - 48px); }.planned-entry button { width: 100%; justify-content: center; } }
</style>
