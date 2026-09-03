<script setup lang="ts">
import { ArrowRight, Database, FlaskConical } from 'lucide-vue-next'
import { ref } from 'vue'
import type { DiagnosticTargetKey } from '@/types/product'

defineProps<{ submitting?: boolean; error?: string | null }>()
const emit = defineEmits<{ submit: [input: { targetKey: DiagnosticTargetKey; goal: string }] }>()
const targetKey = ref<DiagnosticTargetKey>('mysql_performance')
const goal = ref('我想系统掌握 MySQL 慢查询优化')

function submit() { if (goal.value.trim()) emit('submit', { targetKey: targetKey.value, goal: goal.value.trim() }) }
</script>

<template>
  <section class="capture-form" aria-labelledby="capture-title">
    <div class="form-copy"><div class="eyebrow">Start with a direction</div><h2 id="capture-title">你现在想系统学会什么？</h2><p>先告诉知行一个明确方向。接下来只会问几项真正会影响路线的问题。</p></div>
    <form @submit.prevent="submit">
      <fieldset><legend>学习方向</legend><label :class="{ selected: targetKey === 'mysql_performance' }"><input v-model="targetKey" type="radio" value="mysql_performance" /><Database :size="15" aria-hidden="true" /><span><strong>MySQL 性能优化</strong><small>可直接进入真实实验</small></span></label><label :class="{ selected: targetKey === 'general' }"><input v-model="targetKey" type="radio" value="general" /><FlaskConical :size="15" aria-hidden="true" /><span><strong>其他技术</strong><small>先保存为待实施计划</small></span></label></fieldset>
      <label class="goal-label" for="learning-goal">学习目标</label><textarea id="learning-goal" v-model="goal" rows="3" maxlength="240" placeholder="例如：我想学会定位和优化 MySQL 慢查询" /><button class="primary-button" type="submit" :disabled="submitting || !goal.trim()"><ArrowRight :size="14" aria-hidden="true" />{{ submitting ? '正在创建诊断…' : '开始诊断' }}</button>
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
