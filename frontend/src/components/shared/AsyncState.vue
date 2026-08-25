<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string | null }>()
</script>

<template>
  <div v-if="loading" class="async-state" role="status">正在载入…</div>
  <div v-else-if="error" class="async-state error" role="alert">{{ error }}</div>
  <slot v-else />
</template>

<style scoped>
.async-state { padding: 18px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--muted); font-size: 12px; }
.async-state.error { border-top-color: var(--red); color: var(--red); }
</style>
