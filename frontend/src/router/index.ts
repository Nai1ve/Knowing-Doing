import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { safeRedirectPath } from '@/utils/auth-flow'

export function createAppRouter(history = createWebHistory(import.meta.env.BASE_URL)) {
  const router = createRouter({
    history,
    routes: [
    { path: '/', redirect: '/overview' },
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { public: true } },
    { path: '/start', name: 'start', component: () => import('@/views/StartView.vue') },
    { path: '/planning/:sessionId', name: 'planning', component: () => import('@/views/PlanningView.vue') },
    { path: '/roadmap-preview/:roadmapId', name: 'roadmap-preview', component: () => import('@/views/RoadmapPreviewView.vue') },
    { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
    { path: '/route', name: 'route', redirect: '/roadmap' },
    { path: '/roadmap', name: 'roadmap', component: () => import('@/views/RouteView.vue') },
    { path: '/roadmap/:roadmapId/node/:nodeId', name: 'roadmap-node', component: () => import('@/views/RouteView.vue') },
    { path: '/roadmap/:roadmapId/node/:nodeId/case', name: 'case-setup', component: () => import('@/views/CaseSetupView.vue') },
    { path: '/workspace/:workspaceRunId', name: 'code-workspace', component: () => import('@/views/CodeWorkspaceView.vue') },
    { path: '/lesson', name: 'lesson', component: () => import('@/views/LessonView.vue') },
    { path: '/gym-build', name: 'gym-build', component: () => import('@/views/GymBuildView.vue') },
    { path: '/notes', name: 'notes', component: () => import('@/views/NotesView.vue') },
    { path: '/writing', name: 'writing', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/materials', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/outline', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/article', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/review', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/writing/preview', redirect: (to) => ({ name: 'writing', query: to.query }) },
    { path: '/review', name: 'review', component: () => import('@/views/ReviewView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { public: true } },
    ],
    scrollBehavior: () => ({ top: 0 }),
  })
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    const session = await auth.bootstrapSession()
    if (to.meta.public) {
      if (to.name === 'auth' && session && (!session.auth.required || session.auth.authenticated)) return { name: 'overview' }
      return true
    }
    if (!session || (session.auth.required && !session.auth.authenticated)) return { name: 'auth', query: { redirect: safeRedirectPath(to.fullPath) }, replace: true }
    return true
  })
  return router
}

export const router = createAppRouter()
