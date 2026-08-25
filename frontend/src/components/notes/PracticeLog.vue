<script setup lang="ts">
import { AlertTriangle, HelpCircle, Lightbulb, Search, Eye } from 'lucide-vue-next'
import type { EventType, PracticeEvent } from '@/types/domain'

const props = defineProps<{ events: PracticeEvent[]; filter: EventType | 'all' }>()
const emit = defineEmits<{ 'update:filter': [filter: EventType | 'all'] }>()
const filters: Array<{ id: EventType | 'all'; label: string; icon?: typeof Search }> = [
  { id: 'all', label: '全部', icon: Search }, { id: 'reference', label: '参考', icon: Lightbulb }, { id: 'question', label: '问题', icon: HelpCircle }, { id: 'error', label: '错误', icon: AlertTriangle }, { id: 'observation', label: '观察', icon: Eye },
]
const labels: Record<EventType, string> = { reference: '参考内容', question: '我的问题', error: '遇到的错误', observation: '运行观察', evidence: '学习证据' }
const iconMap = { reference: Lightbulb, question: HelpCircle, error: AlertTriangle, observation: Eye, evidence: Search }
</script>

<template>
  <section class="practice-log" aria-labelledby="practice-log-title">
    <div class="log-heading"><div><div class="eyebrow">Captured from practice</div><h2 id="practice-log-title">实践记录</h2></div><span>{{ events.length }} 条素材</span></div>
    <div class="filter-row" role="group" aria-label="实践记录筛选"><button v-for="item in filters" :key="item.id" type="button" :class="{ active: props.filter === item.id }" :aria-pressed="props.filter === item.id" @click="emit('update:filter', item.id)"><component :is="item.icon" :size="12" aria-hidden="true" />{{ item.label }}</button></div>
    <div class="event-list">
      <article v-for="event in events" :key="event.id" class="event-row" :class="event.type"><div class="event-icon"><component :is="iconMap[event.type]" :size="13" aria-hidden="true" /></div><div class="event-copy"><div class="event-meta"><span>{{ labels[event.type] }}</span><time>{{ event.createdAt }}</time></div><h3>{{ event.title }}</h3><p>{{ event.body }}</p><small>{{ event.source }}</small></div></article>
      <p v-if="!events.length" class="empty-log">还没有实践素材。先在当前学习页接入一段 YAML、终端输出或问题。</p>
    </div>
  </section>
</template>

<style scoped>
.practice-log { padding-top: 18px; }
.log-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.log-heading h2 { margin: 7px 0 0; color: #303738; font: 400 23px var(--serif); }
.log-heading > span { color: var(--muted); font: 9px var(--mono); }
.filter-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 13px; }
.filter-row button { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 5px 8px; border: 1px solid var(--line); background: transparent; color: #68716d; font-size: 9px; }
.filter-row button:hover, .filter-row button.active { border-color: var(--blue); background: var(--blue-soft); color: var(--blue); }
.event-list { display: grid; gap: 0; margin-top: 8px; }
.event-row { display: grid; grid-template-columns: 25px 1fr; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line-soft); }
.event-icon { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid #c7c9c0; color: var(--muted); }
.event-row.reference .event-icon { border-color: #c0c8a6; color: var(--green); } .event-row.question .event-icon { border-color: #b8c1ec; color: var(--blue); } .event-row.error .event-icon { border-color: #dbb7a6; color: var(--red); } .event-row.observation .event-icon { border-color: #d1c1b3; color: var(--orange); }
.event-meta { display: flex; justify-content: space-between; gap: 8px; color: #7a827d; font: 8px var(--mono); }
.event-copy h3 { margin: 5px 0 0; color: #3f4946; font-size: 12px; font-weight: 500; line-height: 1.45; }
.event-copy p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
.event-copy small { display: block; margin-top: 6px; color: #9b7160; font: 8px var(--mono); }
.empty-log { padding: 15px 0; color: var(--muted); font-size: 11px; }
</style>
