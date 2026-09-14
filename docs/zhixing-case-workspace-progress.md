# 案例工作区进度与未完成项

日期：2026-09-14
分支：`new_undo`
范围：M2.4 收尾、M3 文章触发的证据解读、Runner server 级测试

## 本批已完成

### M2.4 Tutor 与统一证据链

- 已确认实现落地：`runTutor()` 按 `practice_kind` 分派 workspace context；`buildWorkspaceTutorContext` 有界（当前任务、最近 6 条执行、文件摘要、工作区状态、节点知识卡）；Tutor prompt 约束（不替用户写文件、不把 pytest 通过宣布为已掌握）；`snapshot()` 统一 Artifact/Event；写作按 `practiceRunId` 通用。
- 补齐 service 层测试 `test/practice-tutor.test.ts`：真实 code_workspace 实践经 `streamTutor` 驱动，断言模型收到的 context 是有界的 `WorkspaceTutorContext` 且 user/tutor 证据链正确回写。
- 锁定 Tutor prompt 行为约束断言（`test/tutor.test.ts`）。

### M2.0.4 / M2.1 / M4-B 韧性测试

- `resumeWorkspaces()`：缺 runner id、runner 已结束、执行中服务重启、Runner 不可达四场景。
- `resumeCaseJobs()`：30 秒栅栏 requeue 重跑，无半份 spec。
- `retryCaseGeneration()`：仅 failed/interrupted 可重试、复用同 job 与不可变输入指纹、成功 job 拒绝。
- preflight runner 丢失：一次 repair 后透明失败，不降级 fixture。
- 路由 HTTP 契约测试 `test/case-workspace-routes.test.ts`：202/201/422 状态映射、X-Learner-Id 所有权、编码路径往返、stale revision 409、结束后拒绝写入。
- 前端测试环境修复：Node v26 `localStorage` 遮蔽 jsdom 的问题（vitest setup）。
- 规划测评失败自动恢复（`recoverFailedAssessment`）。

### M3 文章触发：写作证据解读（已实现，测试未完成）

`writing-service.ts` 已让写作模块识别 code_workspace 证据：

- `materialCategory`：`workspace_command` / `workspace_file` → attempt；`workspace_output` / `workspace_error` / `workspace_verification` → evidence。
- `materialTitle`：补齐工作区命令/文件/输出/错误/验证结果的标题。
- `isVerifiedEvidence(status)`：`verified_lab` 与 `verified_workspace` 同等视为已核验证据，用于 outline 的 `lab` 过滤、`selected` 默认选中、solution/verification 段。
- context 段实验环境按 `practiceKind` 区分"MySQL Lab"与"Python 工作区"；证据/尝试/方案/验证段的占位文案覆盖两种证据。

## 未完成项（下一批）

1. **workspace → 写作的证据测试**：`materialCategory`/`materialTitle`/`isVerifiedEvidence` 是模块私有函数，目前无测试锁定 workspace 证据进入写作 project 后的分类、选中与 outline 表现。应在 `test/narrative-writing.test.ts` 增加一个 code_workspace 实践（`createPracticeRun({ practiceKind: 'code_workspace', ... })` + workspace artifacts）→ `initialize` → 断言 material 的 category/selected/title 与 outline 的 `verified_workspace` 纳入。

2. **M3 路线自动完成的剩余闭环**：`markWorkspaceVerifiedInTransaction` 已做节点 `verified` + `roadmap_events` 事件；尚未推进的依赖节点自动解锁、plan unit 完成推进或写作自动触发（auto draft）。M2 计划明确这些属 M3，且需要先确认完成语义，避免引入不成熟的自动完成。

3. **Runner server 级自动化测试**：`workspace-runner/src/server.ts` 目前把 `docker()`/路由/租约清理/启动监听写在一个模块里，无法在不启动真实服务或依赖真实 Docker 的情况下注入 fake spawn 与假时钟。需要先做小重构——把核心逻辑抽成 `createRunnerService(deps)`（注入 `spawn`、`now`、`executionTimeoutMs`、`idleMs` 等），`server.ts` 变成薄启动层——再补四个测试：输出截断（>1MB）、30 秒超时后 `docker rm -f` 并返回 `timed_out`、空闲/过期租约清理、创建容器参数断言（`--network none` 且无 Docker socket 挂载）。

4. **前端侧**：CaseSetupView/CodeWorkspaceView 的浏览器验收（1440px/1024px）尚未按 M2.2 要求跑过。

## 验证基线

- 后端：`npm test` 176/176、`tsc --noEmit` 通过。
- 前端：`npm test` 58/58、`vue-tsc` typecheck、`vite build` 通过。
- workspace-runner：`npm run build` + `npm test` 3/3 通过。
