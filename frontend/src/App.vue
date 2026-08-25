<script setup lang="ts">
import { onMounted } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'
import { usePlanStore } from '@/stores/plan'

const planStore = usePlanStore()
onMounted(() => planStore.loadPlan())
</script>

<template>
  <AppShell />
</template>
