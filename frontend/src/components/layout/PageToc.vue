<script setup lang="ts">
import type { PropType } from 'vue'
defineProps({ items: { type: Array as PropType<Array<{ label: string; href: string }>>, default: () => [] } })
</script>

<template>
  <aside class="toc" aria-label="当前页面目录">
    <div class="toc-title">On this page</div>
    <nav v-if="items.length" class="toc-list"><a v-for="(item, index) in items" :key="item.href" :href="item.href" :class="{ active: index === 0 }">{{ item.label }}</a></nav>
    <div class="toc-note">总览负责定位。<br />路线负责理解全局。<br />当前学习负责执行。<br />笔记负责沉淀。</div>
  </aside>
</template>

<style scoped>
.toc { padding: 25px 14px; border-left: 1px solid #d0d0c9; background: var(--paper-muted); }
.toc-title { padding-bottom: 9px; border-bottom: 1px solid #cbcec6; color: #727b76; font-family: var(--mono); font-size: 9px; letter-spacing: .4px; text-transform: uppercase; }
.toc-list { display: grid; gap: 10px; margin-top: 12px; }
.toc-list a { padding-left: 8px; border-left: 2px solid transparent; color: #777f7b; font-size: 10px; line-height: 1.35; text-decoration: none; }
.toc-list a:hover, .toc-list a.active { border-left-color: var(--blue); color: var(--blue); }
.toc-note { margin-top: 30px; padding-top: 12px; border-top: 1px solid #cbcec6; color: #828a85; font-size: 10px; line-height: 1.55; }
@media (max-width: 980px) { .toc { grid-column: 2; border-top: 1px solid #d0d0c9; border-left: 0; } .toc-list { grid-template-columns: repeat(3, 1fr); } .toc-note { display: none; } }
@media (max-width: 700px) { .toc-list { grid-template-columns: 1fr 1fr; } }
</style>
