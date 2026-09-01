<script setup lang="ts">
import { AlertCircle, Check, CircleCheck, LockKeyhole, RotateCcw } from 'lucide-vue-next'
import type { ProductPracticeCompletion } from '@/types/product'

const props = defineProps<{
  completion: ProductPracticeCompletion
  verifying: boolean
}>()
const emit = defineEmits<{
  verify: []
}>()

const title = () => {
  if (props.completion.status === 'resolved') return '实践已完成'
  if (props.completion.status === 'ready_to_close') return '可以收束本次实践'
  if (props.completion.status === 'ended') return '实践已结束'
  return '实践进度与完成条件'
}
</script>

<template>
  <section class="completion-panel" :class="completion.status" aria-labelledby="completion-title">
    <header class="completion-header">
      <div class="completion-heading">
        <span class="completion-icon">
          <CircleCheck v-if="completion.status === 'resolved'" :size="15" aria-hidden="true" />
          <AlertCircle v-else-if="completion.status === 'ready_to_close'" :size="15" aria-hidden="true" />
          <LockKeyhole v-else :size="15" aria-hidden="true" />
        </span>
        <div>
          <div class="eyebrow">Evidence gate</div>
          <h2 id="completion-title">{{ title() }}</h2>
        </div>
      </div>
      <span class="completion-count">{{ completion.checks.filter((item) => item.complete).length }} / {{ completion.checks.length }} 条</span>
    </header>
    <p class="completion-summary">{{ completion.summary }}</p>
    <div class="completion-checks">
      <div v-for="check in completion.checks" :key="check.key" class="completion-check" :class="{ complete: check.complete }">
        <span class="check-icon"><Check v-if="check.complete" :size="12" aria-hidden="true" /><span v-else aria-hidden="true" /></span>
        <div><strong>{{ check.label }}</strong><p>{{ check.detail }}</p></div>
      </div>
    </div>
    <footer v-if="completion.status === 'ready_to_close' || completion.status === 'resolved'" class="completion-actions">
      <button v-if="completion.status === 'ready_to_close'" type="button" class="primary-button" :disabled="verifying" @click="emit('verify')">
        <CircleCheck :size="13" aria-hidden="true" />{{ verifying ? '确认中…' : '完成本次实践' }}
      </button>
      <span v-else class="resolved-note"><CircleCheck :size="13" aria-hidden="true" />已确认，可进入复盘与写作</span>
      <button v-if="completion.status === 'ready_to_close'" type="button" class="text-button" @click="emit('verify')"><RotateCcw :size="12" aria-hidden="true" />重新检查</button>
    </footer>
  </section>
</template>

<style scoped>
.completion-panel { border: 1px solid var(--line); background: var(--paper-deep); }
.completion-panel.ready_to_close { border-color: #d8c49d; background: #fbf8ee; }
.completion-panel.resolved { border-color: #b8d0bc; background: #f3f8f2; }
.completion-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--line-soft); }
.completion-heading { display: flex; align-items: center; gap: 9px; }.completion-icon { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid #c9ccc5; color: var(--muted); }.ready_to_close .completion-icon { border-color: #d4bd86; color: #a26c2c; }.resolved .completion-icon { border-color: #a9c4ae; color: var(--green); }
.completion-heading h2 { margin: 4px 0 0; color: var(--ink); font: 400 17px var(--serif); }.completion-count { color: var(--muted); font: 9px var(--mono); white-space: nowrap; }.completion-summary { margin: 0; padding: 10px 13px 0; color: #5f6964; font-size: 10px; line-height: 1.5; }
.completion-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 20px; padding: 10px 13px 12px; }.completion-check { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }.check-icon { display: grid; place-items: center; flex: 0 0 auto; width: 16px; height: 16px; margin-top: 1px; border: 1px solid #c8cec8; color: var(--muted); }.check-icon > span { width: 5px; height: 5px; border-radius: 50%; background: #b4bdb7; }.completion-check.complete .check-icon { border-color: #9cbea3; background: #e7f1e7; color: var(--green); }.completion-check strong { display: block; color: #4b5651; font-size: 10px; line-height: 1.35; }.completion-check p { margin: 3px 0 0; color: var(--muted); font-size: 9px; line-height: 1.4; }.completion-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 11px; padding: 0 13px 13px; }.completion-actions button { display: inline-flex; align-items: center; gap: 5px; }.resolved-note { display: inline-flex; align-items: center; gap: 5px; color: var(--green); font: 9px var(--mono); }.text-button { border: 0; background: transparent; color: var(--muted); font: 9px var(--mono); }.text-button:hover { color: var(--blue); }
@media (max-width: 700px) { .completion-checks { grid-template-columns: 1fr; } }
</style>
