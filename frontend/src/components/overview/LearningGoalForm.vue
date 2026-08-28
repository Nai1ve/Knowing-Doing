<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, Sparkles } from 'lucide-vue-next'

const props = defineProps<{ submitting?: boolean; error?: string | null }>()
const emit = defineEmits<{ submit: [goal: string] }>()
const goal = ref('我想系统学习 MySQL 慢查询优化')

function submit() {
  if (goal.value.trim() && !props.submitting) emit('submit', goal.value)
}
</script>

<template>
  <section class="goal-form" aria-labelledby="goal-form-title">
    <div class="goal-form-copy"><div class="eyebrow"><Sparkles :size="12" aria-hidden="true" /> Start with a goal</div><h2 id="goal-form-title">你现在想系统学会什么？</h2><p>先用一句话描述目标。知行会把它拆成一条可执行的路线，再从一个真实工程案例开始。</p></div>
    <form @submit.prevent="submit"><label for="learning-goal">学习目标</label><textarea id="learning-goal" v-model="goal" rows="2" placeholder="例如：我想学会定位和优化 MySQL 慢查询" /><button class="primary-button" type="submit" :disabled="submitting || !goal.trim()"><ArrowRight :size="14" aria-hidden="true" />{{ submitting ? '正在生成路线…' : '生成我的路线' }}</button></form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.goal-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(310px, .9fr); gap: 25px; margin-top: 22px; padding: 17px; border: 1px solid var(--line); border-top: 2px solid var(--blue); background: var(--paper-deep); }
.eyebrow { display: flex; align-items: center; gap: 6px; }
.goal-form h2 { margin: 7px 0 0; color: var(--ink); font: 400 22px var(--serif); }
.goal-form p { max-width: 490px; margin: 8px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.goal-form form { display: grid; grid-template-columns: 1fr auto; gap: 7px; align-items: end; }
.goal-form label { grid-column: 1 / -1; color: var(--muted); font: 9px var(--mono); }
.goal-form textarea { min-width: 0; resize: vertical; padding: 8px; border: 1px solid var(--line); background: var(--white); color: var(--ink); font: 11px/1.5 var(--sans); }
.goal-form button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.form-error { grid-column: 1 / -1; margin: 0 !important; color: var(--red) !important; }
@media (max-width: 700px) { .goal-form { grid-template-columns: 1fr; } .goal-form form { grid-template-columns: 1fr; } .goal-form button { justify-content: center; } }
</style>
