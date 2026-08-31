<script setup lang="ts">
import { Check, CircleHelp, FlaskConical, Link2, MessageSquareText } from 'lucide-vue-next'
import type { ProductWritingMaterial, ProductWritingProject } from '@/types/product'

defineProps<{ project: ProductWritingProject; saving: boolean }>()
const emit = defineEmits<{ toggle: [material: ProductWritingMaterial, selected: boolean] }>()

const categoryLabels: Record<string, string> = { context: '背景', symptom: '现象', hypothesis: '判断', evidence: '证据', attempt: '尝试', solution: '方案', source: '来源', reflection: '复盘' }
function iconFor(material: ProductWritingMaterial) { return material.refType === 'source' ? Link2 : material.category === 'evidence' ? FlaskConical : material.category === 'hypothesis' ? CircleHelp : MessageSquareText }
function statusLabel(material: ProductWritingMaterial) { return material.verificationStatus === 'verified_lab' ? 'Lab 已验证' : material.verificationStatus === 'source_verified' ? '来源已记录' : material.verificationStatus === 'external_unverified' ? '外部待确认' : '用户 / AI 素材' }
</script>

<template>
  <section class="writing-section materials-panel" aria-labelledby="materials-title">
    <div class="section-heading"><div><div class="eyebrow">01 · Material ledger</div><h2 id="materials-title">从实践里挑选文章素材</h2><p>原始实践记录不会被修改。这里选择哪些内容进入本次写作快照。</p></div><span class="count-badge">{{ project.materials.filter((item) => item.selected).length }} 已选</span></div>
    <div class="material-list">
      <label v-for="material in project.materials" :key="material.id" class="material-row" :class="{ selected: material.selected }">
        <input type="checkbox" :checked="material.selected" :disabled="saving" @change="emit('toggle', material, ($event.target as HTMLInputElement).checked)" />
        <span class="material-icon"><component :is="iconFor(material)" :size="14" aria-hidden="true" /></span>
        <span class="material-body"><span class="material-meta"><strong>{{ categoryLabels[material.category] ?? material.category }}</strong><small>{{ statusLabel(material) }}</small></span><span class="material-title">{{ material.title }}</span><span class="material-excerpt">{{ material.excerpt || '没有可展示的摘要' }}</span></span>
        <Check v-if="material.selected" class="material-check" :size="15" aria-hidden="true" />
      </label>
    </div>
  </section>
</template>

<style scoped>
.writing-section { border-top: 2px solid var(--blue); background: var(--paper-muted); }
.section-heading { display: flex; justify-content: space-between; gap: 18px; padding: 17px 18px 14px; border-bottom: 1px solid var(--line); }
.section-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px/1.25 var(--serif); }
.section-heading p { max-width: 620px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.count-badge { align-self: start; padding: 6px 8px; border: 1px solid #b7c1ec; color: var(--blue); font: 9px var(--mono); white-space: nowrap; }
.material-list { display: grid; }
.material-row { display: grid; grid-template-columns: 18px 23px minmax(0, 1fr) 18px; gap: 9px; align-items: start; padding: 13px 18px; border-bottom: 1px solid var(--line-soft); cursor: pointer; }
.material-row:hover, .material-row.selected { background: #fff; }
.material-row input { margin: 3px 0 0; accent-color: var(--blue); }
.material-icon { display: grid; place-items: center; width: 23px; height: 23px; border: 1px solid var(--line); color: var(--blue); }
.material-body { min-width: 0; }
.material-meta { display: flex; align-items: center; gap: 8px; }
.material-meta strong { color: var(--blue); font: 9px var(--mono); font-weight: 500; }
.material-meta small { color: var(--muted); font: 9px var(--mono); }
.material-title { display: block; margin-top: 5px; color: var(--ink); font-size: 12px; font-weight: 600; }
.material-excerpt { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; line-height: 1.55; }
.material-check { margin-top: 3px; color: var(--green); }
@media (max-width: 560px) { .section-heading { display: block; } .count-badge { display: inline-block; margin-top: 12px; } .material-row { grid-template-columns: 18px 23px minmax(0, 1fr); } .material-check { display: none; } }
</style>
