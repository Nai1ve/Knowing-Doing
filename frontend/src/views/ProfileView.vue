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
    <AsyncState :loading="profileStore.loading" :error="profileStore.error"><template #default><template v-if="profileStore.profile"><PageHeader eyebrow="06 · Profile" :title="`${profileStore.profile.name} 的学习档案`" description="这里展示知行为什么这样判断你的起点。每条信号都应该能被你确认、修改或移除。" :meta="[profileStore.profile.role, '可确认的学习画像']" /><section id="profile-evidence" class="profile-intro"><div class="profile-avatar"><UserRound :size="22" aria-hidden="true" /></div><div><div class="eyebrow">Current baseline</div><h2>{{ profileStore.profile.role }}</h2><p>{{ profileStore.profile.background }}</p></div></section><section id="profile-preferences" class="signals"><div class="signals-heading"><div><div class="eyebrow">Evidence used by the plan</div><h2>画像依据</h2></div><span>可调整</span></div><div class="signal-list"><article v-for="signal in profileStore.profile.signals" :key="signal"><FileText :size="14" aria-hidden="true" /><div><strong>{{ signal }}</strong><p>这条信息会影响学习内容的起点和练习形式，你可以在后续诊断中修正。</p></div><button class="secondary-button" type="button">保留</button></article></div></section><section class="profile-boundary"><strong>画像不是结论。</strong><span>知行会在首次进入和每周复盘时继续追问，确认计划是否仍然适合你。</span></section></template></template></AsyncState>
  </div>
</template>

<style scoped>
.profile-page { max-width: 820px; } .profile-intro { display: grid; grid-template-columns: 47px 1fr; gap: 14px; margin-top: 27px; padding-bottom: 19px; border-bottom: 1px solid var(--line); } .profile-avatar { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--blue); color: var(--blue); } .profile-intro h2 { margin: 7px 0 0; color: #3e4945; font: 400 23px var(--serif); } .profile-intro p { max-width: 580px; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.signals { margin-top: 27px; } .signals-heading { display: flex; align-items: end; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid var(--line); } .signals-heading h2 { margin: 7px 0 0; color: #303738; font: 400 22px var(--serif); } .signals-heading span { color: var(--muted); font: 9px var(--mono); } .signal-list { display: grid; } .signal-list article { display: grid; grid-template-columns: 17px 1fr auto; gap: 10px; align-items: start; padding: 14px 0; border-bottom: 1px solid var(--line-soft); } .signal-list article > svg { color: var(--blue); } .signal-list strong { color: #3f4946; font-size: 11px; font-weight: 500; } .signal-list p { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; } .signal-list button { min-height: 25px; padding: 4px 7px; font-size: 9px; }
.profile-boundary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 25px; padding: 12px; border-left: 2px solid var(--orange); background: var(--orange-soft); color: #7f6e63; font-size: 10px; line-height: 1.5; } .profile-boundary strong { color: #765643; font-weight: 500; }
@media (max-width: 500px) { .signal-list article { grid-template-columns: 17px 1fr; } .signal-list button { grid-column: 2; justify-self: start; } }
</style>
