<script setup lang="ts">
import { Bot, Route, Send, UserRound } from 'lucide-vue-next'
import { ref } from 'vue'
import type { AgentPlanningMessage } from '@/types/product'

defineProps<{ messages: AgentPlanningMessage[]; streamingAssistant: string; question: string; loading: boolean; generating: boolean }>()
const emit = defineEmits<{ send: [message: string]; generate: []; retry: [] }>()
const input = ref('')
function submit() { const value = input.value.trim(); if (!value) return; emit('send', value); input.value = '' }
</script>

<template>
  <section class="planning-chat" aria-labelledby="planning-chat-title">
    <header class="chat-header"><div class="chat-kicker"><Bot :size="16" aria-hidden="true" /><span id="planning-chat-title">知行 Planner</span></div><span class="chat-state">自然对话 · 原话会保留</span></header>
    <div class="message-list">
      <article v-for="message in messages" :key="message.id" class="message" :class="message.role"><div class="avatar"><Bot v-if="message.role === 'assistant'" :size="13" aria-hidden="true" /><UserRound v-else :size="13" aria-hidden="true" /></div><div class="message-copy"><small>{{ message.role === 'assistant' ? '知行 Planner' : '你' }}</small><p>{{ message.content }}</p></div></article>
      <article v-if="streamingAssistant" class="message assistant active"><div class="avatar"><Bot :size="13" aria-hidden="true" /></div><div class="message-copy"><small>知行 Planner · 正在回复</small><p>{{ streamingAssistant }}</p></div></article>
    </div>
    <div class="next-question"><small>下一步可以聊聊</small><strong>{{ question || '你可以继续补充经历，也可以直接生成路线。' }}</strong></div>
    <form class="composer" @submit.prevent="submit"><textarea v-model="input" rows="3" :disabled="loading || generating" aria-label="发送给知行 Planner" placeholder="用自己的话回答，补充一个具体例子" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit" /><div class="composer-actions"><button class="secondary-button" type="button" :disabled="loading || generating" @click="emit('generate')"><Route :size="14" aria-hidden="true" />{{ generating ? '正在生成路线…' : '现在生成路线' }}</button><button class="primary-button" type="submit" :disabled="loading || generating || !input.trim()"><Send :size="14" aria-hidden="true" />发送</button></div></form>
  </section>
</template>

<style scoped>
.planning-chat { min-width: 0; }.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }.chat-kicker { display: inline-flex; align-items: center; gap: 8px; color: var(--blue); font: 10px var(--mono); }.chat-state { color: var(--muted); font: 9px var(--mono); }.message-list { display: grid; gap: 18px; max-height: 560px; overflow: auto; padding: 20px 3px 12px; }.message { display: flex; align-items: start; gap: 10px; max-width: 84%; }.message.user { justify-self: end; flex-direction: row-reverse; }.avatar { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 28px; height: 28px; border: 1px solid var(--line); background: var(--paper-deep); color: var(--blue); }.message.user .avatar { border-color: #ddb79f; background: var(--orange-soft); color: #a55d3e; }.message-copy { min-width: 0; }.message-copy small, .next-question small { color: var(--muted); font: 8px var(--mono); }.message-copy p { margin: 5px 0 0; padding: 10px 12px; border: 1px solid var(--line-soft); background: var(--paper-deep); color: #53605a; font-size: 12px; line-height: 1.65; white-space: pre-wrap; }.message.user .message-copy p { border-color: #ead6c7; background: var(--orange-soft); color: #684e40; }.message.active .message-copy p { border-color: #b5bdf0; background: var(--blue-soft); color: var(--ink); }.next-question { margin: 5px 0 0 38px; padding: 12px 13px; border-left: 2px solid var(--orange); background: var(--paper-muted); }.next-question strong { display: block; margin-top: 5px; color: var(--ink); font: 400 15px/1.45 var(--serif); }.composer { display: grid; gap: 9px; margin-top: 14px; padding-top: 14px; border-top: 2px solid var(--blue); }.composer textarea { width: 100%; resize: vertical; padding: 11px 12px; border: 1px solid var(--line); outline: none; background: var(--white); color: var(--ink); font: 12px/1.6 var(--sans); }.composer textarea:focus { border-color: var(--blue); }.composer-actions { display: flex; justify-content: end; gap: 8px; }.composer-actions button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; cursor: pointer; }.primary-button:disabled, .secondary-button:disabled { opacity: .55; cursor: wait; }
@media (max-width: 600px) { .message { max-width: 94%; }.composer-actions { flex-direction: column; }.composer-actions button { justify-content: center; } }
</style>
