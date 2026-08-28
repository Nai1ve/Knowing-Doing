<script setup lang="ts">
import { computed, onMounted } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import PracticeLog from '@/components/notes/PracticeLog.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import { usePlanStore } from '@/stores/plan'
import { useLessonStore } from '@/stores/lesson'
import { useNotesStore } from '@/stores/notes'
import { usePracticeStore } from '@/stores/practice'

const planStore = usePlanStore()
const lessonStore = useLessonStore()
const notesStore = useNotesStore()
const practiceStore = usePracticeStore()
const productEvents = computed(() => (practiceStore.snapshot?.events ?? []).map((event) => ({ id: event.id, type: event.type === 'evidence_captured' ? 'evidence' as const : event.type === 'user_message' ? 'question' as const : event.type === 'artifact_added' ? 'reference' as const : event.type === 'tutor_reply' ? 'observation' as const : 'observation' as const, title: event.type, body: JSON.stringify(event.payload), source: event.actor, createdAt: event.createdAt })))
const filteredEvents = computed(() => {
  const events = practiceStore.snapshot ? productEvents.value : lessonStore.events
  return notesStore.filter === 'all' ? events : events.filter((event) => event.type === notesStore.filter)
})

onMounted(() => {
  if (planStore.plan) void lessonStore.load('lesson-02-03', planStore.plan.id)
})

function updateStage(stage: 'capture' | 'outline' | 'article') { notesStore.stage = stage }
function updateFilter(filter: typeof notesStore.filter) { notesStore.filter = filter }
function createOutline() { if (practiceStore.run) void notesStore.createProductOutline(practiceStore.run.id); else if (planStore.plan) void notesStore.createOutline(planStore.plan.id) }
function createArticle() { if (practiceStore.run) void notesStore.completeProductArticle(practiceStore.run.id); else void notesStore.completeArticle() }
function save() { if (planStore.plan) void notesStore.save(planStore.plan.id) }
</script>

<template>
  <div class="page notes-page">
    <PageHeader eyebrow="04 · Distill" title="把实践整理成自己的知识。" description="知行默认记录你参考了什么、提出了什么问题、遇到了什么错误。你先确认大纲，再决定哪些内容由 AI 完成，最后人工确认是否发布到知乎。" :meta="['实践记录 → 大纲 → 成文', 'AI 生成草稿', '人工确认发布']" />
    <AsyncState :loading="lessonStore.loading" :error="lessonStore.error"><template #default><div class="notes-layout"><PracticeLog id="note-capture" :events="filteredEvents" :filter="notesStore.filter" @update:filter="updateFilter" /><NoteEditor id="note-outline" :stage="notesStore.stage" :outline="notesStore.outline" :article="notesStore.article" :generating-outline="notesStore.generatingOutline" :generating-article="notesStore.generatingArticle" :status="notesStore.status" @update:stage="updateStage" @update:outline="notesStore.outline = $event" @update:article="notesStore.article = $event" @outline="createOutline" @article="createArticle" @save="save" /></div><section id="note-article" class="publish-boundary" aria-labelledby="publish-title"><div><div class="eyebrow">Human confirmation before publishing</div><h2 id="publish-title">发布到知乎</h2><p>正式版会在这里接入知乎 OAuth。当前只保留发布前检查状态，不会伪造已发布结果。</p></div><span class="publish-status">待接入知乎发布</span></section></template></AsyncState>
  </div>
</template>

<style scoped>
.notes-page { max-width: 940px; } .notes-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 25px; margin-top: 23px; } .publish-boundary { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 28px; padding: 15px 16px; border-top: 2px solid var(--blue); background: var(--blue-soft); } .publish-boundary h2 { margin: 7px 0 0; color: #33409c; font: 400 22px var(--serif); } .publish-boundary p { max-width: 580px; margin: 7px 0 0; color: #616b83; font-size: 10px; line-height: 1.55; } .publish-status { padding: 6px 8px; border: 1px solid #aeb7ee; color: #4e5bb4; font: 9px var(--mono); white-space: nowrap; }
@media (max-width: 820px) { .notes-layout { grid-template-columns: 1fr; gap: 14px; } } @media (max-width: 560px) { .publish-boundary { align-items: start; flex-direction: column; } .publish-status { white-space: normal; } }
</style>
