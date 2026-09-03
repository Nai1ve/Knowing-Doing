import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/start', name: 'start', component: () => import('@/views/StartView.vue') },
    { path: '/planning/:sessionId', name: 'planning', component: () => import('@/views/PlanningView.vue') },
    { path: '/roadmap-preview/:roadmapId', name: 'roadmap-preview', component: () => import('@/views/RoadmapPreviewView.vue') },
    { path: '/diagnostic/:sessionId', name: 'diagnostic', component: () => import('@/views/DiagnosticView.vue') },
    { path: '/plan-preview/:proposalId', name: 'plan-preview', component: () => import('@/views/PlanPreviewView.vue') },
    { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
    { path: '/route', name: 'route', redirect: '/roadmap' },
    { path: '/roadmap', name: 'roadmap', component: () => import('@/views/RouteView.vue') },
    { path: '/roadmap/:roadmapId/node/:nodeId', name: 'roadmap-node', component: () => import('@/views/RouteView.vue') },
    { path: '/lesson', name: 'lesson', component: () => import('@/views/LessonView.vue') },
    { path: '/notes', name: 'notes', component: () => import('@/views/NotesView.vue') },
    { path: '/writing', name: 'writing', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/materials', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/outline', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/article', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/review', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/preview', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/review', name: 'review', component: () => import('@/views/ReviewView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
