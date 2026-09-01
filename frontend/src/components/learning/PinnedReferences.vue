<script setup lang="ts">
import { ExternalLink, Pin, X } from 'lucide-vue-next'
import type { ProductPracticePin } from '@/types/product'
import MarkdownContent from './MarkdownContent.vue'

defineProps<{ items: ProductPracticePin[] }>()
const emit = defineEmits<{ remove: [pinId: string] }>()
</script>

<template>
  <section class="pin-shelf" aria-labelledby="pin-shelf-title">
    <div class="shelf-heading">
      <div>
        <div class="eyebrow">Saved in this practice</div>
        <h2 id="pin-shelf-title"><Pin :size="16" aria-hidden="true" />固定内容</h2>
      </div>
      <span class="shelf-count">{{ items.length }} 条</span>
    </div>
    <p class="shelf-description">把本轮判断、实验结果或知乎参考留在工作台，之后可以继续回看。</p>
    <div v-if="items.length" class="pinned-list">
      <article v-for="item in items" :key="item.id" class="pinned-item">
        <div class="pin-content">
          <strong>{{ item.title }}</strong>
          <MarkdownContent :content="item.body" />
          <small>{{ item.source }}</small>
        </div>
        <div class="pin-actions">
          <a v-if="item.url" :href="item.url" target="_blank" rel="noreferrer" :aria-label="`打开来源：${item.title}`" title="打开来源"><ExternalLink :size="13" aria-hidden="true" /></a>
          <button type="button" :aria-label="`取消固定：${item.title}`" title="取消固定" @click="emit('remove', item.id)"><X :size="13" aria-hidden="true" /></button>
        </div>
      </article>
    </div>
    <p v-else class="empty-pins">对话或实验结果中出现值得复用的内容时，可以固定到这里。</p>
  </section>
</template>

<style scoped>
.pin-shelf { padding: 16px 17px; border-top: 2px solid var(--orange); background: var(--orange-soft); }
.shelf-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.shelf-heading h2 { display: flex; align-items: center; gap: 7px; margin: 5px 0 0; color: #4c5651; font: 400 19px var(--serif); }
.shelf-heading h2 svg { color: #a45836; }
.shelf-count { color: #806049; font: 9px var(--mono); }
.shelf-description { margin: 6px 0 0; color: #766f69; font-size: 10px; line-height: 1.5; }
.pinned-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 13px; }
.pinned-item { display: flex; justify-content: space-between; gap: 10px; min-width: 0; padding: 11px 12px; border: 1px solid #ddcbbb; background: rgba(255, 255, 255, .54); }
.pin-content { min-width: 0; }
.pin-content > strong { display: block; color: #4d5753; font-size: 11px; font-weight: 600; line-height: 1.4; }
.pin-content :deep(.markdown-content) { margin-top: 5px; color: #6f6862; font-size: 10px; line-height: 1.5; }
.pin-content :deep(.markdown-content p) { margin: 0; }
.pin-content :deep(.markdown-content pre) { margin: 5px 0; padding: 7px; }
.pin-content :deep(.markdown-content pre code) { font-size: 9px; }
.pin-content small { display: block; margin-top: 6px; color: #a45836; font: 8px var(--mono); }
.pin-actions { display: flex; align-items: flex-start; gap: 2px; flex: 0 0 auto; }
.pin-actions a, .pin-actions button { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; background: transparent; color: #a45836; }
.pin-actions a:hover, .pin-actions button:hover { background: #eaded2; color: #85452c; }
.empty-pins { margin: 13px 0 0; color: #8a7d73; font-size: 10px; }
@media (max-width: 700px) { .pinned-list { grid-template-columns: 1fr; } }
</style>
