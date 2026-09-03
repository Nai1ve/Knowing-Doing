<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import PageToc from './PageToc.vue'

const route = useRoute()
const currentPage = computed(() => String(route.name ?? 'overview'))
const isWorkspacePage = computed(() => currentPage.value === 'lesson' || currentPage.value === 'writing' || currentPage.value.startsWith('writing-'))
const tocItems = computed(() => ({
  overview: [{ label: '总目标', href: '#goal' }, { label: '当前状况', href: '#status' }, { label: '整体路线', href: '#overview-route' }, { label: '当前节点', href: '#current-node' }],
  start: [{ label: '开始学习', href: '#capture-title' }],
  diagnostic: [{ label: '诊断输入', href: '#diagnostic-title' }],
  'plan-preview': [{ label: '计划路线', href: '#proposal-title' }, { label: '安排依据', href: '#proposal-rationale' }],
  route: [{ label: '知识树', href: '#route-tree' }, { label: '当前节点', href: '#route-selected' }],
  lesson: [{ label: '实验环境', href: '#lab-run-title' }, { label: 'SQL 工作台', href: '#sql-workbench-title' }, { label: '执行结果', href: '#execution-result-title' }],
  notes: [{ label: '实践记录', href: '#note-capture' }, { label: '整理大纲', href: '#note-outline' }, { label: '成文发布', href: '#note-article' }],
  'writing-materials': [{ label: '写作流程', href: '#writing-title' }, { label: '证据地图', href: '#curation-title' }],
  'writing-outline': [{ label: '写作流程', href: '#writing-title' }, { label: '大纲整理', href: '#outline-title' }],
  'writing-article': [{ label: '写作流程', href: '#writing-title' }, { label: '文章初稿', href: '#article-title' }],
  'writing-review': [{ label: '写作流程', href: '#writing-title' }, { label: '发布前检查', href: '#review-title' }],
  'writing-preview': [{ label: '写作流程', href: '#writing-title' }, { label: '知乎预览', href: '#preview-title' }],
  review: [{ label: '学习数据', href: '#review-stats' }, { label: '掌握变化', href: '#review-change' }, { label: '计划调整', href: '#review-adjustment' }],
  profile: [{ label: '画像依据', href: '#profile-evidence' }, { label: '学习偏好', href: '#profile-preferences' }],
  settings: [{ label: '连接状态', href: '#settings-connections' }, { label: '数据边界', href: '#settings-data' }],
}[currentPage.value] ?? []))
</script>

<template>
  <main class="app-window" aria-label="知行学习系统">
    <div class="app-body" :class="{ 'lesson-body': isWorkspacePage }">
      <AppSidebar />
      <section class="main-content" :class="{ 'lesson-content': isWorkspacePage }">
        <RouterView />
      </section>
      <PageToc v-if="!isWorkspacePage" :items="tocItems" />
    </div>
  </main>
</template>

<style scoped>
.app-window { width: 100%; min-height: 100dvh; background: var(--paper); }
.app-body { display: grid; grid-template-columns: 210px minmax(0, 1fr) 190px; min-height: 100dvh; }
.lesson-body { grid-template-columns: 210px minmax(0, 1fr); }
.main-content { min-width: 0; padding: 32px 40px 52px; background: var(--paper); }
.lesson-content { padding-inline: 34px; }
.loading-state, .error-state { max-width: 840px; margin: 80px auto; padding: 16px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--muted); font-size: 12px; }
.error-state { border-top-color: var(--red); color: var(--red); }
@media (max-width: 980px) { .app-body { grid-template-columns: 64px minmax(0, 1fr); } .main-content { padding-inline: 28px; } }
@media (max-width: 700px) { .main-content { padding: 25px 17px 38px; } }
</style>
