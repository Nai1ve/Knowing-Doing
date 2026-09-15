<script setup lang="ts">
import { ChevronDown, Database, Download, Link2, LockKeyhole, LogOut, RefreshCw, Search } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import ConnectionCard from '@/components/settings/ConnectionCard.vue'
import { useAuthStore } from '@/stores/auth'
import type { OAuthConnection } from '@/types/domain'
import { getSourceCollections, getSourceItems, getSourceSyncs, saveSourceItem, searchSourceItems, startSourceSync } from '@/api/learningExperienceService'
import type { SourceCollection, SourceItem, SourceSync } from '@/types/learningExperience'
import { clearOAuthReturnPath, oauthFailureMessage, readOAuthReturnPath } from '@/utils/auth-flow'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const status = ref('')
const syncing = ref(false)
const sourceLoading = ref(false)
const sourceExpanded = ref(false)
const sourceQuery = ref('')
const syncs = ref<SourceSync[]>([])
const collections = ref<SourceCollection[]>([])
const items = ref<SourceItem[]>([])
const selectedCollection = ref<string | undefined>()
const sourceFixtures: SourceItem[] = [{ id: 'fixture-source-1', collectionId: 'fixture-collection', title: '如何把知识变成可复用的判断', excerpt: '从现象、证据到下一步动作，建立一条短而清晰的练习链。', author: '知乎收藏', url: 'https://www.zhihu.com/', saved: true, tags: ['学习方法', '实践'] }]
const zhihuOauthEnabled = import.meta.env.VITE_ZHIHU_OAUTH_ENABLED === 'true'
const sourceSyncEnabled = import.meta.env.VITE_ZHIHU_SOURCE_SYNC_ENABLED === 'true'

async function connect(provider: OAuthConnection['provider']) { const redirected = await authStore.authorize(provider); status.value = redirected ? `正在跳转到${provider === 'zhihu' ? '知乎' : '模型服务'}授权页…` : '授权接口暂时不可用，仍可先在 Mock 内容库中继续体验。' }
async function disconnect(provider: OAuthConnection['provider']) { if (!window.confirm('断开后会立即删除授权 Token；未被实践卡引用的私人同步内容也会清理。确认断开吗？')) return; await authStore.disconnect(provider); status.value = '连接已断开。' }
async function logoutDevice() {
  if (!window.confirm('退出登录后，本设备将断开当前会话。已保存的学习进度和知乎连接会保留，重新登录即可继续。确定退出吗？')) return
  status.value = '正在退出登录…'
  await authStore.logout()
  await router.replace({ name: 'auth' })
}
async function loadLibrary() {
  sourceLoading.value = true
  try { const [nextSyncs, nextCollections, nextItems] = await Promise.all([sourceSyncEnabled ? getSourceSyncs() : Promise.resolve([]), getSourceCollections(), getSourceItems(selectedCollection.value)]); syncs.value = nextSyncs; collections.value = nextCollections; items.value = nextItems.items }
  catch { if (import.meta.env.VITE_ENABLE_LEARNING_FIXTURES === 'true') { collections.value = [{ id: 'fixture-collection', name: '知乎收藏 · FIXTURE', itemCount: sourceFixtures.length, updatedAt: new Date().toISOString() }]; items.value = sourceFixtures; status.value = '当前显示的是显式开启的 fixture 内容。' } else { collections.value = []; items.value = []; syncs.value = []; status.value = '内容库接口尚未就绪；未启用 fixture。' } }
  finally { sourceLoading.value = false }
}
async function syncZhihu() { if (!sourceSyncEnabled) return; syncing.value = true; try { syncs.value = [await startSourceSync(), ...syncs.value]; status.value = '知乎内容同步已发起。' } catch { status.value = '知乎同步接口尚未就绪；请确认后端已部署，或开启显式 fixture 模式。' } finally { syncing.value = false } }
async function selectCollection(id?: string) { selectedCollection.value = id; await loadLibrary() }
async function search() { if (!sourceQuery.value.trim()) return loadLibrary(); sourceLoading.value = true; try { items.value = (await searchSourceItems(sourceQuery.value.trim())).items } catch { items.value = import.meta.env.VITE_ENABLE_LEARNING_FIXTURES === 'true' ? sourceFixtures.filter((item) => `${item.title}${item.excerpt}`.includes(sourceQuery.value.trim())) : [] } finally { sourceLoading.value = false } }
async function saveItem(item: SourceItem) { if (item.saved) return; try { await saveSourceItem(item.id); item.saved = true } catch { status.value = '保存内容失败，请稍后重试。' } }
onMounted(async () => {
  const connection = String(route.query.connection ?? '')
  const result = String(route.query.result ?? route.query.oauth ?? route.query.status ?? '')
  if (connection === 'zhihu' && (result === 'success' || result === 'connected')) {
    status.value = '正在确认知乎登录状态…'
    const session = await authStore.refreshAfterOAuth()
    if (session?.auth.authenticated) { const destination = readOAuthReturnPath(); clearOAuthReturnPath(); await router.replace(destination); return }
    status.value = '知乎授权已完成，但登录状态尚未确认，请重新检查。'
  } else if (connection === 'zhihu' && result) {
    clearOAuthReturnPath()
    status.value = `知乎授权失败：${oauthFailureMessage(route.query.reason)}`
  }
  await authStore.loadConnections()
  await loadLibrary()
})
</script>

<template>
  <div class="page settings-page">
    <PageHeader eyebrow="07 · Settings" title="连接你愿意交给知行的能力。" description="OAuth 只负责授权，不改变数据边界。知乎检索、模型生成和本地 CLI 连接器都需要由你主动开启。" :meta="['OAuth 接口已预留', '写操作需要 session + CSRF', '可随时断开']" />
    <AsyncState :loading="authStore.loading"><template #default><section id="settings-connections" class="connections"><div class="section-title"><div><div class="eyebrow">Authorized connections</div><h2>连接状态</h2></div><span class="status-text" role="status" aria-live="polite">{{ status }}</span></div><div v-if="zhihuOauthEnabled" class="connection-list"><ConnectionCard v-for="connection in authStore.connections" :key="connection.provider" :connection="connection" @connect="connect(connection.provider)" @disconnect="disconnect(connection.provider)" /></div><p v-else class="feature-disabled">知乎 OAuth 尚未启用；当前仍可使用已配置的公开内容搜索。</p><div class="device-session"><div><strong>当前设备会话</strong><p>退出登录只会断开本设备，不解除知乎授权；重新登录后学习进度仍然保留。</p></div><button type="button" class="logout-button" @click="logoutDevice"><LogOut :size="13" aria-hidden="true" />退出登录</button></div></section><section id="settings-library" class="source-library"><button type="button" class="library-toggle" @click="sourceExpanded = !sourceExpanded"><span><Link2 :size="15" />知乎内容库 <small>{{ items.length }} 条已载入</small></span><ChevronDown :size="15" :class="{ rotated: sourceExpanded }" /></button><div v-if="sourceExpanded" class="library-body"><div class="library-toolbar"><button v-if="sourceSyncEnabled" type="button" class="primary-button" :disabled="syncing" @click="syncZhihu"><RefreshCw :size="13" :class="{ spin: syncing }" />{{ syncing ? '同步中…' : '同步知乎' }}</button><form @submit.prevent="search"><Search :size="13" /><input v-model="sourceQuery" placeholder="检索内容库和知乎公开内容" aria-label="检索内容库和知乎公开内容" /><button type="submit">检索</button></form></div><div class="collection-tabs"><button type="button" :class="{ active: !selectedCollection }" @click="selectCollection(undefined)">全部</button><button v-for="collection in collections" :key="collection.id" type="button" :class="{ active: selectedCollection === collection.id }" @click="selectCollection(collection.id)">{{ collection.name }} · {{ collection.itemCount }}</button></div><div v-if="sourceLoading" class="library-empty">正在加载内容库…</div><div v-else-if="!items.length" class="library-empty">还没有匹配的内容。授权并同步后，知乎收藏会出现在这里。</div><div v-else class="source-items"><article v-for="item in items" :key="item.id"><div><a :href="item.url" target="_blank" rel="noreferrer">{{ item.title }}</a><p>{{ item.excerpt }}</p><small>{{ item.author ?? '知乎内容' }} · {{ item.tags.join(' · ') }}</small></div><button type="button" :class="{ saved: item.saved }" :disabled="item.saved" @click="saveItem(item)"><Download :size="13" />{{ item.saved ? '已保存' : '保存' }}</button></article></div><p v-if="syncs.length" class="sync-note">最近同步：{{ syncs[0]?.status }} · {{ syncs[0]?.importedCount ?? 0 }} 条新增</p></div></section><section id="settings-data" class="data-boundary"><div class="boundary-item"><LockKeyhole :size="16" aria-hidden="true" /><div><strong>明确授权后才读取</strong><p>知乎收藏、回答检索和模型服务都通过 OAuth 连接，默认不读取你的外部数据。</p></div></div><div class="boundary-item"><Database :size="16" aria-hidden="true" /><div><strong>本地实践仍由你控制</strong><p>Web 端不直接执行 kubectl、不读取 kubeconfig。CLI 连接器需要单独安装、主动启动和可撤销授权。</p></div></div></section></template></AsyncState>
  </div>
</template>

<style scoped>
.settings-page { max-width: 850px; }.connections { margin-top: 27px; }.section-title { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }.section-title h2 { margin: 7px 0 0; color: #303738; font: 400 22px var(--serif); }.section-title .status-text { max-width: 340px; color: var(--muted); text-align: right; font-size: 10px; line-height: 1.45; }.connection-list { display: grid; }.feature-disabled { margin: 12px 0 0; color: var(--muted); font-size: 10px; }.device-session { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding: 11px 12px; border: 1px solid var(--line-soft); background: var(--paper); }.device-session strong { color: #3f4946; font-size: 11px; font-weight: 500; }.device-session p { margin: 4px 0 0; color: var(--muted); font-size: 9px; line-height: 1.5; }.logout-button { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; min-height: 30px; padding: 6px 9px; border: 1px solid var(--line); background: var(--paper); color: var(--red); font-size: 10px; cursor: pointer; }.logout-button:hover { border-color: var(--red); }.source-library { margin-top: 28px; border-top: 2px solid var(--green); background: var(--paper-deep); }.library-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 13px 0; border: 0; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }.library-toggle span { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; }.library-toggle small { color: var(--muted); font: 9px var(--mono); }.rotated { transform: rotate(180deg); }.library-body { padding: 0 0 14px; }.library-toolbar { display: flex; align-items: center; gap: 10px; }.primary-button, .library-toolbar form button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; border: 1px solid #b66844; background: var(--orange-soft); color: #995436; font-size: 10px; cursor: pointer; }.library-toolbar form { display: flex; align-items: center; flex: 1; gap: 6px; padding: 0 7px; border: 1px solid var(--line); background: var(--paper); color: var(--muted); }.library-toolbar input { flex: 1; min-width: 0; padding: 8px 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 10px; }.collection-tabs { display: flex; gap: 6px; overflow-x: auto; margin: 13px 0; }.collection-tabs button { flex: 0 0 auto; padding: 6px 8px; border: 1px solid var(--line); background: var(--paper); color: var(--muted); font-size: 9px; cursor: pointer; }.collection-tabs button.active { border-color: var(--blue); color: var(--blue); }.source-items { display: grid; gap: 7px; }.source-items article { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--line); background: var(--paper); }.source-items a { color: var(--blue); font: 12px var(--serif); text-decoration: none; }.source-items p { margin: 5px 0; color: var(--muted); font-size: 10px; line-height: 1.5; }.source-items small, .sync-note, .library-empty { color: #838c85; font: 9px var(--mono); }.source-items button { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 6px 8px; border: 1px solid var(--line); background: var(--paper); color: var(--blue); font-size: 9px; cursor: pointer; }.source-items button.saved { border-color: var(--green); color: var(--green); }.library-empty { padding: 18px 0; }.sync-note { margin: 10px 0 0; }.data-boundary { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 28px; padding-top: 14px; border-top: 2px solid var(--blue); }.boundary-item { display: grid; grid-template-columns: 20px 1fr; gap: 8px; }.boundary-item > svg { color: var(--blue); }.boundary-item strong { color: #3f4946; font-size: 11px; font-weight: 500; }.boundary-item p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }@media (max-width: 620px) { .section-title { align-items: start; flex-direction: column; }.section-title .status-text { text-align: left; }.library-toolbar { align-items: stretch; flex-direction: column; }.data-boundary { grid-template-columns: 1fr; } }
</style>
