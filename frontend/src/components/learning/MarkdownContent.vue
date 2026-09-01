<script setup lang="ts">
import { computed } from 'vue'
import { renderSafeMarkdown } from './markdownRenderer'

const props = defineProps<{ content: string }>()

const rendered = computed(() => renderSafeMarkdown(props.content))
</script>

<template>
  <div class="markdown-content" v-html="rendered" />
</template>

<style scoped>
.markdown-content { min-width: 0; overflow-wrap: anywhere; color: inherit; font-size: 13px; line-height: 1.7; }
.markdown-content :deep(:first-child) { margin-top: 0; }
.markdown-content :deep(:last-child) { margin-bottom: 0; }
.markdown-content :deep(p) { margin: 8px 0; }
.markdown-content :deep(h1), .markdown-content :deep(h2), .markdown-content :deep(h3) { margin: 16px 0 7px; color: #29333a; font-family: var(--serif); font-weight: 400; line-height: 1.35; }
.markdown-content :deep(h1) { font-size: 20px; }.markdown-content :deep(h2) { font-size: 17px; }.markdown-content :deep(h3) { font-size: 15px; }
.markdown-content :deep(ul), .markdown-content :deep(ol) { margin: 8px 0; padding-left: 21px; }
.markdown-content :deep(li + li) { margin-top: 4px; }
.markdown-content :deep(blockquote) { margin: 10px 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--orange); color: #68716e; }
.markdown-content :deep(code) { padding: 1px 4px; background: #e8e8df; color: #3347af; font: .9em/1.5 var(--mono); }
.markdown-content :deep(pre) { display: block; width: 100%; max-width: 100%; margin: 10px 0; overflow-x: auto; overflow-y: hidden; padding: 11px 12px; background: #20272e; color: #dce3dc; white-space: pre; overflow-wrap: normal; word-break: normal; }
.markdown-content :deep(pre code) { display: block; min-width: max-content; padding: 0; background: transparent; color: inherit; font: 11px/1.65 var(--mono); }
.markdown-content :deep(a) { color: var(--blue-deep); text-decoration: underline; text-underline-offset: 2px; }
.markdown-content :deep(table) { display: block; max-width: 100%; margin: 10px 0; overflow-x: auto; border-collapse: collapse; font-size: 12px; }
.markdown-content :deep(th), .markdown-content :deep(td) { padding: 6px 8px; border: 1px solid #d5d9d1; text-align: left; white-space: nowrap; }
.markdown-content :deep(th) { background: #e9ebe4; color: #394541; font-weight: 600; }
</style>
