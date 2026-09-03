<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'
import { computed, reactive } from 'vue'
import type { ProductDiagnosticSession } from '@/types/product'

const props = defineProps<{ session: ProductDiagnosticSession; submitting?: boolean; error?: string | null }>()
const emit = defineEmits<{ back: []; submit: [input: { goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }] }>()
const answer = (key: string) => props.session.turns.find((turn) => turn.questionKey === key)?.answer ?? ''
const form = reactive({ goal: props.session.goal, experience: answer('experience'), selfAssessment: answer('self_assessment'), weeklyMinutes: Number(answer('weekly_minutes')) || 120, outcome: answer('outcome'), contextNote: answer('context_note') === '未补充' ? '' : answer('context_note') })
const ready = computed(() => Boolean(form.goal.trim() && form.experience && form.selfAssessment && form.outcome))
function submit() { if (ready.value) emit('submit', { ...form, goal: form.goal.trim(), contextNote: form.contextNote.trim() }) }
</script>

<template>
  <form class="diagnostic-form" @submit.prevent="submit">
    <div class="form-heading"><div><div class="eyebrow">Diagnostic · 01 / 01</div><h2 id="diagnostic-title">让路线知道你的起点</h2><p>这些回答会作为计划安排依据保存。它们是你的输入，不是系统对能力的结论。</p></div><button class="ghost-button" type="button" @click="emit('back')"><ArrowLeft :size="13" aria-hidden="true" />返回修改目标</button></div>
    <label>学习目标<textarea v-model="form.goal" rows="2" maxlength="240" /></label>
    <div class="field-grid"><label>已有相关经验<select v-model="form.experience"><option value="无相关经验">无相关经验</option><option value="接触过基础概念">接触过基础概念</option><option value="做过相关项目">做过相关项目</option><option value="在生产中使用过">在生产中使用过</option></select></label><label>当前自评<select v-model="form.selfAssessment"><option value="刚开始了解">刚开始了解</option><option value="能完成基础操作">能完成基础操作</option><option value="能独立解决常见问题">能独立解决常见问题</option><option value="希望形成系统方法">希望形成系统方法</option></select></label></div>
    <div class="field-grid"><label>每周可以投入<select v-model.number="form.weeklyMinutes"><option :value="60">约 1 小时</option><option :value="120">约 2 小时</option><option :value="180">约 3 小时</option><option :value="240">约 4 小时</option><option :value="360">6 小时以上</option></select></label><label>期望产出<select v-model="form.outcome"><option value="理解核心原理">理解核心原理</option><option value="完成一次真实排查">完成一次真实排查</option><option value="解决工作中的问题">解决工作中的问题</option><option value="形成可分享的文章">形成可分享的文章</option></select></label></div>
    <label>补充背景（可选）<textarea v-model="form.contextNote" rows="3" placeholder="例如：最近在工作中遇到过类似问题，希望先理解原理再实践。" /></label>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="primary-button submit-button" type="submit" :disabled="submitting || !ready"><ArrowRight :size="14" aria-hidden="true" />{{ submitting ? '正在整理计划草案…' : '生成我的计划草案' }}</button>
  </form>
</template>

<style scoped>
.diagnostic-form { max-width: 760px; display: grid; gap: 15px; margin-top: 28px; }.form-heading { display: flex; align-items: start; justify-content: space-between; gap: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }.form-heading h2 { margin: 7px 0 0; color: var(--ink); font: 400 25px var(--serif); }.form-heading p { max-width: 580px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }.form-heading button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
label { display: grid; gap: 6px; color: var(--muted); font: 9px var(--mono); } textarea, select { width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--line); background: var(--white); color: var(--ink); font: 11px/1.55 var(--sans); } textarea { resize: vertical; }.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.submit-button { justify-self: start; display: inline-flex; align-items: center; gap: 6px; }.form-error { margin: -5px 0 0; color: var(--red); font-size: 10px; }
@media (max-width: 620px) { .form-heading { align-items: stretch; flex-direction: column; }.field-grid { grid-template-columns: 1fr; }.submit-button { justify-self: stretch; justify-content: center; } }
</style>
