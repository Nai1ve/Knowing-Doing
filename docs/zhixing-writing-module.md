# 知行写作沉淀模块

版本：v0.1（2026-08-31）

本文记录当前已经实现的“实践 -> 素材 -> 大纲 -> 文章 -> 审查 -> 知乎预览”闭环。模块只处理一次 `PracticeRun` 的工程实践复盘，不替代 Tutor、MySQL Lab 或知乎 OAuth。

## 1. 产品边界

写作模块的输入是实践过程中产生的不可变记录：用户判断、Tutor 回复、SQL、EXPLAIN、基准、结果集、错误、事件路径和带来源的外部素材。它不重新执行 SQL，也不根据聊天内容把实践标记为已解决。

当前交付内容：

- 从实践快照归集素材，并允许用户选择进入本次文章的素材快照；
- 生成固定文章类型 `engineering_practice_review` 的 11 节工程复盘大纲；
- 从当前大纲生成可编辑文章初稿；
- 以实践状态、待补内容、断言证据和隐私风险进行发布前审查；
- 审查通过后开放只读的知乎风格预览和 Markdown 复制；
- 以 `revision` 乐观锁保护多标签页编辑，不提供自动覆盖。

暂不实现：真实 LLM 写作 Provider、知乎检索、OAuth 登录、保存知乎草稿、自动发布、Markdown 富文本渲染和独立的断言编辑器。当前生成器是证据模板，明确记录 `generationMethod=evidence_template`，不能对外宣称为模型创作结果。

## 2. 数据流

```text
PracticeRun
  -> PracticeSnapshot
     -> Artifact / PracticeEvent / PathNode / SourceItem
  -> WritingProject
     -> WritingMaterial 选择
  -> evidenceSnapshot
  -> WritingDocument(kind=outline)
  -> WritingDocument(kind=article)
  -> WritingReviewItem
  -> ready_for_preview
  -> 只读知乎预览 / 复制 Markdown
```

`Artifact`、`PracticeEvent`、`PathNode` 和 `SourceItem` 是实践层事实，写作层只保存引用，不修改原记录。`WritingMaterial` 是写作选择层；取消选择只影响之后生成的文档，不删除原始实践数据。

同一实践只能有一个 `WritingProject`。同一 project 的 outline 和 article 都可以产生多个版本，Repository 返回每个 `kind` 最新的 `revision`。旧文档保留在数据库中，便于后续审计；章节编辑会更新当前文档版本号并将文章重新置为 `needs_review`。

## 3. 状态流转

```text
materials_ready
      |
      v
outline_review --编辑大纲--> outline_review
      |
      v
article_review --编辑文章/重新审查--> article_review
      |
      v
ready_for_preview
```

状态含义：

| 状态 | 进入条件 | 页面行为 |
| --- | --- | --- |
| `materials_ready` | 初始化工程或修改素材选择 | 可以重新生成大纲 |
| `outline_review` | 生成大纲或编辑大纲章节 | 展示 11 节可编辑大纲 |
| `article_review` | 生成文章但仍有阻断项，或编辑文章 | 展示文章和审查问题 |
| `ready_for_preview` | 实践已 `resolved`，且无阻断项 | 开放预览和复制 |

大纲可以在生成后直接生成文章；“确认”通过用户逐节保存表达，而不是额外引入一个不可逆的确认按钮。这样既保留人工整理空间，也不会把演示流程锁死在单一路径上。

实践是否解决仍由实践层的 Lab 验证决定。写作审查只读取 `PracticeRun.status`，不会把文章编辑、模型输出或知乎来源当成解决证据。

## 4. 文章结构与证据规则

固定文章骨架如下：

1. 问题背景
2. 现象与线索
3. 我的初始判断
4. 证据与排查
5. 尝试与判断转折
6. 最终方案
7. 结果验证
8. 原理与可迁移方法
9. 适用边界与代价
10. 可复现步骤
11. 来源与证据索引

每个章节保存 `evidenceRefs` 和 `sourceRefs`。文章断言保存 `kind`、`status`、实验引用和来源引用：

- `supported`：当前断言有可追溯证据；
- `needs_review`：章节被改动，需要人工重新确认；
- `unsupported`：不能发布为事实结论，并形成阻断审查项。

当前模板的实验事实优先来自 `verified_lab` Artifact；知乎来源仅作为 `source_verified` 的背景或原理素材，不能支撑本次实验的耗时、扫描行数或“修复成功”。搜索摘要也不能直接成为文章事实。

## 5. 审查规则

每次审查先删除当前 project 的旧 review items，再基于最新文章和实践快照重建结果：

- `practice_not_resolved`：实践状态不是 `resolved`，阻断预览；
- `section_missing_*`：必填章节为空或仍含“待补”，提醒人工完善；
- `claim_*`：断言不是 `supported`，`unsupported` 阻断，`needs_review` 提醒确认；
- `privacy_*`：选中素材或其完整 Artifact 内容疑似包含密码、密钥、数据库连接串或 Bearer 凭证，阻断预览。

审查通过的定义是“没有 blocking 项”，warning 仍需人工阅读。当前审查没有自动修改用户文章，也没有提供忽略阻断项的接口。

## 6. HTTP 接口

所有接口使用 `X-Learner-Id` 的匿名 learner 范围，默认值为 `anonymous-web`。认证接入后，需要把 learner 解析迁移到认证上下文，而不是由客户端自由指定。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/product/practice-runs/:runId/writing` | 初始化或恢复写作工程并归集新素材 |
| `GET` | `/api/product/practice-runs/:runId/writing` | 读取当前写作工程 |
| `PATCH` | `/api/product/practice-runs/:runId/writing/materials/:materialId` | 选择/取消素材，可附编辑备注 |
| `POST` | `/api/product/practice-runs/:runId/writing/outline` | 生成新版本大纲 |
| `POST` | `/api/product/practice-runs/:runId/writing/article` | 基于最新大纲生成新版本文章 |
| `POST` | `/api/product/practice-runs/:runId/writing/review` | 重建发布前检查结果 |
| `PATCH` | `/api/product/practice-runs/:runId/writing/documents/:documentId/sections/:sectionId` | 按 revision 保存一节内容 |

错误约定：资源不存在返回 `404`，文档 revision 过期返回 `409 writing_conflict`，请求字段错误返回 `400`。章节保存同时校验 run 对应的 project、document 和 section，避免拿到其他实践的随机 ID 后越权更新。

## 7. 前端页面与请求边界

写作路由拆成五个地址，由同一个 `WritingView` 按当前路由展示一个工作区模块：

- `/writing/materials`：素材选择；进入时初始化一次；
- `/writing/outline`：大纲生成与逐节保存；
- `/writing/article`：文章逐节编辑；
- `/writing/review`：审查结果；点击操作才重新审查；
- `/writing/preview`：只读预览与 Markdown 复制。

请求集中在 `productService`，状态集中在 Pinia `writing` store，组件只发出用户操作事件。页面不会预取五个阶段的全部接口；刷新时使用 localStorage 中的 active practice id 恢复工程。数据库凭据不进入浏览器。

## 8. 并发、性能与恢复

- 章节保存使用 `UPDATE ... WHERE id = ? AND project_id = ? AND revision = ?`，同一章节的并发保存只有一个成功；另一个得到 `409`。
- Repository 的章节、断言读取是按当前 project 的最新文档批量查询，避免逐文档 N+1。
- 素材、文档和审查项均带 project 过滤和对应索引；当前响应返回单个实践的完整数据，适合 MVP 的实践规模。
- 当前没有跨 project 列表接口，不会把所有 learner 的文章或素材全量加载；正式规模化时应为素材和 review items 增加分页/按阶段读取。
- 生成大纲和文章是同步模板生成，失败会返回错误，不产生“成功但内容为空”的假结果。后续接入 LLM 时应增加生成任务、幂等键和 Provider 降级状态。
- 原始实践记录不可变，文章版本和 review items 可审计；预览不调用知乎写接口。

## 9. 验证清单

已覆盖：

- 素材归集包含 Lab Artifact 和带 `sourceRefs` 的知乎来源；
- 生成 11 节大纲和文章初稿；
- 未解决实践形成 blocking 审查项；
- 章节 revision 冲突；
- 跨 project 文档/章节更新被拒绝；
- 读取完整 Artifact 检出摘要截断后的隐私字段；
- 后端单元测试、TypeScript build、前端 typecheck 和 production build。

后续补充：HTTP route 集成测试、多标签页浏览器回归、文章 claim 独立编辑、证据删除后的审查回退、真实 LLM Provider、知乎 OAuth 草稿接口和 replay 模式。
