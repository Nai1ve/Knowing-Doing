<script setup lang="ts">
import { BookOpen, ExternalLink } from 'lucide-vue-next'
import { computed } from 'vue'
import type { PublicSourceReference } from '@/types/learningExperience'
import { safeExternalUrl } from '@/utils/source-flow'

const props = defineProps<{ sources?: PublicSourceReference[] | null }>()
const sources = computed(() => props.sources ?? [])
const sourceTypeLabels: Record<string, string> = { favorite: '知乎收藏', own_content: '知乎创作', moment: '知乎动态', public_search: '公开检索' }

function sourceTypeLabel(sourceType: string | null | undefined) { return sourceType ? sourceTypeLabels[sourceType] ?? sourceType : '参考来源' }
function hasDetails(source: PublicSourceReference) { return Boolean(source.summary || source.sourceAnchor || source.selectedReason || source.fetchedAt) }
</script>

<template>
  <section v-if="sources.length" class="card-sources" aria-label="本卡参考来源">
    <header class="sources-heading"><div><span class="eyebrow"><BookOpen :size="13" aria-hidden="true" /> Practice Card sources</span><h2>本卡参考来源</h2></div><span class="sources-disclaimer">参考材料，不等于标准答案</span></header>
    <div class="source-list">
      <article v-for="source in sources" :key="source.id" class="source-item">
        <div class="source-copy"><span class="source-type">{{ sourceTypeLabel(source.sourceType) }}</span><strong>{{ source.title }}</strong><small v-if="source.author">作者：{{ source.author }}</small></div>
        <a v-if="safeExternalUrl(source.canonicalUrl)" class="source-link" :href="safeExternalUrl(source.canonicalUrl) ?? undefined" target="_blank" rel="noopener noreferrer" :aria-label="`打开来源：${source.title}`"><ExternalLink :size="13" aria-hidden="true" />原始链接</a>
        <details v-if="hasDetails(source)" class="source-details"><summary>查看摘要与采用信息</summary><p v-if="source.summary"><b>摘要：</b>{{ source.summary }}</p><p v-if="source.sourceAnchor"><b>引用位置：</b>{{ source.sourceAnchor }}</p><p v-if="source.selectedReason"><b>采用原因：</b>{{ source.selectedReason }}</p><p v-if="source.fetchedAt"><b>获取时间：</b>{{ source.fetchedAt }}</p></details>
      </article>
    </div>
  </section>
</template>

<style scoped>
.card-sources { margin-top: 18px; padding: 15px; border-top: 2px solid var(--blue); background: var(--paper-deep); }.sources-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }.sources-heading > div { min-width: 0; }.sources-heading .eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--blue); }.sources-heading h2 { margin: 6px 0 0; color: var(--ink); font: 400 20px var(--serif); }.sources-disclaimer { flex: 0 0 auto; color: var(--muted); font: 9px/1.5 var(--mono); }.source-list { display: grid; gap: 8px; margin-top: 12px; }.source-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; padding: 10px; border: 1px solid var(--line); background: var(--paper); }.source-copy { min-width: 0; }.source-type { display: block; margin-bottom: 4px; color: var(--blue); font: 8px var(--mono); }.source-copy strong { display: block; overflow: hidden; color: var(--ink); font-size: 11px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }.source-copy small { display: block; margin-top: 4px; color: var(--muted); font-size: 9px; }.source-link { display: inline-flex; align-items: center; gap: 4px; align-self: start; color: var(--blue); font: 9px var(--mono); text-decoration: none; white-space: nowrap; }.source-link:hover { text-decoration: underline; }.source-details { grid-column: 1 / -1; border-top: 1px solid var(--line); padding-top: 7px; color: var(--muted); font-size: 9px; line-height: 1.55; }.source-details summary { color: var(--blue); cursor: pointer; font: 9px var(--mono); }.source-details p { margin: 6px 0 0; }.source-details b { color: var(--ink); font-weight: 500; }
@media (max-width: 600px) { .sources-heading { flex-direction: column; gap: 7px; }.source-item { grid-template-columns: 1fr; }.source-link { justify-self: start; } }
</style>
