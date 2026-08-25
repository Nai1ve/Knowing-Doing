<script setup lang="ts">
import { FilePenLine, Save, Sparkles } from 'lucide-vue-next'

defineProps<{ stage: 'capture' | 'outline' | 'article'; outline: string; article: string; generatingOutline?: boolean; generatingArticle?: boolean; status?: string }>()
const emit = defineEmits<{ 'update:stage': [stage: 'capture' | 'outline' | 'article']; 'update:outline': [value: string]; 'update:article': [value: string]; outline: []; article: []; save: [] }>()
const stages = [{ id: 'capture' as const, label: '01 · 素材' }, { id: 'outline' as const, label: '02 · 大纲' }, { id: 'article' as const, label: '03 · 成文' }]
</script>

<template>
  <section class="note-editor" aria-labelledby="note-editor-title">
    <div class="editor-heading"><div><div class="eyebrow">Turn practice into writing</div><h2 id="note-editor-title">整理与输出</h2></div><FilePenLine :size="18" aria-hidden="true" /></div>
    <div class="stage-tabs" role="tablist" aria-label="笔记阶段"><button v-for="item in stages" :key="item.id" type="button" role="tab" :aria-selected="stage === item.id" :class="{ active: stage === item.id }" @click="emit('update:stage', item.id)">{{ item.label }}</button></div>
    <div v-if="stage === 'capture'" class="editor-intro"><p>素材会由系统默认记录：参考了什么、问了什么、遇到什么错误，以及最终形成的判断。</p><button class="secondary-button" type="button" @click="emit('update:stage', 'outline')">进入大纲整理</button></div>
    <div v-else-if="stage === 'outline'" class="editor-stage"><div class="editor-actions"><span>AI 只生成草稿，结构和事实由你确认</span><button class="ghost-button" type="button" :disabled="generatingOutline" @click="emit('outline')"><Sparkles :size="13" aria-hidden="true" />{{ generatingOutline ? '正在整理…' : 'AI 整理大纲' }}</button></div><label for="outline-editor">大纲草稿</label><textarea id="outline-editor" :value="outline" rows="15" placeholder="先生成或手动写下文章结构…" @input="emit('update:outline', ($event.target as HTMLTextAreaElement).value)" /></div>
    <div v-else class="editor-stage"><div class="editor-actions"><span>发布前仍需人工确认知乎内容</span><button class="ghost-button" type="button" :disabled="generatingArticle" @click="emit('article')"><Sparkles :size="13" aria-hidden="true" />{{ generatingArticle ? '正在成文…' : 'AI 完成文章' }}</button></div><label for="article-editor">文章草稿</label><textarea id="article-editor" :value="article" rows="18" placeholder="完成大纲后生成文章草稿…" @input="emit('update:article', ($event.target as HTMLTextAreaElement).value)" /></div>
    <div class="editor-footer"><span class="status-text" role="status" aria-live="polite">{{ status }}</span><button class="primary-button" type="button" @click="emit('save')"><Save :size="13" aria-hidden="true" />保存草稿</button></div>
  </section>
</template>

<style scoped>
.note-editor { margin-top: 20px; padding: 15px; border: 1px solid #c8ccdc; background: #f7f7f0; }
.editor-heading { display: flex; align-items: start; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); color: var(--blue); }
.editor-heading h2 { margin: 7px 0 0; color: #303738; font: 400 23px var(--serif); }
.stage-tabs { display: flex; gap: 0; margin-top: 13px; border-bottom: 1px solid var(--line); }
.stage-tabs button { min-height: 30px; padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #7a827d; font: 9px var(--mono); }
.stage-tabs button:hover, .stage-tabs button.active { border-bottom-color: var(--blue); color: var(--blue); }
.editor-intro { display: grid; gap: 13px; padding: 20px 2px 5px; } .editor-intro p { max-width: 590px; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; }
.editor-stage { margin-top: 14px; } .editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; } .editor-actions span { color: var(--muted); font-size: 9px; }
.editor-actions button, .editor-footer button { display: inline-flex; align-items: center; gap: 5px; }
.editor-stage label { display: block; margin-top: 13px; color: #67716d; font-size: 9px; } .editor-stage textarea { display: block; width: 100%; margin-top: 5px; resize: vertical; padding: 10px; border: 1px solid #c8cbc2; border-radius: 0; background: #fff; color: #45504c; font: 11px/1.7 var(--sans); }
.editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 34px; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--line); } .editor-footer .status-text { flex: 1; }
@media (max-width: 560px) { .editor-actions, .editor-footer { align-items: stretch; flex-direction: column; } .editor-actions button, .editor-footer button { justify-content: center; } }
</style>
