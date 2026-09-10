# P3：知乎文章内容快照与文章驱动案例

## 目标

使“根据这篇知乎文章搭建练习”有真实的输入边界：Case Agent 读取的是一份可追溯、
冻结、受长度限制的文章内容快照，而不是目前 `SourceItem.excerpt` 的几百字摘要。

文章影响案例的概念、背景、测试场景和任务，不影响 environment template。

## 当前缺口

`source_items` 只保存标题、链接、摘要和元数据。`CaseContextCompiler` 当前最多
把摘要截到 6,000 字符，这对“把文章中的 list 示例转成练习”不足，也无法说明
模型实际使用了哪一版内容。

## 数据模型

新增 `034_case_source_snapshots.sql`：

```text
case_source_snapshots
  id, learner_id, source_item_id, provider, external_id, source_url,
  title, author, content_markdown, content_checksum, content_length,
  extraction_status, extraction_error, retrieved_at, expires_at,
  created_at

learning_cases
  source_snapshot_id NULL REFERENCES case_source_snapshots(id)
```

`content_markdown` 是经过 provider 许可与 HTML 清洗后的正文投影；不保存页面
脚本、评论区、cookie、用户 OAuth 信息或访问 token。保留标题、作者、链接和抓取
时间，以便案例页展示“基于哪篇材料构建”。

索引：

- `case_source_snapshots(learner_id, source_item_id, retrieved_at DESC)`；
- `learning_cases(source_snapshot_id)`，仅在详情关联查询确认后增加；
- 不对正文建立全量 FTS。P3 只需将单篇冻结内容输入 Case Agent。

## 抓取与冻结流程

```text
用户选中当前 learner 可见的 SourceItem
  -> 校验知识路径归属
  -> SourceSnapshotService 获取或刷新内容
  -> 规范化 Markdown、截断到模型预算、计算 checksum
  -> 创建 CaseRequest 的 input snapshot
  -> Case Agent
```

第一版只通过现有知乎开放能力或明确允许的正文端点获取内容。不能抓取任意 URL，
也不能由前端上传一段伪造的“文章正文”。获取失败时，case request 返回
`source_snapshot_unavailable` 的真实可重试错误；用户可改用 brief，但系统不会把
摘要伪装成全文。

Case 的 `input_snapshot_json` 必须保存 `sourceSnapshotId`、checksum、title、URL、
retrievedAt 和实际注入模型的裁剪范围。后续来源变更不会改变已生成案例。

## 模型上下文与引用

`CaseContextCompiler` 增加 `sourceContent` 字段。内容分段时保留稳定段落编号，
让 Intent/Blueprint 可以输出：

```ts
sourceAnchors: Array<{ snapshotId: string; segment: number; purpose: string }>
```

这些 anchors 是案例可解释性，不是用户能力证据。案例页面可在“参考材料”折叠区
显示标题、作者、链接、抓取时间和被使用段落；不得复制大段全文到案例题面。

## API 与体验

- `POST case-requests` 继续仅接收 `sourceItemId`；服务端负责 snapshot；
- job 状态可出现 `preparing_source`；
- 学习节点的来源列表按需加载，点击“基于这篇文章创建练习”才调用 snapshot；
- 已生成案例显示来源卡和外链，不把文章内容加载到总览或路线图；
- 来源快照失败不清空用户已填写 brief，也不删除原 `SourceItem`。

## 验收

- 无归属的 sourceItem、外部 URL、过长正文、非支持 provider 都被拒绝；
- 同一 learner、同一文章内容 checksum 可复用快照；内容变化创建新快照；
- Agent 输入准确引用冻结 snapshot，而不是 live source；
- case 详情能解释使用的来源但不泄漏未选文章；
- snapshot 拉取、case 创建、preflight 与重试在服务重启后有真实状态；
- SQL 读取是 case -> snapshot 的单 join 或批量 `IN`，不会按 UI 卡片 N+1。
