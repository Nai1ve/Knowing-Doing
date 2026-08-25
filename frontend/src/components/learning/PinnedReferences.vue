<script setup lang="ts">
import { Pin, X } from 'lucide-vue-next'
import type { PinnedReference } from '@/types/domain'
defineProps<{ items: PinnedReference[] }>()
const emit = defineEmits<{ remove: [id: string] }>()
</script>

<template>
  <section class="pin-board" aria-label="工作台固定参考">
    <div class="rail-heading"><h3><Pin :size="15" aria-hidden="true" />工作台固定参考</h3><span>{{ items.length }} 条</span></div>
    <p>把本次任务会用到的示例放在这里；对话中出现新的高价值内容时继续固定。</p>
    <div class="pinned-list">
      <article v-for="item in items" :key="item.id" class="pinned-item"><div><strong>{{ item.title }}</strong><p>{{ item.body }}</p><small>{{ item.source }}</small></div><button type="button" :aria-label="`取消固定：${item.title}`" @click="emit('remove', item.id)"><X :size="13" aria-hidden="true" /></button></article>
    </div>
  </section>
</template>

<style scoped>
.pin-board { margin-top: 18px; padding: 13px 14px; border-top: 2px solid var(--orange); background: var(--orange-soft); }
.rail-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rail-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; color: #4c5651; font-family: var(--serif); font-size: 16px; font-weight: 400; }
.rail-heading span { color: #7d8581; font-family: var(--mono); font-size: 8px; }
.pin-board > p { margin: 4px 0 0; color: #777f7b; font-size: 9px; line-height: 1.45; }
.pinned-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 9px; }
.pinned-item { display: flex; justify-content: space-between; gap: 8px; padding-top: 7px; border-top: 1px solid #d7cabc; }
.pinned-item strong { display: block; color: #4d5753; font-size: 10px; font-weight: 500; line-height: 1.4; }
.pinned-item p { margin: 3px 0 0; color: #6f7874; font-size: 9px; line-height: 1.4; }
.pinned-item small { display: block; margin-top: 4px; color: #a45836; font-family: var(--mono); font-size: 8px; }
.pinned-item button { flex: 0 0 auto; width: 24px; height: 24px; padding: 4px; border: 0; background: transparent; color: #a45836; }
.pinned-item button:hover { background: #eaded2; }
@media (max-width: 700px) { .pinned-list { grid-template-columns: 1fr; } }
</style>
