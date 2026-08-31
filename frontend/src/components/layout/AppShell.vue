<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import PageToc from './PageToc.vue'
import { usePlanStore } from '@/stores/plan'

const route = useRoute()
const planStore = usePlanStore()
const currentPage = computed(() => String(route.name ?? 'overview'))
const tocItems = computed(() => ({
  overview: [{ label: '总目标', href: '#goal' }, { label: '当前状况', href: '#status' }, { label: '整体路线', href: '#overview-route' }, { label: '当前节点', href: '#current-node' }],
  route: [{ label: '知识树', href: '#route-tree' }, { label: '当前节点', href: '#route-selected' }],
  lesson: [{ label: '实验环境', href: '#lab-run-title' }, { label: 'SQL 工作台', href: '#sql-workbench-title' }, { label: '执行结果', href: '#execution-result-title' }],
  notes: [{ label: '实践记录', href: '#note-capture' }, { label: '整理大纲', href: '#note-outline' }, { label: '成文发布', href: '#note-article' }],
  'writing-materials': [{ label: '写作流程', href: '#writing-title' }, { label: '实践素材', href: '#materials-title' }],
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
    <div class="app-body">
      <AppSidebar />
      <section class="main-content">
        <div v-if="planStore.loading" class="loading-state" role="status">正在载入当前学习计划…</div>
        <div v-else-if="planStore.error" class="error-state" role="alert">{{ planStore.error }}</div>
        <RouterView v-else />
      </section>
      <PageToc :items="tocItems" />
    </div>
  </main>
</template>

<style scoped>
.app-window { width: 100%; min-height: 100dvh; background: var(--paper); }
.app-body { display: grid; grid-template-columns: 210px minmax(0, 1fr) 190px; min-height: 100dvh; }
.main-content { min-width: 0; padding: 32px 40px 52px; background: var(--paper); }
.loading-state, .error-state { max-width: 840px; margin: 80px auto; padding: 16px; border-top: 2px solid var(--blue); background: var(--paper-deep); color: var(--muted); font-size: 12px; }
.error-state { border-top-color: var(--red); color: var(--red); }
@media (max-width: 980px) { .app-body { grid-template-columns: 64px minmax(0, 1fr); } .main-content { padding-inline: 28px; } }
@media (max-width: 700px) { .main-content { padding: 25px 17px 38px; } }
</style>
