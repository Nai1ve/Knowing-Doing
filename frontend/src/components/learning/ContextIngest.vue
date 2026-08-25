<script setup lang="ts">
import { ref } from 'vue'
import { ClipboardPaste, Terminal } from 'lucide-vue-next'
import type { EventType } from '@/types/domain'

const emit = defineEmits<{ ingest: [payload: { type: EventType; title: string; body: string; source: string }] }>()
const mode = ref<'paste' | 'cli'>('paste')
const input = ref('')
const status = ref('')

function record() {
  const value = input.value.trim()
  if (!value) { status.value = '先粘贴一段 YAML、命令输出或错误日志。'; return }
  const isError = /error|failed|forbidden|报错|失败|错误/i.test(value)
  const type: EventType = isError ? 'error' : /kubectl|get pods|get deployment|ready|status/i.test(value) ? 'observation' : 'reference'
  emit('ingest', { type, title: type === 'error' ? '手动粘贴的错误上下文' : type === 'observation' ? '手动粘贴的运行上下文' : '手动粘贴的学习上下文', body: value, source: '手动粘贴' })
  status.value = '已记录到实践素材流。'
  input.value = ''
}
</script>

<template>
  <section class="context-ingest" aria-label="实践上下文接入">
    <div class="context-heading"><h3>接入实践上下文</h3><span>进入实践记录</span></div>
    <p>执行完成后，把 YAML、终端输出或错误日志带回知行。</p>
    <div class="context-modes" role="group" aria-label="上下文接入方式">
      <button class="context-mode" :class="{ active: mode === 'paste' }" type="button" :aria-pressed="mode === 'paste'" @click="mode = 'paste'"><ClipboardPaste :size="13" aria-hidden="true" />粘贴上下文</button>
      <button class="context-mode" :class="{ active: mode === 'cli' }" type="button" :aria-pressed="mode === 'cli'" @click="mode = 'cli'"><Terminal :size="13" aria-hidden="true" />CLI 自动抓取</button>
    </div>
    <div v-if="mode === 'paste'" class="context-panel">
      <label for="context-input">终端输出、YAML 或错误日志</label>
      <textarea id="context-input" v-model="input" placeholder="例如：kubectl get pods -o wide\nNAME   READY   STATUS\napi-7d9  0/1     Pending" />
      <div class="context-actions"><button class="primary-button" type="button" @click="record">记录到实践</button><span class="context-status" role="status" aria-live="polite">{{ status }}</span></div>
    </div>
    <div v-else class="context-panel cli-panel">
      <div class="cli-command"><code>knowing-doing capture --from kubectl --since 30m</code></div>
      <span class="cli-badge">需要本地连接器</span>
      <p class="cli-note">CLI 由用户主动授权后采集命令输出、YAML 和错误上下文，再同步到当前学习单元。</p>
      <span class="context-status" role="status" aria-live="polite">当前原型未连接本地 CLI；正式版需安装连接器并由你授权采集。</span>
    </div>
  </section>
</template>

<style scoped>
.context-ingest { margin-top: 18px; padding: 13px 14px; border: 1px solid #c8ccdc; background: #f7f7f0; }
.context-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.context-heading h3 { display: flex; align-items: center; gap: 7px; margin: 0; color: #303738; font-family: var(--serif); font-size: 16px; font-weight: 400; }
.context-heading span { color: #858c87; font-size: 9px; }
.context-ingest > p, .cli-note { margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.context-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 11px; }
.context-mode { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 7px 8px; border: 1px solid #c8ccdc; background: transparent; color: #66716d; font-size: 9px; }
.context-mode:hover, .context-mode.active { border-color: var(--blue); background: var(--blue-soft); color: #3347af; }
.context-panel { margin-top: 10px; }
.context-panel label { display: block; color: #66716d; font-size: 9px; }
.context-panel textarea { display: block; width: 100%; min-height: 82px; margin-top: 5px; resize: vertical; padding: 8px; border: 1px solid #c8cbc2; border-radius: 0; background: #fff; color: #4d5753; font: 10px/1.5 var(--mono); }
.context-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 7px; }
.context-status { color: var(--green); font-size: 9px; line-height: 1.4; }
.cli-command { display: flex; align-items: center; padding: 9px; border: 1px solid #c8cbc2; background: #eeece0; }
.cli-command code { min-width: 0; overflow-wrap: anywhere; color: #3f4a4a; font: 9px/1.45 var(--mono); }
.cli-badge { display: inline-block; margin-top: 7px; padding: 3px 5px; border: 1px solid #d7cabc; color: #a45836; font-family: var(--mono); font-size: 8px; }
.cli-panel .context-status { display: block; margin-top: 9px; }
@media (max-width: 700px) { .context-modes { grid-template-columns: 1fr; } }
</style>
