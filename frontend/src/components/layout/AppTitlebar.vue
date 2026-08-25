<template>
  <header class="titlebar">
    <div class="window-title">知行 · Kubernetes 系统学习</div>
    <div class="window-tools"><span>知乎知识待连接</span><span>林</span></div>
  </header>
</template>

<style scoped>
.titlebar { display: grid; grid-template-columns: 1fr auto; align-items: center; min-height: 42px; padding: 0 20px; border-bottom: 1px solid var(--chrome-line); background: var(--chrome); color: #d8dce0; font-size: 10px; }
.window-title { overflow: hidden; color: #eef1f2; letter-spacing: .3px; text-overflow: ellipsis; white-space: nowrap; }
.window-tools { display: flex; justify-content: flex-end; gap: 11px; color: #aab4ba; }
.window-tools span:first-child::before { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: var(--orange); content: ""; }
@media (max-width: 700px) { .titlebar { padding-inline: 17px; } .window-tools span:first-child { display: none; } }
</style>
