<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, CircleAlert, ExternalLink, ShieldCheck } from 'lucide-vue-next'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import ToolDock from '@/components/learning/ToolDock.vue'
import ContextIngest from '@/components/learning/ContextIngest.vue'
import PinnedReferences from '@/components/learning/PinnedReferences.vue'
import TutorAgent from '@/components/learning/TutorAgent.vue'
import { usePlanStore } from '@/stores/plan'
import { useLessonStore } from '@/stores/lesson'
import type { EventType, PinnedReference } from '@/types/domain'

const planStore = usePlanStore()
const lessonStore = useLessonStore()
const toolStatus = ref('')
const finishStatus = ref('')
const visibleSteps = computed(() => lessonStore.lesson?.steps ?? [])

onMounted(() => {
  if (planStore.plan) void lessonStore.load('lesson-02-03', planStore.plan.id)
})

function openTool(tool: 'editor' | 'terminal' | 'data') {
  const labels = { editor: '编辑器', terminal: '终端', data: '运行数据' }
  toolStatus.value = `已记录：准备打开${labels[tool]}。正式版通过本地连接器打开并回传上下文。`
}

async function ingest(payload: { type: EventType; title: string; body: string; source: string }) {
  if (!planStore.plan) return
  await lessonStore.addEvent(planStore.plan.id, payload)
}

async function finishLesson() {
  await lessonStore.finish()
  finishStatus.value = lessonStore.completed ? '已提交学习证据，当前节点完成状态已记录。' : ''
}

function pin(reference: PinnedReference) { lessonStore.pin(reference) }
</script>

<template>
  <div class="page lesson-page">
    <AsyncState :loading="lessonStore.loading" :error="lessonStore.error"><template #default>
      <template v-if="lessonStore.lesson">
        <PageHeader eyebrow="03 · Practice" :title="lessonStore.lesson.title" :description="lessonStore.lesson.description" :meta="[`当前节点 ${planStore.currentNode?.title}`, '外部工具 + 知行工作台', '证据会进入学习笔记']" />
        <section id="lesson-steps" class="lesson-steps" aria-labelledby="steps-title"><div class="steps-heading"><h2 id="steps-title">今天的线性步骤</h2><span>完成一条，再进入下一条</span></div><div class="step-list"><button v-for="step in visibleSteps" :key="step.id" type="button" class="step-item" :class="{ active: lessonStore.activeStepId === step.id }" @click="lessonStore.setStep(step.id)"><span class="step-index">{{ step.label }}</span><span><strong>{{ step.title }}</strong><small>{{ step.description }}</small></span><Check v-if="lessonStore.activeStepId !== step.id && step.id === 'understand'" :size="13" aria-hidden="true" /></button></div></section>
        <section id="workbench" class="workbench" aria-labelledby="workbench-title"><div class="workbench-main"><div class="workbench-heading"><div><div class="eyebrow">Workbench · current task</div><h2 id="workbench-title">{{ lessonStore.activeStep?.title }}</h2></div><span>固定区域 · 当前节点</span></div><p class="workbench-question">{{ lessonStore.lesson.question }}</p><div class="example-grid"><div><div class="example-label">先看这个示例</div><pre><code>{{ lessonStore.lesson.code }}</code></pre></div><div class="checklist"><div class="example-label">检查点</div><p><ShieldCheck :size="14" aria-hidden="true" />能否说出 Deployment、ReplicaSet、Pod 分别负责什么？</p><p><ShieldCheck :size="14" aria-hidden="true" />能否区分 replicas、当前副本和 Ready？</p><p><ShieldCheck :size="14" aria-hidden="true" />能否说明下一条要看的运行证据？</p></div></div><ToolDock @open="openTool" /><p v-if="toolStatus" class="tool-status-line" role="status"><ExternalLink :size="12" aria-hidden="true" />{{ toolStatus }}</p><ContextIngest @ingest="ingest" /><PinnedReferences :items="lessonStore.pinned" @remove="lessonStore.unpin" /></div><aside class="workbench-rail"><TutorAgent :messages="lessonStore.messages" :loading="lessonStore.tutorLoading" @ask="lessonStore.ask(planStore.plan!.id, $event)" @pin="pin" /><section id="checkpoint" class="evidence-box" aria-labelledby="evidence-title"><div class="evidence-heading"><h3 id="evidence-title"><CircleAlert :size="14" aria-hidden="true" />提交学习证据</h3><span>完成当前单元</span></div><label for="evidence-input">用一句话说明你的判断</label><textarea id="evidence-input" v-model="lessonStore.evidence" rows="4" placeholder="例如：我会先比较期望、当前和 Ready，再看 Events 判断哪个环节没有达到期望。" /><button class="primary-button" type="button" @click="finishLesson">提交证据</button><p class="status-text" role="status" aria-live="polite">{{ finishStatus }}</p></section></aside></section>
      </template>
    </template></AsyncState>
  </div>
</template>

<style scoped>
.lesson-page { max-width: 1080px; } .lesson-steps { margin-top: 22px; padding-bottom: 3px; } .steps-heading, .workbench-heading, .evidence-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; } .steps-heading { padding-bottom: 9px; border-bottom: 1px solid var(--line); } .steps-heading h2, .workbench-heading h2 { margin: 0; color: #303738; font: 400 21px var(--serif); } .steps-heading span, .workbench-heading > span { color: #858c87; font-size: 9px; }
.step-list { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-top: 10px; } .step-item { display: grid; grid-template-columns: 24px 1fr; gap: 6px; min-height: 70px; padding: 8px; border: 1px solid var(--line); background: transparent; color: #65706b; text-align: left; } .step-item:hover, .step-item.active { border-color: var(--blue); background: var(--blue-soft); color: #3347af; } .step-index { color: #8b83b3; font: 9px var(--mono); } .step-item strong { display: block; font-size: 10px; font-weight: 500; } .step-item small { display: block; margin-top: 5px; color: #78817c; font-size: 9px; line-height: 1.4; }
.workbench { display: grid; grid-template-columns: minmax(0, 1fr) 275px; gap: 14px; margin-top: 25px; } .workbench-main { min-width: 0; padding: 14px; border: 1px solid #c8ccdc; background: #f7f7f0; } .workbench-heading { padding-bottom: 10px; border-bottom: 1px solid var(--line); } .workbench-question { margin: 12px 0 0; color: #3e4945; font: 400 17px/1.45 var(--serif); } .example-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(180px, .9fr); gap: 12px; margin-top: 15px; } .example-label { color: #6c65b7; font: 9px var(--mono); letter-spacing: .4px; text-transform: uppercase; } pre { min-height: 124px; margin: 7px 0 0; overflow: auto; padding: 10px; border: 1px solid #c8cbc2; background: #232a30; color: #d7ded8; font: 10px/1.65 var(--mono); } .checklist { display: grid; align-content: start; gap: 8px; } .checklist p { display: flex; gap: 6px; margin: 7px 0 0; color: #65706b; font-size: 10px; line-height: 1.5; } .checklist p svg { flex: 0 0 auto; color: var(--green); }
.tool-status-line { display: flex; align-items: start; gap: 5px; margin: 8px 0 0; color: var(--green); font-size: 9px; line-height: 1.5; } .workbench-rail { position: sticky; top: 12px; align-self: start; } .evidence-box { margin-top: 15px; padding: 13px; border-top: 2px solid var(--green); background: var(--green-soft); } .evidence-heading { color: #4a6352; } .evidence-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; color: #3f5948; font: 400 16px var(--serif); } .evidence-heading span { color: #7a8d7d; font: 8px var(--mono); } .evidence-box label { display: block; margin-top: 11px; color: #637467; font-size: 9px; } .evidence-box textarea { display: block; width: 100%; margin-top: 5px; resize: vertical; padding: 8px; border: 1px solid #c1d0c3; border-radius: 0; background: #fff; color: #47564b; font: 10px/1.5 var(--sans); } .evidence-box button { width: 100%; margin-top: 8px; } .evidence-box .status-text { margin: 8px 0 0; }
@media (max-width: 980px) { .workbench { grid-template-columns: 1fr; } .workbench-rail { position: static; display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, .8fr); gap: 14px; } .workbench-rail .evidence-box { margin-top: 0; } } @media (max-width: 760px) { .step-list { grid-template-columns: 1fr 1fr; } .step-item:last-child { grid-column: 1 / -1; } .example-grid, .workbench-rail { grid-template-columns: 1fr; } .workbench-rail .evidence-box { margin-top: 0; } } @media (max-width: 480px) { .step-list { grid-template-columns: 1fr; } .step-item:last-child { grid-column: auto; } }
</style>
