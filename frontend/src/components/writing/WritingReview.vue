<script setup lang="ts">
import { AlertTriangle, CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-vue-next'
import type { ProductWritingProject } from '@/types/product'

defineProps<{ project: ProductWritingProject; saving: boolean }>()
const emit = defineEmits<{ review: [] }>()
</script>

<template>
  <section class="writing-section review-panel" aria-labelledby="review-title">
    <div class="section-heading"><div><div class="eyebrow">04 · Evidence review</div><h2 id="review-title">发布前检查</h2><p>知行不会把没有证据的判断直接写成结论。处理阻断项后，才会开放知乎预览。</p></div><button class="ghost-button" type="button" :disabled="saving" @click="emit('review')"><ShieldCheck :size="13" aria-hidden="true" />重新检查</button></div>
    <div class="review-summary"><div><strong>{{ project.reviewItems.filter((item) => item.severity === 'blocking' && item.status === 'open').length }}</strong><span>阻断项</span></div><div><strong>{{ project.reviewItems.filter((item) => item.severity === 'warning' && item.status === 'open').length }}</strong><span>待确认项</span></div><div><strong>{{ project.status === 'ready_for_preview' ? '可以' : '暂不可' }}</strong><span>知乎预览</span></div></div>
    <div v-if="project.reviewItems.length === 0" class="clean-review"><CheckCircle2 :size="16" aria-hidden="true" /><span>当前没有自动发现的问题，可以继续人工通读文章。</span></div>
    <ul v-else class="review-list"><li v-for="item in project.reviewItems" :key="item.id" :class="item.severity"><span class="review-icon"><CircleAlert v-if="item.severity === 'blocking'" :size="14" aria-hidden="true" /><AlertTriangle v-else :size="14" aria-hidden="true" /></span><span><strong>{{ item.severity === 'blocking' ? '需要处理' : '建议确认' }}</strong><span>{{ item.message }}</span></span></li></ul>
  </section>
</template>

<style scoped>
.writing-section { border-top: 2px solid var(--blue); background: var(--paper-muted); }.section-heading { display: flex; justify-content: space-between; gap: 18px; padding: 17px 18px 14px; border-bottom: 1px solid var(--line); }.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px/1.25 var(--serif); }.section-heading p { max-width: 620px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }.section-heading button { display: inline-flex; align-items: center; gap: 5px; align-self: start; white-space: nowrap; }.review-summary { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line); }.review-summary div { display: grid; gap: 5px; padding: 16px 18px; border-right: 1px solid var(--line); }.review-summary div:last-child { border-right: 0; }.review-summary strong { color: var(--ink); font: 22px var(--serif); }.review-summary span { color: var(--muted); font: 9px var(--mono); }.clean-review { display: flex; align-items: center; gap: 8px; padding: 21px 18px; color: var(--green); font-size: 11px; }.review-list { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; background: var(--line); }.review-list li { display: flex; gap: 10px; padding: 14px 18px; background: var(--paper-muted); }.review-list li.warning { color: #99653c; }.review-list li.blocking { color: var(--red); }.review-icon { flex: 0 0 auto; margin-top: 1px; }.review-list strong, .review-list li span span { display: block; }.review-list strong { font-size: 10px; }.review-list li span span { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.5; }
@media (max-width: 560px) { .section-heading { display: block; }.section-heading button { margin-top: 13px; }.review-summary strong { font-size: 18px; } }
</style>
