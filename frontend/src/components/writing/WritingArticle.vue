<script setup lang="ts">
import { ref, watch } from 'vue'
import { Save } from 'lucide-vue-next'
import type { ProductWritingDocument, ProductWritingSection } from '@/types/product'

const props = defineProps<{ document: ProductWritingDocument | null; saving: boolean }>()
const emit = defineEmits<{ save: [document: ProductWritingDocument, section: ProductWritingSection, content: string] }>()
const drafts = ref<Record<string, string>>({})
watch(() => props.document, (document) => { if (document) drafts.value = Object.fromEntries(document.sections.map((section) => [section.id, section.content])) }, { immediate: true })
function content(section: ProductWritingSection) { return drafts.value[section.id] ?? section.content }
</script>

<template>
  <section class="writing-section article-panel" aria-labelledby="article-title">
    <div class="section-heading"><div><div class="eyebrow">03 · Draft</div><h2 id="article-title">把判断写成文章</h2><p>初稿只使用已选素材。修改某一节不会覆盖其他章节，保存后会产生新的文档 revision。</p></div><span class="review-badge">待人工审核</span></div>
    <div v-if="!document" class="empty-writing"><p>先确认大纲，再生成文章初稿。</p></div>
    <div v-else class="article-content"><div class="article-meta"><span>{{ document.title }}</span><span>revision {{ document.revision }}</span></div><article v-for="section in document.sections" :key="section.id" class="article-section"><div class="article-section-heading"><h3>{{ section.title }}</h3><span>{{ section.evidenceRefs.length + section.sourceRefs.length }} 个引用</span></div><textarea :id="`article-${section.id}`" :value="content(section)" rows="7" :aria-label="`${section.title}文章内容`" @input="drafts[section.id] = ($event.target as HTMLTextAreaElement).value" /><div class="article-actions"><span v-if="section.status === 'confirmed'">本节已保存</span><span v-else>编辑后保存本节</span><button class="secondary-button" type="button" :disabled="saving" @click="emit('save', document, section, content(section))"><Save :size="12" aria-hidden="true" />保存本节</button></div></article></div>
  </section>
</template>

<style scoped>
.writing-section { border-top: 2px solid var(--blue); background: var(--paper-muted); }.section-heading { display: flex; justify-content: space-between; gap: 18px; padding: 17px 18px 14px; border-bottom: 1px solid var(--line); }.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px/1.25 var(--serif); }.section-heading p { max-width: 620px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }.review-badge { align-self: start; padding: 6px 8px; border: 1px solid #d6b69c; color: #99653c; font: 9px var(--mono); white-space: nowrap; }
.empty-writing { padding: 28px 18px; color: var(--muted); font-size: 11px; }.empty-writing p { margin: 0; }.article-content { padding: 15px 18px; }.article-meta { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font: 9px var(--mono); }.article-section { margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--line); }.article-section-heading { display: flex; justify-content: space-between; gap: 10px; }.article-section-heading h3 { margin: 0; color: var(--ink); font-size: 13px; }.article-section-heading span { color: var(--muted); font: 9px var(--mono); }textarea { display: block; width: 100%; margin-top: 10px; resize: vertical; padding: 10px; border: 1px solid var(--line); background: #fff; color: var(--ink); font: 11px/1.7 var(--sans); }.article-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; color: var(--muted); font: 9px var(--mono); }.article-actions button { display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 560px) { .section-heading { display: block; }.review-badge { display: inline-block; margin-top: 12px; }.article-actions { align-items: stretch; flex-direction: column; } }
</style>
