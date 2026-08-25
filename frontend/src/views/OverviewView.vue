<script setup lang="ts">
import { ArrowRight, CalendarDays, Crosshair, Target } from 'lucide-vue-next'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/shared/PageHeader.vue'
import SectionHeading from '@/components/shared/SectionHeading.vue'
import ProgressSummary from '@/components/overview/ProgressSummary.vue'
import RouteSnapshot from '@/components/overview/RouteSnapshot.vue'
import { usePlanStore } from '@/stores/plan'

const planStore = usePlanStore()
const plan = computed(() => planStore.plan)
const milestone = computed(() => planStore.currentMilestone)
const node = computed(() => planStore.currentNode)
</script>

<template>
  <div v-if="plan" class="page overview-page">
    <PageHeader eyebrow="01 · Orient" title="先知道要去哪里，再开始学习。" description="知行把一项技术拆成可解释的路线、当前节点和可回看的实践证据。今天只需要完成一个清晰的动作。" :meta="[`计划 ${plan.title}`, `开始于 ${plan.startedAt}`, `预计完成 ${plan.dueAt}`]" />
    <section id="goal" class="goal-block" aria-labelledby="goal-title"><div class="section-marker"><Target :size="16" aria-hidden="true" /><span>总目标</span></div><h2 id="goal-title">{{ plan.goal }}</h2><p>不是把知识点全部看完，而是能从一份配置开始，解释它为什么这样运行，并在出错时找到下一条证据。</p></section>
    <ProgressSummary :plan="plan" :milestone="milestone" :node="node" />
    <section id="status" class="status-section" aria-labelledby="status-title"><SectionHeading title="当前状况" detail="What is true now" /><div class="status-grid"><div><small>正在进行</small><strong>{{ milestone?.title }}</strong><p>{{ milestone?.summary }}</p></div><div><small>当前所在节点</small><strong>{{ node?.title }}</strong><p>预计用时 {{ node?.duration }}。完成后进入 Service 与配置。</p></div><div><small>下一次行动</small><strong>打开当前学习</strong><p>先看示例，再把本地 YAML 或终端结果带回工作台。</p></div></div></section>
    <RouteSnapshot :milestones="planStore.milestones" />
    <section id="current-node" class="current-node" aria-labelledby="current-node-title"><div><div class="eyebrow">Current node · {{ milestone?.index }}</div><h2 id="current-node-title">{{ node?.title }}</h2><p>从控制器、期望状态和运行证据开始，完成一条可解释的部署链路。</p></div><RouterLink :to="{ name: 'lesson' }">进入当前学习 <ArrowRight :size="14" aria-hidden="true" /></RouterLink></section>
    <div class="overview-foot"><span><CalendarDays :size="13" aria-hidden="true" />本周安排 {{ plan.weeklyMinutes }} 分钟</span><span><Crosshair :size="13" aria-hidden="true" />当前进度会根据实践证据调整</span></div>
  </div>
</template>

<style scoped>
.overview-page { max-width: 920px; }
.goal-block { margin-top: 28px; padding: 0 0 19px; border-bottom: 1px solid var(--line); }
.section-marker { display: flex; align-items: center; gap: 7px; color: var(--blue); font: 9px var(--mono); letter-spacing: .5px; text-transform: uppercase; }
.goal-block h2 { max-width: 760px; margin: 12px 0 0; color: #29333a; font: 400 clamp(24px, 3.2vw, 36px)/1.22 var(--serif); }
.goal-block p { max-width: 650px; margin: 11px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
.status-section { margin-top: 29px; }
.status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 14px; }
.status-grid > div { padding-top: 10px; border-top: 2px solid var(--line); } .status-grid > div:first-child { border-top-color: var(--green); } .status-grid > div:nth-child(2) { border-top-color: var(--orange); } .status-grid > div:nth-child(3) { border-top-color: var(--blue); }
.status-grid small { color: #7d8581; font: 9px var(--mono); } .status-grid strong { display: block; margin-top: 7px; color: #3c4743; font: 400 16px var(--serif); } .status-grid p { margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
.current-node { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 27px; padding: 15px 16px; border-left: 3px solid var(--orange); background: var(--orange-soft); } .current-node h2 { margin: 7px 0 0; color: #3d4743; font: 400 22px var(--serif); } .current-node p { margin: 6px 0 0; color: #707875; font-size: 10px; line-height: 1.5; } .current-node a { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; padding: 7px 10px; border: 1px solid #b66844; color: #995436; font-size: 10px; text-decoration: none; white-space: nowrap; } .current-node a:hover { background: #f6e5db; }
.overview-foot { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 17px; color: #808883; font: 9px var(--mono); } .overview-foot span { display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 680px) { .status-grid { grid-template-columns: 1fr; gap: 12px; } .current-node { align-items: stretch; flex-direction: column; gap: 12px; } .current-node a { justify-content: center; } }
</style>
