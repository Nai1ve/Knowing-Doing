<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowDownRight, ArrowUpRight, BookMarked, CircleAlert, TimerReset } from 'lucide-vue-next'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import SectionHeading from '@/components/shared/SectionHeading.vue'
import { usePlanStore } from '@/stores/plan'
import { useLessonStore } from '@/stores/lesson'

const planStore = usePlanStore()
const lessonStore = useLessonStore()
const counts = computed(() => lessonStore.events.reduce((result, event) => { result[event.type] += 1; return result }, { reference: 0, question: 0, error: 0, observation: 0, evidence: 0 } as Record<string, number>))
const practiceCount = computed(() => lessonStore.events.length)
onMounted(() => { if (planStore.plan) void lessonStore.load('lesson-02-03', planStore.plan.id) })
</script>

<template>
  <div class="page review-page">
    <PageHeader eyebrow="05 · Review" title="每周复盘，调整下一段路。" description="复盘不只看完成了多少，更看你能否把原理迁移到新的 YAML、终端结果和错误现场。" :meta="['第 2 周', '计划 150 分钟', '当前节点：Deployment / ReplicaSet']" />
    <AsyncState :loading="lessonStore.loading" :error="lessonStore.error"><template #default><section id="review-stats" class="review-stats"><SectionHeading title="本周学习数据" detail="Evidence over activity" /><div class="metric-grid"><div><BookMarked :size="15" aria-hidden="true" /><strong>{{ practiceCount }}</strong><span>实践素材</span></div><div><CircleAlert :size="15" aria-hidden="true" /><strong>{{ counts.error }}</strong><span>错误记录</span></div><div><TimerReset :size="15" aria-hidden="true" /><strong>150</strong><span>计划分钟</span></div><div><ArrowUpRight :size="15" aria-hidden="true" /><strong>42%</strong><span>计划完成度</span></div></div></section><section id="review-change" class="change-section"><SectionHeading title="掌握变化" detail="What changed" /><div class="change-list"><div><span class="change-icon up"><ArrowUpRight :size="14" aria-hidden="true" /></span><div><strong>能解释期望状态</strong><p>你已经能把 replicas、当前副本和 Ready 区分开，不再只盯着一个数字。</p></div></div><div><span class="change-icon up"><ArrowUpRight :size="14" aria-hidden="true" /></span><div><strong>开始按证据排障</strong><p>遇到错误时会先记录 YAML 和终端输出，再让 Tutor Agent 帮你对照知乎内容。</p></div></div><div><span class="change-icon down"><ArrowDownRight :size="14" aria-hidden="true" /></span><div><strong>还需要练习迁移</strong><p>下一周需要把相同判断迁移到 Service、配置和健康检查，不只复述当前示例。</p></div></div></div></section><section id="review-adjustment" class="adjustment"><div><div class="eyebrow">Suggested adjustment</div><h2>下一周把“解释”推进到“验证”。</h2><p>保留每天 35 分钟的线性学习，将一次练习替换为“故意制造一个错误，再用证据定位”的小实验。</p></div><div class="adjustment-note"><span>建议保留</span><strong>原理 → 示例 → 实践 → 记录</strong><small>学习顺序不变，只提高实践证据占比。</small></div></section></template></AsyncState>
  </div>
</template>

<style scoped>
.review-page { max-width: 900px; } .review-stats { margin-top: 25px; } .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-top: 14px; } .metric-grid > div { display: grid; grid-template-columns: 18px 1fr; column-gap: 6px; padding: 11px 10px; border-top: 2px solid var(--line); } .metric-grid > div:nth-child(1) { border-top-color: var(--green); } .metric-grid > div:nth-child(2) { border-top-color: var(--red); } .metric-grid > div:nth-child(3) { border-top-color: var(--orange); } .metric-grid > div:nth-child(4) { border-top-color: var(--blue); } .metric-grid svg { grid-row: span 2; color: var(--muted); } .metric-grid strong { color: #3d4844; font: 400 24px var(--serif); } .metric-grid span { color: var(--muted); font-size: 9px; }
.change-section { margin-top: 29px; } .change-list { display: grid; gap: 0; } .change-list > div { display: grid; grid-template-columns: 25px 1fr; gap: 10px; padding: 13px 0; border-bottom: 1px solid var(--line-soft); } .change-icon { display: grid; place-items: center; width: 24px; height: 24px; } .change-icon.up { background: var(--green-soft); color: var(--green); } .change-icon.down { background: var(--orange-soft); color: var(--orange); } .change-list strong { color: #3e4945; font-size: 12px; font-weight: 500; } .change-list p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
.adjustment { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(190px, .8fr); gap: 18px; margin-top: 28px; padding: 16px; border-top: 2px solid var(--orange); background: var(--orange-soft); } .adjustment h2 { margin: 7px 0 0; color: #4b4d46; font: 400 22px var(--serif); } .adjustment p { max-width: 570px; margin: 8px 0 0; color: #74766e; font-size: 10px; line-height: 1.6; } .adjustment-note { display: grid; align-content: start; gap: 6px; padding-left: 12px; border-left: 1px solid #d7cabc; } .adjustment-note span { color: #a45836; font: 9px var(--mono); } .adjustment-note strong { color: #765643; font: 400 15px var(--serif); } .adjustment-note small { color: #8c776b; font-size: 9px; line-height: 1.5; }
@media (max-width: 700px) { .metric-grid { grid-template-columns: 1fr 1fr; } .adjustment { grid-template-columns: 1fr; } .adjustment-note { padding: 10px 0 0; border-top: 1px solid #d7cabc; border-left: 0; } }
</style>
