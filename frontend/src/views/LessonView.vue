<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { AlertCircle, CheckCircle2, Database, ShieldCheck } from 'lucide-vue-next'
import PageHeader from '@/components/shared/PageHeader.vue'
import LabRunPanel from '@/components/lab/LabRunPanel.vue'
import SqlWorkbench from '@/components/lab/SqlWorkbench.vue'
import TutorAgent from '@/components/learning/TutorAgent.vue'
import { useLabStore } from '@/stores/lab'
import { usePracticeStore } from '@/stores/practice'

const labStore = useLabStore()
const practiceStore = usePracticeStore()
const selectedFixture = computed(() => labStore.health?.fixtures[labStore.selectedCaseId])

onMounted(() => { void initialize(); labStore.startHeartbeat() })
onUnmounted(() => { labStore.dispose() })

async function initialize() {
  await labStore.load()
  await practiceStore.restoreActive()
}

async function startPractice() { await practiceStore.start(labStore.selectedCaseId) }
async function executePractice() { await practiceStore.execute() }
function askTutor(message: string) { void practiceStore.ask(message) }
</script>

<template>
  <div class="page lab-page">
    <PageHeader
      eyebrow="03 · MySQL Lab"
      title="慢查询实验室"
      description="连接一份受控的 MySQL 8.4 实验环境，在真实执行计划和结果中验证你的判断。"
      :meta="['单实例 · 独立案例 schema', 'SQL 原始输出可见', '本轮只开放慢查询']"
    />

    <div v-if="labStore.loading" class="lab-loading" role="status">正在检查 MySQL Lab…</div>
    <div v-else class="lab-content">
      <section class="lab-intro" aria-labelledby="lab-intro-title">
        <div>
          <div class="eyebrow">Current case · mysql-order-list-index-001</div>
          <h2 id="lab-intro-title">先让数据库告诉你发生了什么</h2>
          <p>这里不直接给出优化结论。启动实验后，你可以执行 EXPLAIN、索引 DDL 和对比 SQL；结果只以当前固定数据中的真实输出为准。</p>
        </div>
        <div class="intro-facts">
          <span><Database :size="13" aria-hidden="true" />{{ selectedFixture?.fixtureVersion ?? 'fixture pending' }}</span>
          <span><ShieldCheck :size="13" aria-hidden="true" />schema 隔离</span>
        </div>
      </section>

      <LabRunPanel
        :health="labStore.health"
        :cases="labStore.cases"
        :selected-case-id="labStore.selectedCaseId"
        :run="labStore.run"
        :ticket="labStore.ticket"
        :starting="labStore.starting || practiceStore.starting"
        :polling="labStore.polling"
        :resetting="labStore.resetting"
        :ending="labStore.ending"
        @start="startPractice"
        @reset="labStore.reset"
        @end="labStore.end"
        @cancel="labStore.cancelQueue"
        @select="labStore.selectedCaseId = $event"
      />

      <div class="lab-grid">
        <main class="lab-main">
          <SqlWorkbench
            v-model:sql="labStore.sql"
            :result="labStore.latestResult"
            :can-execute="Boolean(practiceStore.run && labStore.run && labStore.activeSession?.status === 'open' && labStore.environmentReady)"
            :executing="labStore.executing"
            :session-name="labStore.activeSession?.name"
            @execute="executePractice"
            @load-default="labStore.loadDefaultSql"
            @load-create-index="labStore.loadCreateIndexSql"
            @load-optimized="labStore.loadOptimizedSql"
          />
        </main>

        <aside class="lab-aside">
          <section class="boundary-panel" aria-labelledby="boundary-title">
            <div class="eyebrow">Execution boundary</div>
            <h2 id="boundary-title">本轮允许的操作</h2>
            <ul>
              <li><CheckCircle2 :size="13" aria-hidden="true" />当前案例表内的查询和 EXPLAIN</li>
              <li><CheckCircle2 :size="13" aria-hidden="true" />索引创建、调整与删除</li>
              <li><CheckCircle2 :size="13" aria-hidden="true" />最多返回 200 行和 1 MiB 输出</li>
              <li><CheckCircle2 :size="13" aria-hidden="true" />每个会话内串行执行</li>
            </ul>
          </section>

          <section v-if="labStore.error" class="lab-error" role="alert">
            <AlertCircle :size="14" aria-hidden="true" />
            <div><strong>请求未完成</strong><p>{{ labStore.error }}</p></div>
          </section>

          <TutorAgent :messages="practiceStore.messages" :loading="practiceStore.tutorLoading" :current-question="practiceStore.lastTutor?.nextQuestion" :current-gap="practiceStore.currentGap" @ask="askTutor" />

          <section v-if="practiceStore.error" class="lab-error" role="alert">
            <AlertCircle :size="14" aria-hidden="true" />
            <div><strong>实践记录未完成</strong><p>{{ practiceStore.error }}</p></div>
          </section>

          <section class="case-facts" aria-labelledby="case-facts-title">
            <div class="eyebrow">Case fixture</div>
            <h2 id="case-facts-title">慢查询与联合索引</h2>
            <dl>
              <div><dt>表</dt><dd><code>orders</code></dd></div>
              <div><dt>基线索引</dt><dd><code>idx_orders_user_id</code></dd></div>
              <div><dt>会话</dt><dd><code>default</code></dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lab-page { max-width: 1120px; }
.lab-loading { margin-top: 24px; padding: 18px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--muted); font-size: 12px; }
.lab-content { display: grid; gap: 14px; margin-top: 24px; }
.lab-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 17px; border: 1px solid var(--line); background: var(--orange-soft); }
.lab-intro h2 { margin: 6px 0 0; color: var(--ink); font: 400 23px/1.25 var(--serif); }
.lab-intro p { max-width: 690px; margin: 8px 0 0; color: #665a53; font-size: 11px; line-height: 1.6; }
.intro-facts { display: grid; gap: 8px; min-width: 170px; color: #806049; font: 9px var(--mono); }
.intro-facts span { display: flex; align-items: center; gap: 6px; }
.lab-grid { display: grid; grid-template-columns: minmax(0, 1fr) 245px; gap: 14px; align-items: start; }
.lab-main { display: grid; gap: 14px; min-width: 0; }
.lab-aside { display: grid; gap: 14px; position: sticky; top: 15px; }
.boundary-panel, .case-facts { padding: 14px; border: 1px solid var(--line); background: var(--paper-deep); }
.boundary-panel h2, .case-facts h2 { margin: 5px 0 0; color: var(--ink); font: 400 17px var(--serif); }
.boundary-panel ul { display: grid; gap: 10px; margin: 15px 0 0; padding: 0; list-style: none; }
.boundary-panel li { display: flex; gap: 6px; color: var(--muted); font-size: 10px; line-height: 1.45; }
.boundary-panel li svg { flex: 0 0 auto; color: var(--green); }
.lab-error { display: flex; gap: 8px; padding: 11px; border-left: 2px solid var(--red); background: var(--red-soft); color: var(--red); }
.lab-error strong { font-size: 10px; font-weight: 600; }
.lab-error p { margin: 4px 0 0; color: #714841; font-size: 10px; line-height: 1.5; }
.case-facts dl { display: grid; gap: 9px; margin: 14px 0 0; }
.case-facts dl div { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line-soft); padding-bottom: 7px; }
.case-facts dt { color: var(--muted); font-size: 10px; }
.case-facts dd { margin: 0; color: var(--ink); font-size: 10px; text-align: right; }
code { font-family: var(--mono); font-size: 9px; }
@media (max-width: 900px) { .lab-grid { grid-template-columns: 1fr; } .lab-aside { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); } .lab-error { align-self: start; } }
@media (max-width: 600px) { .lab-intro { display: block; } .intro-facts { margin-top: 14px; } .lab-aside { grid-template-columns: 1fr; } }
</style>
