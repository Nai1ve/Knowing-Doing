<script setup lang="ts">
import { Database, LockKeyhole } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import ConnectionCard from '@/components/settings/ConnectionCard.vue'
import { useAuthStore } from '@/stores/auth'
import type { OAuthConnection } from '@/types/domain'

const authStore = useAuthStore()
const status = ref('')
onMounted(() => void authStore.loadConnections())
function connect(provider: OAuthConnection['provider']) {
  const redirected = authStore.authorize(provider)
  status.value = redirected ? `正在跳转到${provider === 'zhihu' ? '知乎' : '模型服务'}授权页…` : '当前为 Mock 模式，OAuth 接口已预留，尚未发起真实授权。'
}
async function disconnect(provider: OAuthConnection['provider']) { await authStore.disconnect(provider); status.value = '连接已断开。' }
</script>

<template>
  <div class="page settings-page">
    <PageHeader eyebrow="07 · Settings" title="连接你愿意交给知行的能力。" description="OAuth 只负责授权，不改变数据边界。知乎检索、模型生成和本地 CLI 连接器都需要由你主动开启。" :meta="['OAuth 接口已预留', '默认 Mock 模式', '可随时断开']" />
    <AsyncState :loading="authStore.loading"><template #default><section id="settings-connections" class="connections"><div class="section-title"><div><div class="eyebrow">Authorized connections</div><h2>连接状态</h2></div><span class="status-text" role="status" aria-live="polite">{{ status }}</span></div><div class="connection-list"><ConnectionCard v-for="connection in authStore.connections" :key="connection.provider" :connection="connection" @connect="connect(connection.provider)" @disconnect="disconnect(connection.provider)" /></div></section><section id="settings-data" class="data-boundary"><div class="boundary-item"><LockKeyhole :size="16" aria-hidden="true" /><div><strong>明确授权后才读取</strong><p>知乎收藏、回答检索和模型服务都通过 OAuth 连接，默认不读取你的外部数据。</p></div></div><div class="boundary-item"><Database :size="16" aria-hidden="true" /><div><strong>本地实践仍由你控制</strong><p>Web 端不直接执行 kubectl、不读取 kubeconfig。CLI 连接器需要单独安装、主动启动和可撤销授权。</p></div></div></section></template></AsyncState>
  </div>
</template>

<style scoped>
.settings-page { max-width: 850px; } .connections { margin-top: 27px; } .section-title { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); } .section-title h2 { margin: 7px 0 0; color: #303738; font: 400 22px var(--serif); } .section-title .status-text { text-align: right; } .connection-list { display: grid; } .data-boundary { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 28px; padding-top: 14px; border-top: 2px solid var(--blue); } .boundary-item { display: grid; grid-template-columns: 20px 1fr; gap: 8px; } .boundary-item > svg { color: var(--blue); } .boundary-item strong { color: #3f4946; font-size: 11px; font-weight: 500; } .boundary-item p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
@media (max-width: 620px) { .section-title { align-items: start; flex-direction: column; } .section-title .status-text { text-align: left; } .data-boundary { grid-template-columns: 1fr; } }
</style>
