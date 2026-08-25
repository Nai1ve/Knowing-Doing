<script setup lang="ts">
defineProps<{ title: string; detail?: string }>()
</script>

<template>
  <div class="section-heading"><h2>{{ title }}</h2><span v-if="detail">{{ detail }}</span></div>
</template>

<style scoped>
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid var(--line); }
.section-heading h2 { margin: 0; color: #303738; font-family: var(--serif); font-size: 21px; font-weight: 400; }
.section-heading span { color: #858c87; font-size: 10px; }
</style>
