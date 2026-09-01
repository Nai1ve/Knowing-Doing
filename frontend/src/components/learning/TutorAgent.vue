<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpen, ExternalLink, LoaderCircle, Pin, RotateCcw, Send, Sparkles } from 'lucide-vue-next'
import MarkdownContent from './MarkdownContent.vue'
import type { ProductPracticePin, ProductTutorMessage, ProductTutorSource } from '@/types/product'

const props = defineProps<{
  messages: ProductTutorMessage[]
  sources: ProductTutorSource[]
  sourceStatus?: string
  loading: boolean
  currentQuestion?: string
  currentGap?: string
  failure?: { invocationId: string; code: string; message: string; retryable: boolean } | null
  pinnedIds?: string[]
  disabled?: boolean
}>()
const emit = defineEmits<{
  ask: [message: string]
  retry: []
  pin: [targetType: ProductPracticePin['targetType'], targetId: string]
}>()
const draft = ref('')
const transcript = ref<HTMLElement | null>(null)
const pinned = computed(() => new Set(props.pinnedIds ?? []))
const canSend = computed(() => Boolean(draft.value.trim()) && !props.loading && !props.disabled)
function submit() {
  const message = draft.value.trim()
  if (!message || props.loading || props.disabled) return
  emit('ask', message)
  draft.value = ''
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
function scrollToLatest() {
  void nextTick(() => {
    if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
  })
}
watch(() => props.messages.length, scrollToLatest)
watch(() => props.messages[props.messages.length - 1]?.content, scrollToLatest)
</script>

<template>
  <section class="tutor-agent" aria-labelledby="tutor-title">
    <header class="tutor-header">
      <div class="tutor-title">
        <span class="tutor-mark"><Sparkles :size="15" aria-hidden="true" /></span>
        <div><div class="eyebrow">Tutor Agent · 知乎知识</div><h2 id="tutor-title">和你的导师讨论</h2></div>
      </div>
      <span class="tutor-status" :class="{ working: loading }">
        <LoaderCircle v-if="loading" class="spin" :size="12" aria-hidden="true" />{{ loading ? '正在思考' : disabled ? '本次实践已收束' : '随时可问' }}
      </span>
    </header>
    <div class="tutor-context">
      <div v-if="currentGap" class="context-row"><span>当前缺口</span><strong>{{ currentGap }}</strong></div>
      <div v-if="currentQuestion" class="question-row"><span>下一步</span><p>{{ currentQuestion }}</p></div>
    </div>
    <div ref="transcript" class="tutor-transcript" aria-live="polite">
      <div v-if="!messages.length" class="tutor-empty">
        <BookOpen :size="22" aria-hidden="true" /><strong>从观察开始</strong>
        <p>告诉我你从慢日志和表结构里看到了什么。我会追问判断依据，不直接替你下结论。</p>
      </div>
      <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
        <div class="message-meta">
          <span>{{ message.role === 'assistant' ? '知行 Tutor' : '你' }}</span>
          <button v-if="message.role === 'assistant' && !message.id.startsWith('stream-') && !message.id.startsWith('local-')" type="button" class="message-pin" :class="{ pinned: pinned.has(message.id) }" :aria-label="pinned.has(message.id) ? '已固定这条回答' : '固定这条回答'" :title="pinned.has(message.id) ? '已固定' : '固定到工作台'" @click="emit('pin', 'artifact', message.id)"><Pin :size="13" aria-hidden="true" /></button>
        </div>
        <div v-if="message.role === 'assistant'" class="message-body"><MarkdownContent :content="message.content" /></div>
        <p v-else class="message-body plain-text">{{ message.content }}</p>
        <small v-if="message.source" class="message-source">{{ message.source }}</small>
      </article>
      <div v-if="failure" class="tutor-failure" role="alert">
        <div><strong>模型暂不可用</strong><p>{{ failure.message }}</p><small>{{ failure.code }}</small></div>
        <button v-if="failure.retryable" type="button" class="secondary-button" @click="emit('retry')"><RotateCcw :size="12" aria-hidden="true" />重试</button>
      </div>
    </div>
    <div v-if="sources.length" class="source-tray">
      <div class="source-heading"><span><BookOpen :size="13" aria-hidden="true" />本轮参考</span><small>{{ sourceStatus === 'cached' ? '来自缓存' : sourceStatus ?? '知乎检索' }}</small></div>
      <div class="source-list">
        <article v-for="source in sources" :key="source.id" class="source-card">
          <div class="source-card-copy"><strong>{{ source.title }}</strong><p>{{ source.reason || source.excerpt }}</p><small>{{ source.author || '知乎' }} · {{ source.role }}</small></div>
          <div class="source-card-actions">
            <a :href="source.url" target="_blank" rel="noreferrer" :aria-label="'打开来源：' + source.title" title="打开知乎来源"><ExternalLink :size="12" aria-hidden="true" /></a>
            <button type="button" :class="{ pinned: pinned.has(source.id) }" :aria-label="pinned.has(source.id) ? '已固定来源' : '固定来源'" :title="pinned.has(source.id) ? '已固定' : '固定到工作台'" @click="emit('pin', 'source', source.id)"><Pin :size="12" aria-hidden="true" /></button>
          </div>
        </article>
      </div>
    </div>
    <form class="tutor-composer" @submit.prevent="submit">
      <label class="sr-only" for="tutor-input">向 Tutor 提问</label>
      <textarea id="tutor-input" v-model="draft" rows="3" :placeholder="disabled ? '本次实践已完成，可进入复盘与写作。' : '描述你的判断、错误或下一步想尝试的操作…'" :disabled="loading || disabled" @keydown="onKeydown" />
      <div class="composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><button class="primary-button" type="submit" :disabled="!canSend"><Send :size="13" aria-hidden="true" />发送</button></div>
    </form>
  </section>
</template>

<style scoped>
.tutor-agent { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto auto; height: 100%; min-height: 0; overflow: hidden; border: 1px solid #c9ccc5; background: #fff; }
.tutor-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 17px 14px; border-bottom: 1px solid var(--line); background: var(--paper-deep); }
.tutor-title { display: flex; align-items: center; gap: 10px; min-width: 0; }.tutor-mark { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid #c9b99f; background: #f8f0e6; color: #a45836; }
.tutor-title h2 { margin: 5px 0 0; color: var(--ink); font: 400 20px var(--serif); }.tutor-status { display: inline-flex; align-items: center; gap: 5px; padding-top: 4px; color: var(--green); font: 9px var(--mono); white-space: nowrap; }.tutor-status.working { color: var(--orange); }
.tutor-context { display: grid; gap: 8px; padding: 11px 17px; border-bottom: 1px solid var(--line-soft); background: #fbfaf4; }.context-row, .question-row { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 8px; align-items: start; }.context-row span, .question-row > span { color: var(--muted); font: 9px var(--mono); }.context-row strong { color: #4b5651; font-size: 10px; font-weight: 600; line-height: 1.45; }.question-row p { margin: 0; color: #5f6964; font-size: 10px; line-height: 1.5; }
.tutor-transcript { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 17px; background: #fff; }.tutor-empty { display: grid; place-items: center; min-height: 260px; padding: 28px; color: #a45836; text-align: center; }.tutor-empty strong { margin-top: 10px; color: #4c5651; font: 400 18px var(--serif); }.tutor-empty p { max-width: 260px; margin: 7px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.message { max-width: 94%; margin-bottom: 18px; }.message.user { margin-left: auto; }.message-meta { display: flex; align-items: center; gap: 8px; color: #858d88; font: 9px var(--mono); }.message.user .message-meta { justify-content: flex-end; }.message-pin { display: grid; place-items: center; width: 23px; height: 23px; padding: 0; border: 1px solid transparent; background: transparent; color: #89928d; }.message-pin:hover, .message-pin.pinned { border-color: #d9c3ad; background: #f8f0e6; color: #a45836; }
.message-body { min-width: 0; margin-top: 6px; overflow: hidden; padding: 11px 12px; border-left: 2px solid var(--blue); background: #f5f6fc; color: #44504c; }.message.user .message-body { border-left: 0; border-right: 2px solid var(--orange); background: #f5eee7; color: #62544b; }.plain-text { white-space: pre-wrap; font-size: 11px; line-height: 1.6; }.message-source { display: block; margin-top: 5px; color: #89928d; font: 8px var(--mono); }.message :deep(.markdown-content) { font-size: 11px; line-height: 1.65; }.message :deep(.markdown-content h1) { font-size: 17px; }.message :deep(.markdown-content h2) { font-size: 15px; }.message :deep(.markdown-content h3) { font-size: 13px; }.message :deep(.markdown-content pre) { margin: 8px 0; padding: 9px; font-size: 10px; }.message :deep(.markdown-content p) { margin: 5px 0; }
.tutor-failure { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 6px; padding: 11px 12px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); }.tutor-failure strong { font-size: 10px; }.tutor-failure p { margin: 4px 0; color: #714841; font-size: 10px; line-height: 1.5; }.tutor-failure small { font: 8px var(--mono); }
.source-tray { max-height: 210px; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 12px 17px; border-top: 1px solid var(--line); background: var(--paper-muted); }.source-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #4c5651; font: 10px var(--mono); }.source-heading span { display: inline-flex; align-items: center; gap: 6px; }.source-heading small { color: var(--muted); font-size: 8px; }.source-list { display: grid; gap: 7px; margin-top: 8px; }.source-card { display: flex; justify-content: space-between; gap: 8px; padding: 8px 9px; border: 1px solid var(--line); background: #fff; }.source-card-copy { min-width: 0; }.source-card-copy strong { display: block; overflow: hidden; color: var(--ink); font-size: 10px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }.source-card-copy p { display: -webkit-box; margin: 4px 0; overflow: hidden; color: var(--muted); font-size: 9px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }.source-card-copy small { color: #a45836; font: 8px var(--mono); }.source-card-actions { display: flex; gap: 2px; align-items: flex-start; flex: 0 0 auto; }.source-card-actions a, .source-card-actions button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--blue); text-decoration: none; }.source-card-actions a:hover, .source-card-actions button:hover, .source-card-actions button.pinned { background: var(--blue-soft); color: var(--blue-deep); }
.tutor-composer { padding: 12px 17px 14px; border-top: 1px solid var(--line); background: var(--paper-deep); }.tutor-composer textarea { display: block; width: 100%; resize: none; padding: 9px 10px; border: 1px solid #c7cbc3; background: #fff; color: var(--ink); font: 11px/1.55 var(--sans); }.tutor-composer textarea:focus { border-color: var(--blue); outline: 2px solid #dce0fb; }.composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; color: var(--muted); font: 8px var(--mono); }.composer-footer button { display: inline-flex; align-items: center; gap: 5px; }.spin { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1279px) { .tutor-agent { height: clamp(560px, calc(100dvh - 120px), 760px); } }
@media (max-width: 600px) { .tutor-agent { height: 620px; }.tutor-header, .tutor-context, .tutor-transcript, .source-tray, .tutor-composer { padding-inline: 13px; } }
</style>
