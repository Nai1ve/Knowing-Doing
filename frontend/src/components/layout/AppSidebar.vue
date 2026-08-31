<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, CircleUserRound, FileText, Flag, Gauge, GitBranch, Settings2 } from 'lucide-vue-next'
import { RouterLink, useRoute } from 'vue-router'
import { usePlanStore } from '@/stores/plan'

const route = useRoute()
const planStore = usePlanStore()
const navItems = [
  { name: 'overview', label: '总览', icon: Gauge },
  { name: 'route', label: '整体路线', icon: GitBranch },
  { name: 'lesson', label: 'MySQL 实验', icon: BookOpen },
  { name: 'writing-materials', label: '写作沉淀', icon: FileText },
  { name: 'review', label: '周复盘', icon: Flag },
]
const utilityItems = [
  { name: 'profile', label: '学习档案', icon: CircleUserRound },
  { name: 'settings', label: '设置', icon: Settings2 },
]
const activeName = computed(() => String(route.name ?? 'overview'))
</script>

<template>
  <aside class="sidebar" aria-label="页面导航">
    <div class="logo"><span aria-hidden="true" />知行</div>
    <div class="sidebar-label">学习计划 · 01</div>
    <nav class="page-nav" aria-label="学习页面">
      <RouterLink v-for="item in navItems" :key="item.name" :to="{ name: item.name }" :aria-label="item.label" :aria-current="activeName === item.name ? 'page' : undefined" :class="{ active: activeName === item.name }">
        <component :is="item.icon" :size="14" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="sidebar-divider" />
    <nav class="utility-nav" aria-label="账户和设置">
      <RouterLink v-for="item in utilityItems" :key="item.name" :to="{ name: item.name }" :aria-label="item.label" :aria-current="activeName === item.name ? 'page' : undefined" :class="{ active: activeName === item.name }">
        <component :is="item.icon" :size="14" aria-hidden="true" /><span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div v-if="planStore.plan" class="plan-chip"><small>Current plan</small><strong>{{ planStore.plan.title }}</strong><p>第 {{ planStore.plan.week }} 周 / 共 {{ planStore.plan.totalWeeks }} 周</p><p>知乎知识 + 知行 AI</p></div>
    <div class="sidebar-foot">根据你的目标、简历与诊断结果生成。<br />计划可以被确认和调整。</div>
  </aside>
</template>

<style scoped>
.sidebar { padding: 16px 13px; border-right: 1px solid #d0d0c9; background: var(--paper-deep); }
.logo { display: flex; align-items: center; gap: 7px; padding: 4px 8px 17px; border-bottom: 1px solid #cbcfc9; color: #222a2e; font-family: var(--serif); font-size: 15px; }
.logo > span { width: 7px; height: 7px; background: var(--blue); }
.sidebar-label { margin: 21px 8px 8px; color: #7a817e; font-family: var(--mono); font-size: 9px; letter-spacing: .4px; text-transform: uppercase; }
.page-nav, .utility-nav { display: grid; gap: 2px; }
.page-nav a, .utility-nav a { display: flex; align-items: center; gap: 8px; min-height: 33px; padding: 6px 8px; border: 1px solid transparent; color: #596363; font-size: 11px; text-decoration: none; }
.page-nav a:hover, .utility-nav a:hover { border-color: #b8c1ec; color: var(--blue); }
.page-nav a.active, .utility-nav a.active { border-color: #b8c1ec; background: var(--blue-soft); color: #2c43bc; }
.sidebar-divider { margin: 18px 8px 10px; border-top: 1px solid #cbcfc9; }
.plan-chip { margin-top: 20px; padding: 12px 8px; border-top: 1px solid #cbcfc9; border-bottom: 1px solid #cbcfc9; }
.plan-chip small { color: #6c65b7; font-family: var(--mono); font-size: 9px; letter-spacing: .5px; text-transform: uppercase; }
.plan-chip strong { display: block; margin-top: 7px; color: #222a2e; font-family: var(--serif); font-size: 13px; font-weight: 400; line-height: 1.4; }
.plan-chip p { margin: 8px 0 0; color: #7a817e; font-size: 10px; }
.sidebar-foot { margin-top: 26px; padding: 0 8px; color: #87908b; font-size: 10px; line-height: 1.5; }
@media (max-width: 980px) { .sidebar { padding: 16px 9px; } .logo { justify-content: center; padding-inline: 0; font-size: 0; } .sidebar-label, .plan-chip, .sidebar-foot, .page-nav span, .utility-nav span { display: none; } .page-nav a, .utility-nav a { justify-content: center; padding-inline: 0; } .sidebar-divider { margin-inline: 0; } }
</style>
