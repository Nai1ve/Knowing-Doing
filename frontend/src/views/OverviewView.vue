<script setup lang="ts">
import { ArrowRight, CalendarDays, Crosshair, Target } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import SectionHeading from '@/components/shared/SectionHeading.vue'
import ProgressSummary from '@/components/overview/ProgressSummary.vue'
import RouteSnapshot from '@/components/overview/RouteSnapshot.vue'
import { usePlanStore } from '@/stores/plan'
import { useRoadmapStore } from '@/stores/roadmap'
import { hasActivePractice, resolveLearningEntry } from '@/utils/learning-entry'

const planStore = usePlanStore()
const roadmapStore = useRoadmapStore()
const plan = computed(() => planStore.plan)
const productPlan = computed(() => roadmapStore.current?.currentPlan ?? planStore.productPlan)
const milestone = computed(() => planStore.currentMilestone)
const node = computed(() => planStore.currentNode)
const currentLearning = computed(() => roadmapStore.current?.currentLearning ?? null)
const currentUnit = computed(() => productPlan.value?.units.find((unit) => unit.id === currentLearning.value?.planUnitId) ?? null)
const loading = computed(() => planStore.loading || roadmapStore.loading)
const loadError = computed(() => roadmapStore.error ?? planStore.error)
const entryLabel = computed(() => {
  switch (resolveLearningEntry(currentLearning.value)) {
    case 'dynamic_gym': return '进入知行 Gym'
    case 'practice_setup': return '构建知行 Gym'
    case 'workspace_setup': return '构建代码实践'
    case 'roadmap_node': return '查看路线节点'
    default: return '查看整体路线'
  }
})
const entryTo = computed<RouteLocationRaw>(() => {
  const learning = currentLearning.value
  const entry = resolveLearningEntry(learning)
  if (entry === 'dynamic_gym' && learning && hasActivePractice(learning) && learning.planUnitId) return { name: 'lesson', query: { planUnitId: learning.planUnitId } }
  if ((entry === 'dynamic_gym' || entry === 'practice_setup' || entry === 'workspace_setup') && learning?.planId && learning.planUnitId) return { name: 'gym-build', query: { planId: learning.planId, planUnitId: learning.planUnitId } }
  if (entry === 'roadmap_node' && learning?.roadmapId && learning.roadmapNodeId) return { name: 'roadmap-node', params: { roadmapId: learning.roadmapId, nodeId: learning.roadmapNodeId } }
  if (learning?.roadmapId && learning.roadmapNodeId) return { name: 'roadmap-node', params: { roadmapId: learning.roadmapId, nodeId: learning.roadmapNodeId } }
  return { name: 'roadmap' }
})
const actionDescription = computed(() => {
  switch (resolveLearningEntry(currentLearning.value)) {
    case 'dynamic_gym': return hasActivePractice(currentLearning.value) ? '当前实践已经激活，直接进入知行 Gym 继续学习。' : '案例已经准备好，进入知行 Gym 启动当前实践环境。'
    case 'practice_setup': return '当前节点已有可用实践能力，先构建一次案例，完成后进入对应实验环境。'
    case 'workspace_setup': return '先构建一次代码实践，案例完成后会进入对应的编程环境。'
    case 'roadmap_node': return '先阅读当前节点的知识卡和完成标准，再确认这一部分是否完成。'
    default: return '当前节点暂时不可直接实践，先查看路线图和真实筹备状态。'
  }
})
onMounted(async () => { await roadmapStore.loadCurrent(); planStore.hydrateProductPlan(roadmapStore.current?.currentPlan ?? null) })
</script>

<template>
  <div class="page overview-page">
    <AsyncState :loading="loading" :error="loadError">
    <template #default>
    <PageHeader eyebrow="01 · Orient" title="先知道要去哪里，再开始学习。" description="知行把一项技术拆成可解释的路线、当前节点和可回看的实践证据。今天只需要完成一个清晰的动作。" :meta="productPlan ? [`计划 ${productPlan.title}`, `${productPlan.units.length} 个节点`, '真实计划'] : ['还没有学习计划']" />
    <section v-if="!productPlan" class="plan-empty" aria-labelledby="plan-empty-title"><div><div class="eyebrow">Start a learning plan</div><h2 id="plan-empty-title">从一个目标开始建立你的路线</h2><p>先完成几项诊断，再确认一份真正属于当前学习方向的计划。</p></div><RouterLink to="/start"><ArrowRight :size="14" aria-hidden="true" />开始建立计划</RouterLink></section>
    <template v-else-if="plan">
    <section id="goal" class="goal-block" aria-labelledby="goal-title"><div class="section-marker"><Target :size="16" aria-hidden="true" /><span>总目标</span></div><h2 id="goal-title">{{ plan.goal }}</h2><p>不是把知识点全部看完，而是能从真实问题开始，解释它为什么这样运行，并在出错时找到下一条证据。</p></section>
    <ProgressSummary :plan="plan" :milestone="milestone" :node="node" :entry-to="entryTo" :entry-label="entryLabel" />
    <section id="status" class="status-section" aria-labelledby="status-title"><SectionHeading title="当前状况" detail="What is true now" /><div class="status-grid"><div><small>{{ currentUnit ? '正在进行' : '当前节点' }}</small><strong>{{ currentUnit?.title ?? '尚未选择' }}</strong><p>{{ currentUnit?.availability === 'coming_soon' ? '内容已记录在路线中，环境能力将在后续阶段开放。' : currentUnit?.objective ?? '先完成规划并确认一份学习路线。' }}</p></div><div><small>当前所在节点</small><strong>{{ currentUnit?.title ?? node?.title ?? '尚未选择' }}</strong><p>{{ currentUnit ? '当前正式计划只从这一单元进入学习。' : '路线图会显示下一步可以推进的方向。' }}</p></div><div><small>下一次行动</small><strong>{{ entryLabel }}</strong><p>{{ actionDescription }}</p></div></div></section>
    <RouteSnapshot :milestones="planStore.milestones" />
    <section id="current-node" class="current-node" aria-labelledby="current-node-title"><div><div class="eyebrow">{{ currentUnit ? 'Current node' : 'Route state' }} · {{ milestone?.index }}</div><h2 id="current-node-title">{{ currentUnit?.title ?? '尚未选择当前学习' }}</h2><p>{{ currentUnit?.objective ?? '先回到路线图查看可推进的节点。' }}</p></div><RouterLink :to="entryTo">{{ entryLabel }} <ArrowRight :size="14" aria-hidden="true" /></RouterLink></section>
    <div class="overview-foot"><span><CalendarDays :size="13" aria-hidden="true" />本周安排 {{ plan.weeklyMinutes }} 分钟</span><span><Crosshair :size="13" aria-hidden="true" />当前进度会根据实践证据调整</span></div>
    </template>
    </template>
    </AsyncState>
  </div>
</template>

<style scoped>
.overview-page { max-width: 920px; }
.plan-empty { display: flex; align-items: center; justify-content: space-between; gap: 22px; margin-top: 28px; padding: 20px 0; border-top: 2px solid var(--orange); border-bottom: 1px solid var(--line); }.plan-empty h2 { margin: 8px 0 0; color: var(--ink); font: 400 23px var(--serif); }.plan-empty p { max-width: 600px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }.plan-empty a { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 8px 11px; border: 1px solid #b66844; background: var(--orange-soft); color: #995436; font-size: 10px; text-decoration: none; white-space: nowrap; }
.generated-route { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 14px; padding: 13px 15px; border-left: 3px solid var(--green); background: var(--green-soft); }
.generated-route h2 { margin: 6px 0 0; color: var(--ink); font: 400 18px var(--serif); }
.generated-route p { margin: 5px 0 0; color: var(--muted); font-size: 10px; }
.generated-route a { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; border: 1px solid #8dad99; color: #3e7650; font-size: 10px; text-decoration: none; white-space: nowrap; }
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
@media (max-width: 680px) { .plan-empty { align-items: stretch; flex-direction: column; } .plan-empty a { justify-content: center; } }
</style>
