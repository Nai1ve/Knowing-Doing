<script setup lang="ts">
import { ExternalLink, FileText, ShieldCheck } from 'lucide-vue-next'
import { computed } from 'vue'
import type { ProductCaseSourceSnapshot } from '@/types/product'

const props = defineProps<{
  snapshot?: ProductCaseSourceSnapshot | null
  inputSnapshot: Record<string, unknown>
  failed?: boolean
  failureMessage?: string | null
}>()

const inputSource = computed(() => {
  const value = props.inputSnapshot.source
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
})
const title = computed(() => props.snapshot?.title ?? String(inputSource.value.title ?? '知乎文章'))
const author = computed(() => props.snapshot?.author ?? (inputSource.value.author ? String(inputSource.value.author) : null))
const sourceUrl = computed(() => props.snapshot?.sourceUrl ?? (inputSource.value.url ? String(inputSource.value.url) : ''))
const rangeLabel = computed(() => {
  if (!props.snapshot) return '正文尚未冻结'
  const start = props.snapshot.injectedRange.start + 1
  const end = props.snapshot.injectedRange.end
  return end > 0 ? `第 ${start}–${end} 段 · 共 ${props.snapshot.segmentCount} 段` : `共 ${props.snapshot.segmentCount} 段`
})
const checksumLabel = computed(() => props.snapshot?.contentChecksum ?? '等待正文快照')
const statusLabel = computed(() => props.failed ? '读取失败' : props.snapshot?.extractionStatus === 'ready' ? '已冻结' : '准备中')
</script>

<template>
  <section class="source-card" aria-labelledby="source-card-title">
    <div class="source-card-header">
      <div><span class="eyebrow">Frozen source</span><h2 id="source-card-title">文章来源</h2></div>
      <span class="source-status" :class="{ failed }"><ShieldCheck :size="13" aria-hidden="true" />{{ statusLabel }}</span>
    </div>
    <div class="source-title"><FileText :size="14" aria-hidden="true" /><strong>{{ title }}</strong></div>
    <p class="source-meta">{{ author ? `作者：${author}` : '作者信息未提供' }} · {{ snapshot?.retrievedAt ? `抓取于 ${new Date(snapshot.retrievedAt).toLocaleString('zh-CN')}` : '等待抓取' }}</p>
    <div class="source-facts"><div><small>模型读取范围</small><span>{{ rangeLabel }}</span></div><div><small>正文校验</small><code>{{ checksumLabel }}</code></div></div>
    <a v-if="sourceUrl" class="source-link" :href="sourceUrl" target="_blank" rel="noreferrer"><ExternalLink :size="12" aria-hidden="true" />查看原文</a>
    <p v-if="snapshot?.extractionError" class="source-error">正文快照失败：{{ snapshot.extractionError }}</p>
    <p v-else-if="failed && failureMessage" class="source-error">正文快照失败：{{ failureMessage }}</p>
    <p class="source-note">只展示来源元数据；正文在服务端冻结后作为案例上下文读取，不在案例题面复制。</p>
  </section>
</template>

<style scoped>
.source-card { display: grid; gap: 10px; padding: 15px 18px; border-left: 2px solid var(--orange); background: var(--paper); }.source-card-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; }.source-card-header h2 { margin: 5px 0 0; color: var(--ink); font: 400 19px/1.2 var(--serif); }.source-status { display: inline-flex; align-items: center; gap: 5px; color: var(--green); font: 9px var(--mono); white-space: nowrap; }.source-status.failed { color: var(--red); }.source-title { display: flex; align-items: start; gap: 7px; color: var(--ink); font-size: 12px; line-height: 1.5; }.source-title svg { flex: 0 0 auto; margin-top: 2px; color: var(--orange); }.source-meta, .source-note, .source-error { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.55; }.source-facts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }.source-facts div { display: grid; gap: 4px; min-width: 0; }.source-facts small { color: #7c8580; font: 9px var(--mono); }.source-facts span, .source-facts code { color: #56615b; font: 9px/1.45 var(--mono); overflow-wrap: anywhere; }.source-link { display: inline-flex; align-items: center; gap: 6px; width: fit-content; color: var(--blue); font: 10px var(--mono); }.source-error { color: var(--red); }.source-note { padding-top: 1px; }
@media (max-width: 560px) { .source-facts { grid-template-columns: 1fr; } }
</style>
