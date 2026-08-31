import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/lesson' },
    { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
    { path: '/route', name: 'route', component: () => import('@/views/RouteView.vue') },
    { path: '/lesson', name: 'lesson', component: () => import('@/views/LessonView.vue') },
    { path: '/notes', name: 'notes', component: () => import('@/views/NotesView.vue') },
    { path: '/writing', redirect: '/writing/materials' },
    { path: '/writing/materials', name: 'writing-materials', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/outline', name: 'writing-outline', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/article', name: 'writing-article', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/review', name: 'writing-review', component: () => import('@/views/WritingView.vue') },
    { path: '/writing/preview', name: 'writing-preview', component: () => import('@/views/WritingView.vue') },
    { path: '/review', name: 'review', component: () => import('@/views/ReviewView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
