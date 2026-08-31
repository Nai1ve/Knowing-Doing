<script setup lang="ts">
import { ref, watch } from 'vue'
import { Check, Save, Sparkles } from 'lucide-vue-next'
import type { ProductWritingDocument, ProductWritingSection } from '@/types/product'

const props = defineProps<{ document: ProductWritingDocument | null; generating: boolean; saving: boolean }>()
const emit = defineEmits<{ generate: []; save: [document: ProductWritingDocument, section: ProductWritingSection, content: string] }>()
const drafts = ref<Record<string, string>>({})
watch(() => props.document, (document) => { if (document) drafts.value = Object.fromEntries(document.sections.map((section) => [section.id, section.content])) }, { immediate: true })
function content(section: ProductWritingSection) { return drafts.value[section.id] ?? section.content }
</script>

<template>
  <section class="writing-section editor-panel" aria-labelledby="outline-title">
    <div class="section-heading"><div><div class="eyebrow">02 · Outline review</div><h2 id="outline-title">确认你的判断路径</h2><p>大纲先于成文。每个章节都保留素材引用，标记“待补”的地方需要你补充或删除。</p></div><button class="ghost-button" type="button" :disabled="generating" @click="emit('generate')"><Sparkles :size="13" aria-hidden="true" />{{ generating ? '正在整理…' : '重新整理大纲' }}</button></div>
    <div v-if="!document" class="empty-writing"><p>还没有大纲。先在素材页确认内容，再生成一份工程复盘大纲。</p><button class="primary-button" type="button" :disabled="generating" @click="emit('generate')"><Sparkles :size="13" aria-hidden="true" />生成大纲</button></div>
    <div v-else class="section-list">
      <article v-for="section in document.sections" :key="section.id" class="editable-section">
        <div class="section-title"><span class="section-number">{{ String(section.position).padStart(2, '0') }}</span><div><h3>{{ section.title }}</h3><span>{{ section.evidenceRefs.length }} 条实验引用 · {{ section.sourceRefs.length }} 条来源引用</span></div><Check v-if="section.status === 'confirmed'" :size="15" class="confirmed" aria-label="已确认" /></div>
        <textarea :id="`outline-${section.id}`" :value="content(section)" rows="5" :aria-label="`${section.title}大纲`" @input="drafts[section.id] = ($event.target as HTMLTextAreaElement).value" />
        <div class="section-footer"><span>{{ section.required ? '必填章节' : '可选章节' }}</span><button class="secondary-button" type="button" :disabled="saving" @click="emit('save', document, section, content(section))"><Save :size="12" aria-hidden="true" />保存本节</button></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.writing-section { border-top: 2px solid var(--blue); background: var(--paper-muted); }
.section-heading { display: flex; justify-content: space-between; gap: 18px; padding: 17px 18px 14px; border-bottom: 1px solid var(--line); }
.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px/1.25 var(--serif); }
.section-heading p { max-width: 620px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.section-heading button { display: inline-flex; align-items: center; gap: 5px; align-self: start; white-space: nowrap; }
.empty-writing { padding: 28px 18px; color: var(--muted); font-size: 11px; line-height: 1.6; }.empty-writing p { margin: 0 0 16px; }
.section-list { display: grid; gap: 1px; background: var(--line); }
.editable-section { padding: 16px 18px 14px; background: var(--paper-muted); }
.section-title { display: flex; align-items: start; gap: 10px; }.section-number { color: var(--blue); font: 10px var(--mono); }.section-title h3 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 600; }.section-title span { display: block; margin-top: 4px; color: var(--muted); font: 9px var(--mono); }.confirmed { margin-left: auto; color: var(--green); }
textarea { display: block; width: 100%; margin-top: 12px; resize: vertical; padding: 10px; border: 1px solid var(--line); background: #fff; color: var(--ink); font: 11px/1.7 var(--sans); }
.section-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 9px; color: var(--muted); font: 9px var(--mono); }.section-footer button { display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 560px) { .section-heading { display: block; }.section-heading button { margin-top: 13px; } .section-footer { align-items: stretch; flex-direction: column; } }
</style>
