# 知行 Tutor Runtime 实现说明

版本：v0.1（2026-08-28）

本文记录当前代码已经落地的 Tutor 与实践记录边界。知乎检索 Provider、OAuth 和 CLI 自动采集仍是预留接口，不把未接入能力描述为已完成。

## 数据流

```text
学习目标
  -> Intake
  -> 本地案例目录生成 LearningPlan
  -> PracticeRun
  -> 用户消息 / Lab 执行 / 外部粘贴
  -> 不可变 Artifact + PracticeEvent
  -> Coach 规则判断阶段
  -> Tutor 根据当前上下文回应
  -> PathNode / StageMemory / MemoryItem
  -> Note outline / Article draft
```

产品状态存在独立 SQLite；MySQL 只承载受控实验数据。Tutor、Planner 和笔记生成器不直接访问 MySQL，而是只通过 PracticeService 读取快照或调用既有 Lab Scheduler。

## 上下文压缩

每次 Tutor 请求通过 `buildTutorContext` 构建索引式上下文：

- `hot`：目标、案例、当前阶段、最新错误和当前缺口，始终保留；
- `rawEvidence`：最近的 SQL、EXPLAIN、结果集、基准、错误和外部粘贴，原文保留；
- `recentEvents`：最近 12 个事件，用于理解当前动作顺序；
- `path`：最近 8 个 PathNode，保留有意义的判断变化；
- `stageMemory`：每个阶段的精确状态和版本；
- `availableSourceIds`：允许模型引用的来源白名单，模型返回未知 ID 会被过滤。

旧消息不会覆盖原始 Artifact。长期能力只从有证据引用的实践中提升为 `MemoryItem`，用户可以读取、修正或删除它。

## 阶段与权限

阶段为 `observe -> hypothesize -> inspect -> attempt -> verify -> resolved`。聊天只能记录输入和 Tutor 回复，不能直接推进阶段；Lab 原始输出和规则验证才可以产生阶段转换事件。外部粘贴默认是 `external_unverified`，不能单独支持“已解决”。

Tutor 可以解释、追问、建议下一步和引用已知来源；不能执行 SQL、修改实践状态、伪造实验结果或生成不存在的知乎引用。模型超时、非法 JSON 或接口错误统一降级为脚本 Tutor，且明确标识 `provider=scripted`、`sourceStatus=general_model_knowledge`。

## 关键接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/product/intakes` | 创建学习目标 |
| `POST /api/product/intakes/:id/plan` | 生成首版微路线 |
| `POST /api/product/plans/:id/confirm` | 确认路线 |
| `POST /api/product/practice-runs` | 创建实践并申请 Lab run |
| `GET /api/product/practice-runs/:id` | 恢复实践快照 |
| `POST /api/product/practice-runs/:id/messages` | 记录用户消息并获取 Tutor 结构化回答 |
| `POST /api/product/practice-runs/:id/lab-executions` | 执行受控 SQL 并写入证据链 |
| `POST /api/product/practice-runs/:id/artifacts` | 保存外部粘贴 |
| `POST /api/product/practice-runs/:id/verify` | 按证据条件检查是否可解决 |
| `POST /api/product/practice-runs/:id/note-outline` | 生成可编辑复盘大纲 |
| `POST /api/product/practice-runs/:id/article-draft` | 生成待人工审核文章初稿 |
| `GET /api/product/memories` | 查看长期能力记忆 |

产品层 Lab 执行沿用底层 `clientRequestId`，并在产品层再次按请求 ID 去重。一次重试不会重复写入 SQL、证据和事件。

## 当前限制

- Planner 目前使用 MySQL 本地案例目录，尚未根据知乎收藏、简历或 OAuth 数据动态排序；
- RetrievalService 已有缓存优先和 Provider 接口，但当前服务未注入真实知乎 CLI/API Provider；
- 笔记和文章当前使用证据模板，模型生成适配和知乎发布仍未接入；
- 队列实践已能关联等待票据并在快照请求时同步 ready 状态，前端仍需补充队列票据的产品层轮询体验；
- 当前浏览器联调开放慢查询案例，死锁和深分页沿用 Lab 入口但仍标记为后续开放。
