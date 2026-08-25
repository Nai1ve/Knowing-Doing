<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Bot, Pin, Send } from 'lucide-vue-next'
import type { PinnedReference, TutorMessage } from '@/types/domain'

const props = defineProps<{ messages: TutorMessage[]; loading?: boolean }>()
const emit = defineEmits<{ ask: [question: string]; pin: [reference: PinnedReference] }>()
const input = ref('')
const thread = ref<HTMLElement>()
const prompts = ['我不懂为什么', '把问题拆开', '用知乎回答对照']
const canSend = computed(() => input.value.trim().length > 0 && !props.loading)

function send(question = input.value) {
  if (!question.trim() || props.loading) return
  emit('ask', question.trim())
  input.value = ''
  void nextTick(() => { if (thread.value) thread.value.scrollTop = thread.value.scrollHeight })
}
</script>

<template>
  <section class="tutor-panel" aria-label="Tutor Agent 与知乎知识">
    <div class="rail-heading"><h3><Bot :size="15" aria-hidden="true" />Tutor Agent · 知行</h3><span>对话中 · 知乎知识</span></div>
    <p class="ai-context">我已读到你的当前节点和 YAML；接下来要确认你是否理解“期望状态”如何变成实际副本。</p>
    <div class="ai-question">如果 replicas 设置为 3，但只有 2 个 Pod Ready，你先看什么？<button class="inline-pin" type="button" @click="emit('pin', { id: 'current-question', title: '当前讨论问题', body: '如果 replicas 设置为 3，但只有 2 个 Pod Ready，你先看什么？', source: 'Tutor Agent' })"><Pin :size="12" aria-hidden="true" />固定</button></div>
    <div class="ai-prompts"><button v-for="prompt in prompts" :key="prompt" type="button" @click="send(prompt)">{{ prompt }}</button></div>
    <div ref="thread" class="ai-thread" aria-live="polite">
      <article v-for="message in messages" :key="message.id" class="chat-message" :class="message.role">
        <p v-if="message.source" class="source-label">{{ message.source }}</p><p>{{ message.content }}</p>
        <button v-if="message.role !== 'source'" class="message-pin" type="button" @click="emit('pin', { id: message.id, title: message.role === 'user' ? '我的问题' : '知行 AI 的回答', body: message.content, source: 'Tutor Agent 对话' })"><Pin :size="11" aria-hidden="true" />固定</button>
      </article>
      <p v-if="loading" class="typing-status" role="status">Tutor Agent 正在整理知乎相关知识…</p>
    </div>
    <form class="ai-composer" @submit.prevent="send()"><label class="sr-only" for="tutor-input">继续追问 Tutor Agent</label><textarea id="tutor-input" v-model="input" rows="2" placeholder="继续追问当前问题…" @keydown.meta.enter.prevent="send()" @keydown.ctrl.enter.prevent="send()" /><button class="send-button" type="submit" :disabled="!canSend" aria-label="发送问题"><Send :size="14" aria-hidden="true" /></button></form>
  </section>
</template>

<style scoped>
.tutor-panel { padding: 13px; border-top: 2px solid var(--blue); background: #f0f0e8; }
.rail-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rail-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; color: #303738; font-family: var(--serif); font-size: 16px; font-weight: 400; }
.rail-heading span { color: #7d8581; font-family: var(--mono); font-size: 8px; }
.ai-context { margin: 8px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.ai-question { margin-top: 10px; padding: 9px; border-left: 2px solid var(--blue); background: #f5f5ee; color: #3f4946; font-size: 11px; line-height: 1.5; }
.inline-pin, .message-pin { display: inline-flex; align-items: center; gap: 3px; padding: 0; border: 0; background: transparent; color: #8f6b56; font-size: 8px; }
.inline-pin { float: right; margin-left: 6px; }
.inline-pin:hover, .message-pin:hover { color: var(--orange); text-decoration: underline; }
.ai-prompts { display: grid; gap: 5px; margin-top: 9px; }
.ai-prompts button { padding: 6px 7px; border: 1px solid #c8ccdc; background: transparent; color: #5a6560; font-size: 9px; text-align: left; }
.ai-prompts button:hover { border-color: var(--blue); color: #3347af; background: var(--blue-soft); }
.ai-thread { display: grid; gap: 7px; max-height: 220px; margin-top: 10px; overflow-y: auto; padding-right: 2px; }
.chat-message { position: relative; padding: 8px; border: 1px solid #c8ccdc; color: #4d5753; font-size: 10px; line-height: 1.5; }
.chat-message p { margin: 0; }
.chat-message + .chat-message { margin-top: 0; }
.chat-message.assistant { border-left: 2px solid var(--blue); background: #f5f5ee; }
.chat-message.user { border-right: 2px solid var(--orange); background: #f1f2fb; }
.chat-message.source { border-left: 2px solid var(--orange); background: var(--orange-soft); }
.source-label { margin-bottom: 5px !important; color: #a45836; font-family: var(--mono); font-size: 8px; }
.message-pin { margin-top: 6px; }
.typing-status { margin: 0; color: var(--green); font-size: 9px; }
.ai-composer { display: grid; grid-template-columns: 1fr 32px; gap: 6px; margin-top: 9px; }
.ai-composer textarea { width: 100%; min-height: 42px; resize: vertical; padding: 7px; border: 1px solid #c8cbc2; border-radius: 0; background: #fff; color: #4d5753; font: 10px/1.45 var(--sans); }
.send-button { align-self: end; display: grid; place-items: center; min-height: 32px; border: 1px solid var(--blue); background: var(--blue); color: #fff; }
.send-button:hover:not(:disabled) { background: var(--blue-deep); }
.send-button:disabled { cursor: not-allowed; opacity: .45; }
</style>
