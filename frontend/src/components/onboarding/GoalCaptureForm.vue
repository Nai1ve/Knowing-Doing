<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { ref } from 'vue'
import ResumeUploadField from './ResumeUploadField.vue'

defineProps<{ submitting?: boolean; error?: string | null }>()
const emit = defineEmits<{ submit: [input: { goal: string; resume?: File }] }>()
const goal = ref('我想成为高级后端 + AI 应用工程师')
const resume = ref<File | null>(null)
const resumeValid = ref(true)

function submit() { if (goal.value.trim() && resumeValid.value) emit('submit', { goal: goal.value.trim(), ...(resume.value ? { resume: resume.value } : {}) }) }
</script>

<template>
  <section class="capture-form" aria-labelledby="capture-title">
    <div class="form-copy"><div class="eyebrow">Start with a direction</div><h2 id="capture-title">你现在想走向哪里？</h2><p>先用自己的话描述目标。进入规划对话后，知行会围绕真正影响路线的内容继续确认。</p></div>
    <form @submit.prevent="submit">
      <label class="goal-label" for="learning-goal">你的学习目标</label><textarea id="learning-goal" v-model="goal" rows="4" maxlength="4000" placeholder="例如：我想成为高级后端 + AI 应用工程师，能够独立完成一个可上线的 AI 后端系统" /><ResumeUploadField :disabled="submitting" @change="({ file, valid }) => { resume = file; resumeValid = valid }" /><button class="primary-button" type="submit" :disabled="submitting || !goal.trim() || !resumeValid"><ArrowRight :size="14" aria-hidden="true" />{{ submitting ? '正在开启规划对话…' : '开始规划对话' }}</button>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.capture-form { display: grid; grid-template-columns: minmax(0, .85fr) minmax(320px, 1.15fr); gap: 28px; margin-top: 28px; padding: 18px 0 0; border-top: 2px solid var(--blue); }
.form-copy h2 { margin: 8px 0 0; color: var(--ink); font: 400 24px var(--serif); }.form-copy p { max-width: 360px; margin: 10px 0 0; color: var(--muted); font-size: 11px; line-height: 1.65; }
form { display: grid; gap: 8px; } fieldset { display: grid; gap: 7px; margin: 0 0 8px; padding: 0; border: 0; } legend, .goal-label { margin-bottom: 3px; color: var(--muted); font: 9px var(--mono); }
fieldset label { display: flex; align-items: center; gap: 9px; min-height: 48px; padding: 9px 10px; border: 1px solid var(--line); background: var(--paper-deep); color: var(--muted); cursor: pointer; } fieldset label.selected { border-color: var(--blue); background: var(--blue-soft); color: var(--blue-deep); } fieldset input { accent-color: var(--blue); } fieldset svg { flex: 0 0 auto; } fieldset span { display: grid; gap: 3px; } fieldset strong { color: var(--ink); font-size: 11px; font-weight: 500; } fieldset small { color: var(--muted); font-size: 9px; }
textarea { min-width: 0; resize: vertical; padding: 9px; border: 1px solid var(--line); background: var(--white); color: var(--ink); font: 11px/1.55 var(--sans); } form button { justify-self: start; display: inline-flex; align-items: center; gap: 6px; } .form-error { margin: 2px 0 0; color: var(--red); font-size: 10px; }
@media (max-width: 680px) { .capture-form { grid-template-columns: 1fr; gap: 18px; } form button { justify-self: stretch; justify-content: center; } }
</style>
