# 知行阶段 0 数据采集清单

版本：v0.1

本文档记录 MySQL 慢查询案例在进入实现前需要准备的数据，以及本次通过知乎 CLI 实际获得的原始结果。本文档不是知识结论：知乎搜索摘要不等于全文，摘要中的指标、建议和排序分数都必须经过本地实验或官方文档核验。

## 1. 采集边界

阶段 0 只准备以下四类数据：

| 数据域 | 用途 | 当前状态 | 来源边界 |
| --- | --- | --- | --- |
| 案例事实 | 固定演示背景、SQL、约束和阶段 | 已有初稿 | 产品案例规格；后续用 Docker 实验核验 |
| 知乎参考 | 为 Tutor 提供原理、案例、权衡和实践线索 | 2 组成功，2 组限流 | 只保留标题、作者、URL、摘要和原始元数据 |
| 实践证据 | 形成前后 EXPLAIN、耗时和结果集对比 | 待阶段 2 | 本地 MySQL Lab；不连接真实业务库 |
| 演示素材 | 支撑三分钟 Demo 的关键画面和兜底数据 | 待补 | 固定回放数据、截图、讲稿 |

## 2. 案例事实数据

案例 ID：`mysql-order-list-index-001`

需要冻结的字段：

| 字段 | 当前值或要求 | 状态 |
| --- | --- | --- |
| 工程症状 | 订单列表查询在高峰期 p99 升高 | 待用实验数据补充数值；不能伪装成生产事实 |
| 查询约束 | 保持用户、状态、自然日筛选，按创建时间倒序，返回语义不变 | 已写入案例规格 |
| 问题 SQL | `DATE(created_at)` 包裹时间列，已有 `user_id` 单列索引 | 已写入案例规格 |
| 候选修复 | 左闭右开时间范围 + `(user_id, status, created_at)` 联合索引 | 候选方案，待 EXPLAIN 和基准验证 |
| 预置不充分尝试 | Demo 回放可创建 `(user_id, status, created_at)` 联合索引，但保留 `DATE(created_at)` 条件；以 Lab 证据判断局限 | 已冻结回放素材，待采集 EXPLAIN 与基准；不限制真实用户路径 |
| 通过条件 | 结果集语义一致，扫描成本下降，结论能关联证据 | 已定义规则，阈值待实验校准 |
| 环境标签 | MySQL 8、固定种子、Docker 本地环境 | 环境待建立 |

原始 SQL、DDL、阶段状态机和提示阶梯以 [zhixing-mysql-case-spec.md](zhixing-mysql-case-spec.md) 为准，不在此重复维护。

## 3. 知乎检索记录

### 3.1 检索批次

CLI：`zhihu-cli 0.5.0`；凭证来源：系统密钥链；检索日期：2026-08-28。

| 查询 | 数量 | 返回状态 | 处理 |
| --- | ---: | --- | --- |
| `MySQL 慢查询 EXPLAIN 实战` | 5 | `Code 30001`，rate limit exceeded | 不重试，待额度/频率恢复后补采 |
| `MySQL DATE(created_at) 索引 慢查询` | 5 | `Code 30001`，rate limit exceeded | 不重试，待额度/频率恢复后补采 |
| `MySQL 联合索引 等值 范围 ORDER BY` | 5 | `Code 0`，success；`SearchHashId=09e8b2d78916fe31caa1b06c7fc99861` | 已保留下方候选记录 |
| `MySQL EXPLAIN key rows Extra 优化` | 5 | `Code 0`，success；`SearchHashId=c97956234f6db6bbc3c8bd6932b04897` | 已保留下方候选记录 |

搜索结果中的 `RankingScore`、`VoteUpCount`、评论数量只表示平台返回的元数据，不表示技术结论正确性，也不作为推荐排序的唯一依据。

### 3.2 原始来源候选

下表保留 CLI 返回的原始身份字段和摘要片段。`ContentText` 是搜索摘要，不是完整文章；“初始角色”是知行的编排标签，不是知乎对内容的认证。

| 初始角色 | `source_id` / ContentID | 标题 | 作者 | 类型 | 关键原始摘要片段 | URL |
| --- | --- | --- | --- | --- | --- | --- |
| `case` | `-3388454421707065768` | MySQL慢查询优化实战:从10秒到0.05秒的优化之路 | 花宝宝 | Article | 摘要出现联合索引、覆盖索引、分页优化，以及 `10.23s`、`0.05s` 等待核验指标 | https://zhuanlan.zhihu.com/p/1978132644773524692?utm_medium=openapi_platform&utm_source=35d20b4 |
| `case` | `7902149860543294022` | 【吃透 MySQL InnoDB连载】第 8 章・高阶 SQL 性能调优实战 | 少时登高 | Article | 摘要展示 `Using temporary`、`Using filesort` 与联合索引顺序的案例说明 | https://zhuanlan.zhihu.com/p/2052389374323700807?utm_medium=openapi_platform&utm_source=35d20b4 |
| `principle` | `5218448306266044695` | MySQL数据库——索引介绍 | 编程Cookbook | Article | 摘要介绍 B+Tree、等值/范围查询、排序和联合索引 | https://zhuanlan.zhihu.com/p/27310432304?utm_medium=openapi_platform&utm_source=35d20b4 |
| `tradeoff` | `8913618006853438416` | mysql索引如何优化? | 花宝宝 | Answer | 摘要讨论联合索引最左前缀、范围条件对后续列的影响和覆盖索引 | https://www.zhihu.com/question/1933453169138045378/answer/1991174746457526769?utm_medium=openapi_platform&utm_source=35d20b4 |
| `principle` | `-4302816227596022038` | MySQL EXPLAIN 执行计划深度解析:SQL 优化必看的完全指南 | 程志伟 | Article | 摘要列出 `type`、`key`、`rows`、`Extra` 和 `EXPLAIN ANALYZE` 等字段 | https://zhuanlan.zhihu.com/p/2073791008224163448?utm_medium=openapi_platform&utm_source=35d20b4 |
| `practice` | `5870567501240899577` | 这些技巧让SQL性能提升10倍! | 苏三说技术 | Article | 摘要以 EXPLAIN、`type`、`key`、`rows`、`Extra` 组织排查步骤，并提到统计信息 | https://zhuanlan.zhihu.com/p/2065477801042523744?utm_medium=openapi_platform&utm_source=35d20b4 |
| `principle` | `-9190197071631679180` | MySQL性能优化有哪些办法? | 小筱在线 | Answer | 摘要描述全表扫描、索引命中和 `possible_keys` 与 `key` 的对照 | https://www.zhihu.com/question/362895379/answer/2045896221043308303?utm_medium=openapi_platform&utm_source=35d20b4 |

### 3.3 进入产品前的核验字段

每条最终引用至少补齐：

- `source_id`：知乎 `ContentID`，不能只用标题作为主键；
- `query`、采集时间、`SearchHashId`：保留检索 provenance；
- 标题、作者、`ContentType`、URL、摘要原文；
- 当前作用：`principle`、`case`、`tradeoff` 或 `practice`；
- 当前学习阶段和“为什么现在读它”；
- 引用片段是否支持当前问题；
- 是否已打开原文并由本地实验验证；
- 是否允许进入文章草稿，避免把搜索摘要直接改写成用户观点。

以下内容暂时不能作为已验证事实：摘要中的“提升倍数”、预计扫描行数、`type` 的绝对优劣排序、单个索引方案对所有数据分布的适用性。

## 4. 实践证据采集表

阶段 0 先定义字段，阶段 2 再填真实值。没有实验结果时保留空值，不填演示数字。

| 证据 ID | 证据类型 | 必填原文 | 最小结构化字段 | 来源状态 |
| --- | --- | --- | --- | --- |
| `symptom-baseline` | 症状 | 慢日志或固定演示说明 | 时间窗口、p95/p99、环境标签 | 待确定是合成还是实测 |
| `sql-original` | SQL | 原始 SQL | SQL 版本、语义约束 | 已有固定 SQL |
| `explain-original` | EXPLAIN | 完整命令输出 | `type`、`key`、`rows`、`Extra` | 待 MySQL Lab |
| `attempt-incomplete` | 失败尝试 | 修改 SQL/DDL 和第二次 EXPLAIN | 修改内容、操作者说明、局限 | 待设计 |
| `explain-final` | 最终 EXPLAIN | 完整命令输出 | 同上，关联前一份 EXPLAIN | 待 MySQL Lab |
| `benchmark-before-after` | 基准 | 命令和完整输出 | 耗时、样本数、环境、结果集校验 | 待 MySQL Lab |
| `conclusion` | 结论 | 用户确认的总结 | 支撑证据 ID、残余风险 | 不允许由 Tutor 单独生成 |

## 5. 演示素材采集表

| 关键帧 | 页面数据 | 必须展示 | 兜底材料 |
| --- | --- | --- | --- |
| 1. 症状 | 案例事实 | 背景、约束、问题 SQL | 固定案例快照 |
| 2. 提出假设 | 用户输入 | 用户先回答，Tutor 追问如何证明 | 预置追问 |
| 3. 初始证据 | EXPLAIN 原文 | 证据卡和可展开原文 | 固定 EXPLAIN |
| 4. 失败尝试 | 修改事件 | 系统记录不充分原因 | 预置失败事件 |
| 5. 修复对比 | 前后 EXPLAIN/基准 | 语义、扫描成本、耗时和残余风险 | 回放证据链 |
| 6. 文章预览 | 事件与来源 | 证据引用、知乎来源、人工确认状态 | 固定文章草稿 |

## 6. 下一次采集顺序

1. 频率限制恢复后，只补两个失败查询，优先确认 `DATE(created_at)` 与慢查询场景的相关来源。
2. 不再扩大搜索结果数量，先打开候选来源并筛选每个角色 1 至 2 条。
3. 建立 MySQL Docker Lab，采集原始 SQL、三份 EXPLAIN、基准和结果集一致性证据。
4. 用同一批证据填充六个演示关键帧，给每个数字加 `scenario_seed`、`user_input` 或 `cli_capture` 来源标记。
5. 阶段 0 评审只检查数据是否齐全、来源是否可追溯、事实和推断是否分开，不提前评估 UI 细节。
