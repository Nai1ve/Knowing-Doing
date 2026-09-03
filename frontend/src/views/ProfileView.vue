<script setup lang="ts">
import { onMounted } from 'vue'
import { FileText, UserRound } from 'lucide-vue-next'
import PageHeader from '@/components/shared/PageHeader.vue'
import AsyncState from '@/components/shared/AsyncState.vue'
import { useProfileStore } from '@/stores/profile'

const profileStore = useProfileStore()
onMounted(() => void profileStore.load())
</script>

<template>
  <div class="page profile-page">
    <AsyncState :loading="profileStore.loading" :error="profileStore.error"><template #default><PageHeader eyebrow="06 · Profile" title="你的学习档案，目前只记录你提供过的信息。" description="2A 不替你推断能力。每条依据都保留来源和时间，后续诊断能力接入后再增加可确认的系统判断。" :meta="['用户输入', `${profileStore.evidence.length} 条记录`, '可追溯']" /><section id="profile-evidence" class="profile-intro"><div class="profile-avatar"><UserRound :size="22" aria-hidden="true" /></div><div><div class="eyebrow">Current evidence</div><h2>已保存的学习背景</h2><p>这些内容来自你的目标和诊断回答，不代表系统已经确认你掌握了什么。</p></div></section><section id="profile-preferences" class="signals"><div class="signals-heading"><div><div class="eyebrow">Evidence used by the plan</div><h2>画像依据</h2></div><span>来源：用户输入</span></div><div v-if="profileStore.evidence.length" class="signal-list"><article v-for="item in profileStore.evidence" :key="item.id"><FileText :size="14" aria-hidden="true" /><div><strong>{{ item.content }}</strong><p>{{ item.evidenceKey }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</p></div><span class="source-tag">原始输入</span></article></div><div v-else class="empty-evidence">完成一次诊断后，这里会显示你的学习目标、经验、时间和预期产出。</div></section><section class="profile-boundary"><strong>画像不是结论。</strong><span>后续可以在诊断和实践之后继续修正。</span></section></template></AsyncState>
  </div>
</template>

<style scoped>
.profile-page { max-width: 820px; } .profile-intro { display: grid; grid-template-columns: 47px 1fr; gap: 14px; margin-top: 27px; padding-bottom: 19px; border-bottom: 1px solid var(--line); } .profile-avatar { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--blue); color: var(--blue); } .profile-intro h2 { margin: 7px 0 0; color: #3e4945; font: 400 23px var(--serif); } .profile-intro p { max-width: 580px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.signals { margin-top: 27px; } .signals-heading { display: flex; align-items: end; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid var(--line); } .signals-heading h2 { margin: 7px 0 0; color: #303738; font: 400 22px var(--serif); } .signals-heading span { color: var(--muted); font: 9px var(--mono); } .signal-list { display: grid; } .signal-list article { display: grid; grid-template-columns: 17px 1fr auto; gap: 10px; align-items: start; padding: 14px 0; border-bottom: 1px solid var(--line-soft); } .signal-list article > svg { color: var(--blue); } .signal-list strong { color: #3f4946; font-size: 11px; font-weight: 500; } .signal-list p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; } .signal-list button { min-height: 25px; padding: 4px 7px; font-size: 9px; }
.source-tag { color: var(--muted); font: 9px var(--mono); white-space: nowrap; }.empty-evidence { padding: 18px 0; color: var(--muted); font-size: 11px; }
.profile-boundary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 25px; padding: 12px; border-left: 2px solid var(--orange); background: var(--orange-soft); color: #7f6e63; font-size: 10px; line-height: 1.5; } .profile-boundary strong { color: #765643; font-weight: 500; }
@media (max-width: 500px) { .signal-list article { grid-template-columns: 17px 1fr; } .signal-list button { grid-column: 2; justify-self: start; } }
</style>
