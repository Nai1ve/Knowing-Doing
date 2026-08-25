<script setup lang="ts">
defineProps<{ eyebrow: string; title: string; description: string; meta?: string[] }>()
</script>

<template>
  <header class="page-header">
    <div class="eyebrow">{{ eyebrow }}</div>
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
    <div v-if="meta?.length" class="meta"><span v-for="item in meta" :key="item">{{ item }}</span></div>
  </header>
</template>

<style scoped>
.page-header { padding-bottom: 18px; border-bottom: 2px solid var(--blue); }
.page-header h1 { margin: 11px 0 0; color: #2e48cc; font-family: var(--serif); font-size: clamp(28px, 3vw, 40px); font-weight: 400; line-height: 1.18; }
.page-header p { max-width: 700px; margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.meta { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 14px; color: #7d8581; font-family: var(--mono); font-size: 9px; }
</style>
