import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
    { path: '/route', name: 'route', component: () => import('@/views/RouteView.vue') },
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
