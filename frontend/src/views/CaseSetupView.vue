<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, ArrowLeft, LoaderCircle } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import CaseBriefForm from '@/components/case-workspace/CaseBriefForm.vue'
import CaseSpecSummary from '@/components/case-workspace/CaseSpecSummary.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { useCaseWorkspaceStore } from '@/stores/caseWorkspace'
import { useRoadmapStore } from '@/stores/roadmap'
import type { RoadmapNode } from '@/types/product'

const route = useRoute(); const router = useRouter(); const roadmap = useRoadmapStore(); const cases = useCaseWorkspaceStore(); const node = ref<RoadmapNode | null>(null); const pageError = ref<string | null>(null)
const roadmapId = computed(() => String(route.params.roadmapId)); const nodeId = computed(() => String(route.params.nodeId)); const knowledge = computed(() => (node.value ? roadmap.knowledgeRoutes[node.value.id] : undefined)); const caseReady = computed(() => cases.learningCase?.status === 'ready' && Boolean(cases.learningCase.spec)); const caseFailed = computed(() => cases.learningCase?.status === 'failed' || cases.job?.status === 'failed' || cases.job?.status === 'interrupted')

function knownNodes() { return [ ...(roadmap.current?.roots ?? []), ...Object.values(roadmap.children).flat() ] }
async function findNode() {
  node.value = knownNodes().find((item) => item.id === nodeId.value) ?? null
  if (node.value) return
  for (const root of roadmap.current?.roots ?? []) { if (!root.childCount) continue; await roadmap.loadChildren(roadmapId.value, root.id); node.value = knownNodes().find((item) => item.id === nodeId.value) ?? null; if (node.value) return }
}
async function initialize() {
  pageError.value = null
  try {
    await roadmap.loadCurrent(); await findNode()
    if (!node.value) throw new Error('没有找到对应的路线节点，请返回路线图重试。')
    try { await roadmap.loadKnowledge(roadmapId.value, node.value.id) } catch { /* 阅读材料不是案例生成的前置条件 */ }
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : '案例节点加载失败' }
}
async function createCase(payload: { input: Parameters<typeof cases.create>[1]; desiredOutcome?: string; difficulty?: 'introductory' | 'applied' | 'advanced' }) { if (!node.value) return; try { await cases.create(node.value.id, payload.input, payload.desiredOutcome, payload.difficulty) } catch { /* store 保留可见错误和表单 */ } }
async function startWorkspace() { try { const result = await cases.startPractice(); if (result) await router.push({ name: 'code-workspace', params: { workspaceRunId: result.workspace.id } }) } catch { /* store 保留错误 */ } }
async function retry() { try { await cases.retry() } catch { /* store 保留错误 */ } }
onMounted(() => { cases.resetCase(); void initialize() })
</script>

<template>
  <div class="page case-setup-page"><PageHeader eyebrow="03 · Case workspace" :title="node ? `把「${node.title}」变成一次真实练习。` : '准备一次代码实践。'" description="先用一句话描述你想解决的问题，也可以从当前节点的阅读材料开始。案例生成完成后，进入受限的 Python pytest 工作区。" :meta="[node?.learningMode === 'workspace' ? 'Python workspace' : '节点不可用', '按需生成', '证据会保存']" /><div class="back-row"><button class="back-button" type="button" @click="router.push({ name: 'roadmap-node', params: { roadmapId, nodeId } })"><ArrowLeft :size="13" aria-hidden="true" />返回路线节点</button></div><div v-if="pageError" class="page-error" role="alert"><AlertCircle :size="15" aria-hidden="true" />{{ pageError }}</div><AsyncState v-else :loading="roadmap.loading && !node" :error="null"><template #default><section v-if="node && node.learningMode !== 'workspace'" class="unavailable"><h2>这个节点暂时还没有代码工作区</h2><p>当前只支持 Python pytest 案例，其他节点仍保留在路线中。</p></section><div v-else-if="node" class="case-layout"><main><CaseBriefForm v-if="!cases.learningCase || cases.learningCase.status === 'failed'" :sources="knowledge?.items ?? []" :loading="cases.loading || cases.isGenerating" @submit="createCase" /><section v-else-if="cases.isGenerating" class="generation-panel" role="status"><LoaderCircle :size="18" class="spin" aria-hidden="true" /><div><span class="eyebrow">Case builder · {{ cases.job?.provider }}</span><h2>正在整理一次可执行的 Python 实践</h2><p>正在冻结节点上下文、准备初始文件和验证命令。刷新页面不会影响后台任务。</p><small>任务状态：{{ cases.job?.status }}</small></div></section><CaseSpecSummary v-else-if="caseReady && cases.learningCase" :learning-case="cases.learningCase" :starting="cases.working" @start="startWorkspace" @retry="retry" /><section v-else class="case-pending"><LoaderCircle :size="16" class="spin" aria-hidden="true" />正在载入案例状态…</section><div v-if="cases.error" class="case-error" role="alert"><AlertCircle :size="14" aria-hidden="true" /><span>{{ cases.error }}</span><button v-if="caseFailed" type="button" @click="retry">重试</button></div></main><aside class="node-context"><span class="eyebrow">Node context</span><h2>{{ node.title }}</h2><p>{{ node.summary }}</p><dl><div><dt>完成标准</dt><dd>{{ node.completionStandard }}</dd></div><div><dt>预计投入</dt><dd>{{ node.estimatedMinutes }} 分钟</dd></div><div><dt>案例来源</dt><dd>{{ cases.learningCase?.provider === 'model' ? '模型构建' : 'Fixture / Model 可切换' }}</dd></div></dl><div v-if="knowledge?.items.length" class="source-note"><strong>已有阅读材料</strong><span v-for="item in knowledge.items.slice(0, 3)" :key="item.id">{{ item.source.title }}</span></div></aside></div></template></AsyncState></div>
</template>

<style scoped>
.case-setup-page { max-width: 1180px; }.back-row { margin: 14px 0; }.back-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 0; border: 0; background: transparent; color: var(--blue); font: 9px var(--mono); }.case-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; margin-top: 15px; align-items: start; }.case-layout main { display: grid; gap: 12px; min-width: 0; }.node-context { display: grid; gap: 10px; padding: 15px; border-top: 2px solid var(--blue); background: var(--paper-deep); }.node-context h2 { margin: 5px 0 0; color: var(--ink); font: 400 20px/1.25 var(--serif); }.node-context p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.6; }.node-context dl { display: grid; gap: 9px; margin: 4px 0 0; padding-top: 11px; border-top: 1px solid var(--line); }.node-context dl div { display: grid; gap: 4px; }.node-context dt { color: #7b8580; font: 9px var(--mono); }.node-context dd { margin: 0; color: #56625c; font-size: 10px; line-height: 1.45; }.source-note { display: grid; gap: 6px; padding-top: 11px; border-top: 1px solid var(--line); }.source-note strong { color: var(--ink); font-size: 10px; }.source-note span { color: var(--muted); font-size: 9px; line-height: 1.4; }.generation-panel, .case-pending, .unavailable { display: flex; align-items: flex-start; gap: 13px; padding: 22px 18px; border-top: 2px solid var(--blue); background: var(--paper-deep); }.generation-panel h2 { margin: 6px 0 0; color: var(--ink); font: 400 22px var(--serif); }.generation-panel p { max-width: 600px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }.generation-panel small { display: block; margin-top: 9px; color: var(--blue); font: 9px var(--mono); }.case-pending { align-items: center; color: var(--muted); font-size: 11px; }.unavailable { display: block; }.unavailable h2 { margin: 0; color: var(--ink); font: 400 22px var(--serif); }.unavailable p { color: var(--muted); font-size: 11px; }.case-error, .page-error { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); font-size: 10px; line-height: 1.5; }.case-error button { margin-left: auto; padding: 5px 7px; border: 1px solid #d5aaa3; background: transparent; color: var(--red); font-size: 9px; white-space: nowrap; }.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 850px) { .case-layout { grid-template-columns: 1fr; }.node-context { order: -1; } }
</style>
