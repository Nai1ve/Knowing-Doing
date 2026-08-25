<script setup lang="ts">
import { Code2, ExternalLink, Terminal, Activity } from 'lucide-vue-next'
const emit = defineEmits<{ open: [tool: 'editor' | 'terminal' | 'data'] }>()
const tools = [
  { id: 'editor' as const, label: '打开编辑器', description: '编写 deployment.yaml', eyebrow: 'CODE · LOCAL', icon: Code2 },
  { id: 'terminal' as const, label: '打开终端', description: '执行 kubectl 命令', eyebrow: 'SHELL · LOCAL', icon: Terminal },
  { id: 'data' as const, label: '查看运行数据', description: '核对 Pod 与 Events', eyebrow: 'OBSERVE · LOCAL', icon: Activity },
]
</script>

<template>
  <section class="tool-dock" aria-label="执行工具">
    <div class="tool-dock-heading"><h2>执行工具</h2><span>外部打开，不嵌入知行</span></div>
    <div class="tool-grid"><button v-for="tool in tools" :key="tool.id" class="tool-launch" type="button" @click="emit('open', tool.id)"><small>{{ tool.eyebrow }}</small><strong><component :is="tool.icon" :size="14" aria-hidden="true" />{{ tool.label }}<ExternalLink :size="11" aria-hidden="true" /></strong><span>{{ tool.description }}</span></button></div>
    <p class="tool-status">工具在本地环境运行，知行提供任务上下文与记录。</p>
  </section>
</template>

<style scoped>
.tool-dock { margin-top: 22px; padding-top: 13px; border-top: 1px solid var(--line); }
.tool-dock-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.tool-dock-heading h2 { margin: 0; color: #303738; font-family: var(--serif); font-size: 19px; font-weight: 400; }
.tool-dock-heading span { color: #858c87; font-size: 10px; }
.tool-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 11px; }
.tool-launch { display: grid; gap: 4px; min-height: 68px; padding: 9px; border: 1px solid #c5c9c2; background: #f7f7f0; color: #46514d; text-align: left; }
.tool-launch:hover { border-color: var(--blue); background: var(--blue-soft); }
.tool-launch small { color: #6c65b7; font-family: var(--mono); font-size: 8px; letter-spacing: .4px; text-transform: uppercase; }
.tool-launch strong { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; }
.tool-launch strong svg:last-child { margin-left: auto; }
.tool-launch span { color: #777f7b; font-size: 9px; }
.tool-status { min-height: 15px; margin: 7px 0 0; color: #7a817e; font-size: 9px; }
@media (max-width: 1100px) { .tool-grid { grid-template-columns: 1fr; } }
</style>
