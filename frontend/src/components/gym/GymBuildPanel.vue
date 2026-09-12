<script setup lang="ts">
import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, Wrench } from 'lucide-vue-next'
import { computed } from 'vue'
import type { ProductGymBuildEvent, ProductGymBuildView } from '@/types/product'

const props = defineProps<{ build: ProductGymBuildView | null; events: ProductGymBuildEvent[]; loading: boolean; starting: boolean; error: string | null }>()
const emit = defineEmits<{ retry: []; start: [] }>()

const phases: Record<string, string> = {
  designing: '设计', provisioning: '准备运行环境', initializing: '初始化资产', preflighting: '独立预检', repairing: '诊断修复', ready: '可用', failed: '失败', cleanup_pending: '等待清理',
}
const failureCategories: Record<string, string> = {
  platform_fault: '平台故障', agent_failure: '构建 Agent 未完成任务', preflight_failure: '独立预检未通过',
}
const failureSources: Record<string, string> = {
  case_preflight: 'MySQL 案例预检', case_generation: '案例生成', build: '环境构建', cleanup: '资源清理',
}
const currentPhase = computed(() => {
  if (!props.build) return ''
  if (props.build.job.status === 'ready' || props.build.job.status === 'failed' || props.build.job.status === 'cleanup_pending') return phases[props.build.job.status]
  return phases[props.build.job.currentPhase ?? 'designing']
})
const statusHeading = computed(() => {
  if (!props.build) return ''
  if (props.build.job.status === 'ready') return props.build.runtime.status === 'active' ? '实践环境已经激活' : '实践案例已经准备好'
  if (props.build.job.status === 'failed') return '环境构建没有完成'
  if (props.build.job.status === 'cleanup_pending') return '构建资源正在等待清理'
  return '正在构建一次可执行实践'
})
const visibleEvents = computed(() => props.events.slice(-10))
const canStart = computed(() => {
  const build = props.build
  if (!build || build.job.status !== 'ready' || build.failure) return false
  if (!build.job.learningCaseId || !build.case || build.case.status !== 'ready') return false
  return build.job.runtimeKind !== 'mysql_lab' || build.case.preflightStatus === 'passed'
})
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) }
</script>

<template>
  <section v-if="build" class="gym-build-panel" aria-live="polite">
    <div class="build-status" :class="[build.job.status, { blocked: build.failure }]" ><CheckCircle2 v-if="build.job.status === 'ready' && canStart" :size="17" aria-hidden="true" /><CircleAlert v-else-if="build.failure || ['failed', 'cleanup_pending'].includes(build.job.status)" :size="17" aria-hidden="true" /><LoaderCircle v-else :size="17" class="spin" aria-hidden="true" /><div><span class="eyebrow">Gym builder · {{ currentPhase }}</span><h2>{{ statusHeading }}</h2><p v-if="build.failure">{{ build.failure.message }}</p><p v-else-if="build.job.status === 'failed'">{{ build.job.failureMessage || '构建服务返回了失败状态，请重试。' }}</p><p v-else-if="build.job.status === 'cleanup_pending'">{{ build.job.lastCleanupError || '失败资源会按保留策略自动清理；完成后可以重新构建。' }}</p><p v-else-if="build.job.status === 'ready' && build.runtime.status === 'expired'">之前的实验运行已失效，可以重新启动 Gym；实践记录会继续保留。</p><p v-else-if="build.job.status === 'ready' && build.runtime.status === 'active'">当前实验运行仍然有效，可以直接回到实践页面继续学习。</p><p v-else-if="build.job.status === 'ready'">案例内容已经通过服务端校验，可以启动对应实验环境。</p><p v-else>平台正在独立验证环境；Agent 的完成信号本身不会直接让 Gym 可用。</p></div></div>
    <dl class="build-facts"><div><dt>环境</dt><dd>{{ build.environment.displayName }}</dd></div><div><dt>当前阶段</dt><dd>{{ currentPhase }}</dd></div><div><dt>构建尝试</dt><dd>{{ build.job.attemptCount || 0 }}<template v-if="build.job.repairRound"> · 修复 {{ build.job.repairRound }}/3</template></dd></div><div v-if="build.job.failureCategory"><dt>失败分类</dt><dd>{{ failureCategories[build.job.failureCategory] ?? build.job.failureCategory }}</dd></div></dl>
    <section v-if="build.failure" class="build-failure" role="alert"><div class="failure-heading"><CircleAlert :size="15" aria-hidden="true" /><strong>{{ build.failure.source === 'case_preflight' ? '动态 MySQL 案例预检失败，暂不可进入 Lab' : '当前 Gym 暂不可进入 Lab' }}</strong></div><p>{{ build.failure.message }}</p><dl><div><dt>错误来源</dt><dd>{{ failureSources[build.failure.source] ?? build.failure.source }}</dd></div><div><dt>错误代码</dt><dd><code>{{ build.failure.code }}</code></dd></div></dl></section>
    <section v-if="visibleEvents.length" class="build-timeline" aria-label="构建事件">
      <header><span class="eyebrow">构建时间线</span><span>{{ events.length }} 条安全事件</span></header>
      <ol>
        <li v-for="event in visibleEvents" :key="event.id" :class="event.phase ?? 'status'">
          <time :datetime="event.createdAt">{{ formatTime(event.createdAt) }}</time>
          <div><strong>{{ event.phase ? phases[event.phase] ?? event.phase : '状态' }}</strong><p>{{ event.summary }}</p><code v-if="event.command">{{ event.command }}</code><p v-if="event.diagnostic" class="diagnostic">{{ event.diagnostic.message }}</p></div>
        </li>
      </ol>
    </section>
    <div class="build-actions"><button v-if="build.job.status === 'failed'" type="button" class="secondary-button" :disabled="loading" @click="emit('retry')"><RotateCcw :size="14" aria-hidden="true" />重试构建</button><button v-if="canStart" type="button" class="primary-button" :disabled="starting" @click="emit('start')"><Wrench :size="14" aria-hidden="true" />{{ starting ? '正在启动…' : build.runtime.status === 'active' ? '继续进入知行 Gym' : build.runtime.status === 'expired' ? '重新启动 Gym' : '进入知行 Gym' }}<ArrowRight :size="14" aria-hidden="true" /></button></div>
    <p v-if="error" class="build-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.gym-build-panel { display: grid; gap: 18px; margin-top: 24px; padding: 20px; border-top: 2px solid var(--orange); background: var(--paper-deep); }.build-status { display: flex; align-items: flex-start; gap: 12px; color: var(--orange); }.build-status.ready { color: var(--green); }.build-status.failed, .build-status.cleanup_pending, .build-status.blocked { color: var(--red); }.build-status h2 { margin: 7px 0 0; color: var(--ink); font: 400 24px/1.25 var(--serif); }.build-status p { max-width: 660px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }.build-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 0; padding-top: 13px; border-top: 1px solid var(--line); }.build-facts div { display: grid; gap: 5px; }.build-facts dt, .build-failure dt { color: #7e8881; font: 9px var(--mono); }.build-facts dd, .build-failure dd { margin: 0; color: var(--ink); font-size: 11px; overflow-wrap: anywhere; }.build-failure { display: grid; gap: 9px; padding: 13px; border-left: 2px solid var(--red); background: var(--red-soft); }.failure-heading { display: flex; align-items: center; gap: 7px; color: var(--red); font-size: 11px; }.build-failure p { margin: 0; color: var(--ink); font-size: 11px; line-height: 1.55; white-space: pre-wrap; }.build-failure dl { display: flex; flex-wrap: wrap; gap: 16px; margin: 0; }.build-failure dl div { display: grid; gap: 5px; }.build-failure code { color: var(--red); font: 9px var(--mono); }.build-timeline { border-top: 1px solid var(--line); padding-top: 13px; }.build-timeline header { display: flex; justify-content: space-between; gap: 12px; color: #7e8881; font: 9px var(--mono); }.build-timeline ol { display: grid; gap: 9px; margin: 12px 0 0; padding: 0; list-style: none; }.build-timeline li { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 10px; padding-left: 10px; border-left: 2px solid var(--line); }.build-timeline li.ready { border-left-color: var(--green); }.build-timeline li.failed, .build-timeline li.cleanup_pending { border-left-color: var(--red); }.build-timeline time { padding-top: 1px; color: #7e8881; font: 9px var(--mono); }.build-timeline strong { color: var(--ink); font-size: 10px; }.build-timeline p { margin: 3px 0 0; color: var(--muted); font-size: 10px; line-height: 1.45; }.build-timeline .diagnostic { color: var(--red); }.build-timeline code { display: block; overflow: hidden; margin-top: 5px; padding: 5px 7px; text-overflow: ellipsis; white-space: nowrap; background: var(--paper); color: var(--blue); font: 9px var(--mono); }.build-actions { display: flex; gap: 9px; }.build-actions button { display: inline-flex; align-items: center; gap: 6px; min-height: 35px; padding: 8px 11px; border: 1px solid var(--blue); background: var(--blue); color: #fff; font-size: 10px; cursor: pointer; }.build-actions .primary-button { border-color: #995436; background: #995436; color: var(--white); }.build-actions .primary-button:hover { border-color: #82462c; background: #82462c; }.build-actions .secondary-button { border-color: var(--line); background: var(--paper); color: var(--blue); }.build-actions .secondary-button:hover { border-color: var(--orange); color: #995436; background: var(--orange-soft); }.build-error { margin: 0; padding: 9px 11px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); font-size: 10px; line-height: 1.5; }.spin { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }@media (max-width: 620px) { .build-facts { grid-template-columns: 1fr; gap: 11px; }.build-timeline li { grid-template-columns: 1fr; gap: 3px; }.build-actions { flex-direction: column; }.build-actions button { width: 100%; justify-content: center; } }
</style>
