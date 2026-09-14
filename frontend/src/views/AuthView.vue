<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ExternalLink, ShieldCheck } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { safeRedirectPath } from '@/utils/auth-flow'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const pending = ref(false)
const redirectPath = computed(() => safeRedirectPath(route.query.redirect))
const profile = computed(() => auth.session?.auth.profile)

async function continueWithZhihu() {
  pending.value = true
  try {
    const redirected = await auth.authorize('zhihu')
    if (!redirected) pending.value = false
  } catch { pending.value = false }
}

async function retry() {
  await auth.bootstrapSession(true)
  if (auth.session && (!auth.session.auth.required || auth.session.auth.authenticated)) await router.replace(redirectPath.value)
}

onMounted(() => { void auth.bootstrapSession() })
</script>

<template>
  <div class="auth-page">
    <section class="auth-card" aria-labelledby="auth-title">
      <div class="auth-mark"><ShieldCheck :size="18" aria-hidden="true" /></div>
      <span class="eyebrow">知行 · 身份入口</span>
      <h1 id="auth-title">先用知乎继续，开始你的学习计划。</h1>
      <p class="auth-description">知乎账号只用于确认你的身份和连接你主动授权的内容。昵称、头像只是资料展示，不会替代你的学习证据。</p>
      <div v-if="profile" class="auth-profile"><img v-if="profile.avatarUrl" :src="profile.avatarUrl" alt="" /><div><strong>{{ profile.displayName || '知乎用户' }}</strong><small>已识别知乎资料</small></div></div>
      <button class="auth-primary" type="button" :disabled="pending || auth.bootstrapping" @click="continueWithZhihu"><ExternalLink :size="15" aria-hidden="true" />{{ pending ? '正在跳转知乎…' : '使用知乎继续' }}</button>
      <div v-if="auth.bootstrapError" class="auth-error" role="alert"><strong>暂时无法确认登录状态</strong><p>{{ auth.bootstrapError }}</p><button type="button" class="auth-retry" @click="retry">重新检查</button></div>
      <p v-else class="auth-note">授权完成后会返回知行并继续到 {{ redirectPath === '/overview' ? '总览' : '你刚才打开的页面' }}。</p>
    </section>
  </div>
</template>

<style scoped>
.auth-page { display: grid; place-items: center; min-height: calc(100dvh - 64px); padding: 40px 20px; background: var(--paper); }.auth-card { width: min(100%, 440px); padding: 32px; border-top: 3px solid var(--blue); background: var(--paper-deep); box-shadow: 0 18px 45px rgb(35 43 51 / 7%); }.auth-mark { display: grid; place-items: center; width: 34px; height: 34px; margin-bottom: 20px; color: var(--blue); border: 1px solid var(--blue); background: var(--blue-soft); }.auth-card h1 { margin: 10px 0 0; color: var(--ink); font: 400 30px/1.2 var(--serif); }.auth-description { margin: 15px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }.auth-profile { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding: 10px; border: 1px solid var(--line); background: var(--paper); }.auth-profile img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }.auth-profile strong, .auth-profile small { display: block; }.auth-profile strong { color: var(--ink); font-size: 12px; }.auth-profile small { margin-top: 3px; color: var(--muted); font: 9px var(--mono); }.auth-primary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 40px; margin-top: 22px; border: 1px solid var(--blue); background: var(--blue); color: white; cursor: pointer; font-size: 12px; }.auth-primary:disabled { opacity: .6; cursor: wait; }.auth-note { margin: 15px 0 0; color: var(--muted); font: 9px/1.6 var(--mono); }.auth-error { margin-top: 18px; padding: 11px; border-left: 2px solid var(--orange); background: var(--orange-soft); }.auth-error strong { color: var(--ink); font-size: 11px; }.auth-error p { margin: 5px 0 9px; color: var(--muted); font-size: 10px; line-height: 1.5; }.auth-retry { padding: 6px 9px; border: 1px solid var(--line); background: var(--paper); color: var(--blue); cursor: pointer; font-size: 10px; }
</style>
