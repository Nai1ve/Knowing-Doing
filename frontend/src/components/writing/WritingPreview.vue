<script setup lang="ts">
import { Copy, ExternalLink } from 'lucide-vue-next'
import type { ProductWritingDocument, ProductWritingProject } from '@/types/product'

defineProps<{ project: ProductWritingProject; document: ProductWritingDocument | null }>()
const emit = defineEmits<{ copy: [] }>()
</script>

<template>
  <section class="writing-section preview-panel" aria-labelledby="preview-title">
    <div class="section-heading"><div><div class="eyebrow">05 · Zhihu preview</div><h2 id="preview-title">知乎文章预览</h2><p>这是发布前的高保真预览。当前不会调用知乎写接口，也不会宣称文章已经发布。</p></div><button class="primary-button" type="button" @click="emit('copy')"><Copy :size="13" aria-hidden="true" />复制 Markdown</button></div>
    <div v-if="project.status !== 'ready_for_preview'" class="preview-blocked">完成实践验证和发布前检查后，文章预览才会开放。</div>
    <article v-else-if="document" class="preview-article"><h1>{{ document.title }}</h1><p class="preview-summary">{{ document.summary }}</p><section v-for="section in document.sections" :key="section.id"><h2>{{ section.title }}</h2><p v-for="(paragraph, index) in section.content.split('\n')" :key="`${section.id}-${index}`">{{ paragraph }}</p></section><footer><span>知行工程实践复盘</span><span>来源与证据已在后台保留索引</span></footer></article>
    <div v-else class="preview-blocked">还没有文章初稿。</div>
    <div class="publish-note"><ExternalLink :size="14" aria-hidden="true" /><span>后续接入 OAuth 后，这里将增加“保存到知乎草稿”的操作，仍需用户最后确认。</span></div>
  </section>
</template>

<style scoped>
.writing-section { border-top: 2px solid var(--blue); background: var(--paper-muted); }.section-heading { display: flex; justify-content: space-between; gap: 18px; padding: 17px 18px 14px; border-bottom: 1px solid var(--line); }.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px/1.25 var(--serif); }.section-heading p { max-width: 620px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }.section-heading button { display: inline-flex; align-items: center; gap: 5px; align-self: start; white-space: nowrap; }.preview-blocked { padding: 24px 18px; color: var(--muted); font-size: 11px; }.preview-article { max-width: 720px; margin: 0 auto; padding: 33px 26px 38px; background: #fff; color: #29312f; }.preview-article h1 { margin: 0; font: 400 29px/1.25 var(--serif); }.preview-summary { margin: 12px 0 28px; color: var(--muted); font-size: 12px; line-height: 1.7; }.preview-article section { margin-top: 25px; }.preview-article section h2 { margin: 0 0 9px; font: 400 18px var(--serif); }.preview-article section p { margin: 5px 0; white-space: pre-wrap; color: #59635f; font-size: 12px; line-height: 1.8; }.preview-article footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 34px; padding-top: 13px; border-top: 1px solid var(--line); color: var(--muted); font: 9px var(--mono); }.publish-note { display: flex; gap: 8px; padding: 13px 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; line-height: 1.5; }.publish-note svg { flex: 0 0 auto; color: var(--blue); }
@media (max-width: 560px) { .section-heading { display: block; }.section-heading button { margin-top: 13px; }.preview-article { padding: 24px 16px; }.preview-article h1 { font-size: 24px; }.preview-article footer { display: grid; } }
</style>
