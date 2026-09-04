<script setup lang="ts">
import { FileText, Upload, X } from 'lucide-vue-next'
import { ref } from 'vue'

defineProps<{ disabled?: boolean; currentName?: string | null }>()
const emit = defineEmits<{ change: [payload: { file: File | null; valid: boolean }] }>()
const input = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const error = ref('')

function choose(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0] ?? null
  error.value = ''
  if (!selected) {
    file.value = null
    emit('change', { file: null, valid: true })
    return
  }
  if (!selected.name.toLowerCase().endsWith('.pdf') || (selected.type && selected.type !== 'application/pdf')) {
    file.value = null
    error.value = '简历只支持 PDF 文件'
    emit('change', { file: null, valid: false })
    return
  }
  file.value = selected
  emit('change', { file: selected, valid: true })
}

function clear() {
  file.value = null
  error.value = ''
  if (input.value) input.value.value = ''
  emit('change', { file: null, valid: true })
}
</script>

<template>
  <div class="resume-upload">
    <div class="resume-heading"><div><span class="field-label">简历附件</span><small>可选 · 仅支持 PDF</small></div><FileText :size="15" aria-hidden="true" /></div>
    <div v-if="file || currentName" class="resume-file"><FileText :size="14" aria-hidden="true" /><span>{{ file?.name ?? currentName }}</span><button v-if="file" type="button" aria-label="移除简历" title="移除简历" @click="clear"><X :size="14" aria-hidden="true" /></button></div>
    <label v-else class="resume-picker" :class="{ disabled }"><Upload :size="14" aria-hidden="true" /><span>选择 PDF 简历</span><input ref="input" type="file" accept="application/pdf,.pdf" :disabled="disabled" @change="choose" /></label>
    <p v-if="error" class="resume-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.resume-upload { display: grid; gap: 8px; margin-top: 5px; padding: 10px 11px; border: 1px solid var(--line); background: var(--paper-deep); }
.resume-heading { display: flex; align-items: center; justify-content: space-between; color: var(--blue); }
.resume-heading > div { display: grid; gap: 3px; }
.field-label { color: var(--muted); font: 9px var(--mono); }
.resume-heading small { color: #8a938d; font: 9px var(--mono); }
.resume-picker, .resume-file { display: flex; align-items: center; gap: 7px; min-height: 32px; color: #5c6962; font-size: 10px; }
.resume-picker { justify-content: center; border: 1px dashed #b7c0c0; color: var(--blue); cursor: pointer; }
.resume-picker:hover { border-color: var(--blue); background: var(--blue-soft); }
.resume-picker.disabled { opacity: .55; cursor: wait; }
.resume-picker input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.resume-file { min-width: 0; color: var(--ink); }
.resume-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resume-file button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-left: auto; border: 1px solid var(--line); background: var(--paper); color: var(--muted); }
.resume-file button:hover { color: var(--red); border-color: var(--red); }
.resume-error { margin: 0; color: var(--red); font-size: 10px; line-height: 1.4; }
</style>
