<script setup lang="ts">
import { FileText, Link2, Play } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { KnowledgeRoute, ProductCaseInput } from '@/types/product'

type CaseFormPayload = {
  input: ProductCaseInput
  desiredOutcome?: string
  difficulty?: 'introductory' | 'applied' | 'advanced'
}

const props = defineProps<{
  sources: KnowledgeRoute['items']
  loading?: boolean
}>()
const emit = defineEmits<{ submit: [payload: CaseFormPayload] }>()

const inputKind = ref<'brief' | 'zhihu_article'>('brief')
const brief = ref('')
const sourceItemId = ref('')
const desiredOutcome = ref('')
const difficulty = ref<'introductory' | 'applied' | 'advanced'>('applied')
const sourceOptions = computed(() => props.sources ?? [])
const canSubmit = computed(() => inputKind.value === 'brief' ? brief.value.trim().length >= 4 : Boolean(sourceItemId.value))

function submit() {
  if (!canSubmit.value) return
  const input = inputKind.value === 'brief' ? { kind: 'brief' as const, brief: brief.value.trim() } : { kind: 'zhihu_article' as const, sourceItemId: sourceItemId.value }
  emit('submit', { input, desiredOutcome: desiredOutcome.value.trim() || undefined, difficulty: difficulty.value })
}
</script>

<template>
  <form class="case-form" @submit.prevent="submit">
    <div class="form-heading"><div><span class="eyebrow">Case input</span><h2>先告诉案例构建器要解决什么</h2></div><span class="provider-note">当前提供 Python pytest 工作区</span></div>
    <div class="input-tabs" role="tablist" aria-label="案例输入方式">
      <button type="button" :class="{ active: inputKind === 'brief' }" role="tab" :aria-selected="inputKind === 'brief'" @click="inputKind = 'brief'"><FileText :size="14" aria-hidden="true" />简略描述</button>
      <button type="button" :class="{ active: inputKind === 'zhihu_article' }" role="tab" :aria-selected="inputKind === 'zhihu_article'" :disabled="!sourceOptions.length" @click="inputKind = 'zhihu_article'"><Link2 :size="14" aria-hidden="true" />知乎材料</button>
    </div>
    <div v-if="inputKind === 'brief'" class="field"><label for="case-brief">想练习什么</label><textarea id="case-brief" v-model="brief" rows="5" maxlength="4000" placeholder="例如：我想练习如何阅读一个有边界条件缺陷的 Python 模块，并用测试验证修复。" /></div>
    <div v-else class="field"><label for="case-source">选择一篇已加载的材料</label><select id="case-source" v-model="sourceItemId"><option value="" disabled>请选择材料</option><option v-for="item in sourceOptions" :key="item.sourceItemId" :value="item.sourceItemId">{{ item.source.title }}</option></select><p v-if="!sourceOptions.length" class="field-hint">当前节点还没有可用材料，请改用简略描述。</p></div>
    <div class="form-grid"><div class="field"><label for="case-outcome">希望带走的产出</label><input id="case-outcome" v-model="desiredOutcome" maxlength="4000" placeholder="例如：能独立定位并修复一个测试失败" /></div><div class="field"><label for="case-difficulty">期望难度</label><select id="case-difficulty" v-model="difficulty"><option value="introductory">入门</option><option value="applied">应用</option><option value="advanced">进阶</option></select></div></div>
    <div class="form-footer"><span>案例会冻结这次输入，之后可以回看来源和生成版本。</span><button class="primary-button" type="submit" :disabled="loading || !canSubmit"><Play :size="13" aria-hidden="true" />{{ loading ? '提交中…' : '生成案例' }}</button></div>
  </form>
</template>

<style scoped>
.case-form { display: grid; gap: 17px; padding: 18px; border-top: 2px solid var(--orange); background: var(--paper-deep); }.form-heading { display: flex; align-items: start; justify-content: space-between; gap: 14px; }.form-heading h2 { margin: 7px 0 0; color: var(--ink); font: 400 22px var(--serif); }.provider-note { color: var(--muted); font: 9px var(--mono); }.input-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--line); }.input-tabs button { display: inline-flex; align-items: center; gap: 6px; min-height: 31px; padding: 6px 9px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 10px; }.input-tabs button.active { border-color: var(--line); border-bottom-color: var(--paper-deep); margin-bottom: -1px; background: var(--paper-deep); color: var(--blue); }.input-tabs button:disabled { cursor: not-allowed; opacity: .55; }.field { display: grid; gap: 6px; }.field label { color: #66716b; font: 9px var(--mono); }.field textarea, .field input, .field select { width: 100%; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); font-size: 11px; }.field textarea, .field input { padding: 9px 10px; line-height: 1.55; resize: vertical; }.field select { min-height: 34px; padding: 6px 8px; }.field textarea:focus, .field input:focus, .field select:focus { border-color: var(--blue); outline: 2px solid var(--blue-soft); }.field-hint { margin: 0; color: var(--muted); font-size: 10px; }.form-grid { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 12px; }.form-footer { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding-top: 3px; color: var(--muted); font: 9px/1.5 var(--mono); }.form-footer button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }.form-footer button:disabled { cursor: not-allowed; opacity: .55; }
@media (max-width: 680px) { .form-heading, .form-footer { align-items: stretch; flex-direction: column; }.form-grid { grid-template-columns: 1fr; }.provider-note { order: -1; }.form-footer button { justify-content: center; } }
</style>
