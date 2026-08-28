<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, CircleX, Clock3, Database, LoaderCircle, Play, RotateCcw, Square } from 'lucide-vue-next'
import type { LabCaseId, LabCaseSummary, LabHealth, LabQueueTicket, LabRun } from '@/types/lab'

const props = defineProps<{
  health: LabHealth | null
  cases: LabCaseSummary[]
  selectedCaseId: LabCaseId
  run: LabRun | null
  ticket: LabQueueTicket | null
  starting: boolean
  polling: boolean
  resetting: boolean
  ending: boolean
}>()

const emit = defineEmits<{
  start: []
  reset: []
  end: []
  cancel: []
  select: [caseId: LabCaseId]
}>()

const selectedFixture = computed(() => props.health?.fixtures[props.selectedCaseId])
const runIdleExpiry = computed(() => props.run ? new Date(props.run.idleExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
</script>

<template>
  <section class="lab-run-panel" aria-labelledby="lab-run-title">
    <div class="panel-heading">
      <div>
        <div class="eyebrow">Runtime · MySQL 8.4</div>
        <h2 id="lab-run-title">实验环境</h2>
      </div>
      <span class="health-badge" :class="selectedFixture?.ready ? 'ready' : 'offline'">
        <CircleCheck v-if="selectedFixture?.ready" :size="13" aria-hidden="true" />
        <CircleX v-else :size="13" aria-hidden="true" />
        {{ selectedFixture?.ready ? '可用' : '不可用' }}
      </span>
    </div>

    <div class="case-list" aria-label="案例列表">
      <button
        v-for="item in cases"
        :key="item.id"
        type="button"
        class="case-item"
        :class="{ selected: item.id === selectedCaseId, disabled: item.id !== 'mysql-order-list-index-001' }"
        :disabled="item.id !== 'mysql-order-list-index-001' || Boolean(run) || Boolean(ticket)"
        @click="emit('select', item.id)"
      >
        <span class="case-dot" />
        <span><strong>{{ item.title }}</strong><small>{{ item.id === 'mysql-order-list-index-001' ? '当前联调案例' : '后续开放' }}</small></span>
      </button>
    </div>

    <div v-if="run" class="run-status active">
      <div class="status-icon"><Database :size="14" aria-hidden="true" /></div>
      <div><strong>Run 已连接</strong><span>revision {{ run.revision }} · 空闲回收至 {{ runIdleExpiry }}</span></div>
    </div>
    <div v-else-if="ticket" class="run-status waiting">
      <div class="status-icon"><Clock3 :size="14" aria-hidden="true" /></div>
      <div><strong>正在排队 · 第 {{ ticket.position ?? '—' }} 位</strong><span>{{ polling ? '自动刷新队列状态' : '等待队列状态' }}</span></div>
    </div>

    <div class="run-actions">
      <button v-if="!run && !ticket" class="primary-button" type="button" :disabled="starting || !selectedFixture?.ready" @click="emit('start')">
        <LoaderCircle v-if="starting" class="spin" :size="13" aria-hidden="true" /><Play v-else :size="13" aria-hidden="true" />
        {{ starting ? '正在连接…' : '启动实验' }}
      </button>
      <template v-else-if="run">
        <button class="secondary-button" type="button" :disabled="resetting || ending" @click="emit('reset')"><RotateCcw :size="13" aria-hidden="true" />{{ resetting ? '重置中…' : '重置环境' }}</button>
        <button class="danger-button" type="button" :disabled="resetting || ending" @click="emit('end')"><Square :size="12" aria-hidden="true" />{{ ending ? '结束中…' : '结束实验' }}</button>
      </template>
      <button v-else class="secondary-button" type="button" @click="emit('cancel')">取消排队</button>
    </div>
  </section>
</template>

<style scoped>
.lab-run-panel { padding: 15px; border: 1px solid var(--line); background: var(--paper-deep); }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.panel-heading h2 { margin: 4px 0 0; color: var(--ink); font: 400 20px var(--serif); }
.health-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border: 1px solid var(--line); font-size: 10px; }
.health-badge.ready { border-color: #a8c3ad; background: var(--green-soft); color: #3e7650; }
.health-badge.offline { border-color: #dfb1a9; background: var(--red-soft); color: var(--red); }
.case-list { display: grid; gap: 5px; margin-top: 12px; }
.case-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px; border: 1px solid transparent; background: transparent; color: var(--ink); text-align: left; }
.case-item.selected { border-color: #b8c1ec; background: var(--blue-soft); }
.case-item.disabled { color: var(--muted); opacity: .62; cursor: not-allowed; }
.case-dot { width: 6px; height: 6px; flex: 0 0 auto; background: var(--orange); }
.case-item strong, .case-item small { display: block; }
.case-item strong { font-size: 11px; font-weight: 500; }
.case-item small { margin-top: 3px; color: var(--muted); font-size: 9px; }
.run-status { display: flex; align-items: center; gap: 9px; margin-top: 12px; padding: 9px; border-left: 2px solid var(--green); background: var(--green-soft); }
.run-status.waiting { border-left-color: var(--orange); background: var(--orange-soft); }
.status-icon { color: var(--green); }
.waiting .status-icon { color: var(--orange); }
.run-status strong, .run-status span { display: block; }
.run-status strong { color: var(--ink); font-size: 11px; font-weight: 500; }
.run-status span { margin-top: 3px; color: var(--muted); font: 9px var(--mono); }
.run-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.run-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.danger-button { min-height: 32px; padding: 7px 11px; border: 1px solid #d5aaa3; background: transparent; color: var(--red); font-size: 10px; }
.danger-button:hover { background: var(--red-soft); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
