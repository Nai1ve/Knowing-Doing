<script setup lang="ts">
import { ArrowLeft, ArrowRight, CircleAlert } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/shared/AsyncState.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import GymBuildPanel from '@/components/gym/GymBuildPanel.vue'
import { useGymBuildStore } from '@/stores/gymBuild'
import { usePracticeStore } from '@/stores/practice'

const route = useRoute(); const router = useRouter(); const store = useGymBuildStore(); const practiceStore = usePracticeStore()
const planId = computed(() => typeof route.query.planId === 'string' ? route.query.planId : '')
const planUnitId = computed(() => typeof route.query.planUnitId === 'string' ? route.query.planUnitId : '')
const title = computed(() => store.build?.case?.spec?.title ?? '把当前学习节点变成一次真实实践')
async function initialize() {
  if (!planId.value || !planUnitId.value) { store.error = '缺少当前计划单元，请从总览重新进入。'; return }
  await store.create(planId.value, planUnitId.value)
}
async function start() {
  const result = await store.start()
  if (!result) return
  if (result.kind === 'docker_workspace') await router.push({ name: 'code-workspace', params: { workspaceRunId: result.workspace.workspace.id } })
  else {
    await practiceStore.adoptStartedPractice({ practice: result.practice, lab: result.lab })
    await router.push({ name: 'lesson', query: { planUnitId: planUnitId.value } })
  }
}
onMounted(() => { void initialize() })
onBeforeUnmount(() => store.dispose())
</script>

<template>
  <div class="page gym-build-page"><PageHeader eyebrow="03 · Zhixing Gym" :title="title" description="当前学习单元会先由 Agent 生成案例，再由平台创建受限的实践环境。环境能力和执行边界由服务端控制。" :meta="[store.build?.environment.displayName ?? '按当前节点选择环境', '按需构建', '状态可恢复']" /><button class="back-button" type="button" @click="router.push({ name: 'overview' })"><ArrowLeft :size="13" aria-hidden="true" />返回总览</button><AsyncState :loading="store.loading && !store.build" :error="store.error && !store.build ? store.error : null"><template #default><section v-if="!store.build && !store.loading" class="missing-build"><CircleAlert :size="16" aria-hidden="true" /><div><h2>暂时无法构建 Gym</h2><p>当前计划单元没有可用的实践能力，路线仍然可以继续查看。</p><RouterLink to="/roadmap">查看路线图 <ArrowRight :size="13" aria-hidden="true" /></RouterLink></div></section><GymBuildPanel v-else :build="store.build" :events="store.events" :loading="store.loading" :starting="store.starting" :error="store.error" @retry="store.retry" @start="start" /></template></AsyncState></div>
</template>

<style scoped>
.gym-build-page { max-width: 920px; }.back-button { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 5px 0; border: 0; background: transparent; color: var(--blue); font: 9px var(--mono); cursor: pointer; }.back-button:hover { color: var(--blue-deep); }.missing-build { display: flex; align-items: flex-start; gap: 12px; margin-top: 25px; padding: 18px; border-top: 2px solid var(--orange); background: var(--paper-deep); color: var(--orange); }.missing-build h2 { margin: 0; color: var(--ink); font: 400 22px var(--serif); }.missing-build p { margin: 8px 0 13px; color: var(--muted); font-size: 11px; }.missing-build a { display: inline-flex; align-items: center; gap: 5px; color: #995436; font-size: 10px; text-decoration: none; }.missing-build a:hover { color: #82462c; }
</style>
