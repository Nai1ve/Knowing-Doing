<script setup lang="ts">
import { Check, ExternalLink, Link2Off } from 'lucide-vue-next'
import type { OAuthConnection } from '@/types/domain'

defineProps<{ connection: OAuthConnection }>()
const emit = defineEmits<{ connect: []; disconnect: [] }>()
const labels: Record<OAuthConnection['provider'], { name: string; description: string }> = { zhihu: { name: '知乎', description: '检索回答、读取你主动授权的收藏，并在发布前确认文章。' }, model: { name: '模型服务', description: '为 Tutor Agent、学习方案和文章草稿提供模型能力。' } }
</script>

<template>
  <article class="connection-card">
    <div class="connection-mark" :class="connection.provider">知</div>
    <div class="connection-body"><div class="connection-top"><div><div class="eyebrow">{{ connection.provider === 'zhihu' ? 'ZH I HU' : 'MODEL PROVIDER' }}</div><h3>{{ labels[connection.provider].name }}</h3></div><span class="connection-status" :class="connection.status"><Check v-if="connection.status === 'connected'" :size="11" aria-hidden="true" />{{ connection.status === 'connected' ? '已连接' : connection.status === 'pending' ? '等待授权' : '未连接' }}</span></div><p>{{ labels[connection.provider].description }}</p><div class="scopes"><span v-for="scope in connection.scopes" :key="scope">{{ scope }}</span></div><div class="connection-actions"><button v-if="connection.status !== 'connected'" class="primary-button" type="button" @click="emit('connect')"><ExternalLink :size="13" aria-hidden="true" />授权连接</button><button v-else class="secondary-button" type="button" @click="emit('disconnect')"><Link2Off :size="13" aria-hidden="true" />断开连接</button></div></div>
  </article>
</template>

<style scoped>
.connection-card { display: grid; grid-template-columns: 42px 1fr; gap: 13px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.connection-mark { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid var(--blue); color: var(--blue); font: 18px var(--serif); } .connection-mark.model { border-color: var(--orange); color: var(--orange); }
.connection-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; } .connection-top h3 { margin: 5px 0 0; color: #3f4946; font: 400 18px var(--serif); } .connection-status { display: inline-flex; align-items: center; gap: 4px; color: #8a918c; font: 9px var(--mono); } .connection-status.connected { color: var(--green); }
.connection-body > p { max-width: 580px; margin: 7px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; } .scopes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; } .scopes span { padding: 4px 6px; border: 1px solid #d1d4cb; color: #727b75; font-size: 9px; }
.connection-actions { margin-top: 10px; } .connection-actions button { display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 500px) { .connection-card { grid-template-columns: 1fr; } }
</style>
