# 知行工程案例场景数据说明

版本：v0.1

## 1. 文档目的

本文件定义知行首批三个工程性学习案例的数据边界和种子数据：

- MySQL 慢查询与 EXPLAIN；
- Kafka 消息积压与分区排查；
- Redis 缓存一致性与并发窗口。

三个案例共用同一套学习、实践、来源和记录模型。场景之间只替换案例内容、证据类型和验证动作，不为每个技术单独创建一套页面或请求协议。

本文件中的数据分为两类：

1. **案例模板数据**：产品预置的学习目标、工程上下文、示例输入、检查点和知乎候选来源。
2. **学习运行数据**：某个用户实际提交的上下文、Tutor 对话、错误、实验结果、固定内容和笔记素材。

案例模板可以被多个用户复用；学习运行数据必须关联到具体用户、学习计划和学习单元。

## 2. 数据原则

### 2.1 原始事实与模型判断分离

用户粘贴的 SQL、日志、配置、指标和命令输出必须原样保存。模型可以生成假设、追问、计划和总结，但不能覆盖原始内容。

每条数据都必须带有以下来源信息：

| 字段 | 可选值 | 说明 |
| --- | --- | --- |
| `origin` | `scenario_seed` / `user_input` / `cli_capture` / `zhihu_search` / `tutor_derived` | 数据从哪里来 |
| `verification` | `unverified` / `source_corroborated` / `user_confirmed` / `runtime_observed` | 当前验证程度 |
| `sourceIds` | 字符串数组 | 对应知乎来源、运行记录或用户输入 |
| `capturedAt` | ISO 时间 | 采集时间，不使用“刚刚”作为持久化值 |

`scenario_seed` 中的耗时、数据量、Lag、P99 等均为演示数据，不能展示为用户真实生产指标；页面上应标注“演示数据”。

### 2.2 来源不是搜索结果列表

知乎来源进入当前学习节点时，必须说明它承担的作用：

- `principle`：解释原理和概念边界；
- `case`：提供工程现象、日志、指标或代码案例；
- `tradeoff`：呈现方案分歧、适用条件和代价；
- `practice`：提供可执行练习或验证思路；
- `noise`：主题相关性不足、模板化或无法确认，不能作为主要依据。

模型引用来源时保留标题、作者、URL、来源角色和引用片段。来源质量只影响排序和提示，不能让“高赞”自动变成事实。

### 2.3 案例必须有可验证闭环

每个案例至少包含：

```text
工程背景
 -> 初始症状
 -> 可观察证据
 -> 学习者假设
 -> Tutor 追问
 -> 知乎来源编排
 -> 修复或方案选择
 -> 再次验证
 -> 学习证据与笔记素材
```

没有“再次验证”动作的内容只能作为阅读单元，不能作为首批工程案例。

## 3. 统一数据模型

### 3.1 `EngineeringScenario`

描述一个技术领域的案例集合。

```ts
interface EngineeringScenario {
  id: string
  technology: 'mysql' | 'kafka' | 'redis'
  title: string
  positioning: string
  entrySignals: string[]
  prerequisites: string[]
  caseIds: string[]
  sourceQueryTemplates: string[]
}
```

### 3.2 `EngineeringCase`

描述一次可以被演示和验证的工程问题。

```ts
interface EngineeringCase {
  id: string
  scenarioId: string
  title: string
  version: string
  dataMode: 'synthetic_demo' | 'source_derived' | 'user_context'
  businessContext: string
  learnerGoal: string
  initialContext: ContextArtifact[]
  evidence: EvidenceArtifact[]
  hypotheses: Hypothesis[]
  intendedRootCause: string
  candidateSolutions: SolutionOption[]
  verificationPlan: VerificationStep[]
  learningNodes: CaseLearningNode[]
  sourceIds: string[]
}
```

### 3.3 `ContextArtifact` 与 `EvidenceArtifact`

二者都保存原始内容，但语义不同：上下文描述用户带来的环境，证据用于支持或否定某个判断。

```ts
interface ContextArtifact {
  id: string
  kind: 'sql' | 'schema' | 'config' | 'log' | 'metric' | 'timeline' | 'requirement'
  label: string
  content: string
  format?: 'text' | 'sql' | 'yaml' | 'json' | 'table'
  origin: DataOrigin
  verification: VerificationState
}

interface EvidenceArtifact extends ContextArtifact {
  supports?: string[]
  contradicts?: string[]
  observedAt?: string
}
```

### 3.4 学习、实践与来源数据

```ts
interface CaseLearningNode {
  id: string
  title: string
  objective: string
  checkpoint: Checkpoint
  practiceAction: string
  evidenceRequired: string[]
  sourceIds: string[]
}

interface Checkpoint {
  type: 'predict' | 'explain' | 'choose' | 'modify' | 'compare'
  prompt: string
  expectedEvidence: string[]
}

interface SourceReference {
  id: string
  provider: 'zhihu'
  contentType: 'answer' | 'article'
  title: string
  author: string
  url: string
  role: 'principle' | 'case' | 'tradeoff' | 'practice' | 'noise'
  excerpt: string
  qualityNote: string
  capturedAt: string
}

interface PracticeRun {
  id: string
  caseId: string
  unitId: string
  status: 'started' | 'needs_input' | 'verified' | 'abandoned'
  inputArtifactIds: string[]
  hypothesis?: string
  action?: string
  outputArtifactIds: string[]
  result?: 'supports' | 'contradicts' | 'inconclusive'
  startedAt: string
  completedAt?: string
}

interface NoteMaterial {
  id: string
  kind: 'source' | 'question' | 'error' | 'observation' | 'evidence' | 'decision'
  content: string
  sourceIds: string[]
  practiceRunId?: string
  editable: boolean
}
```

## 4. 场景一：MySQL 慢查询与 EXPLAIN

### 4.1 场景定位

- `id`：`mysql-slow-query`
- 目标：从一条“索引已经建了但仍然慢”的 SQL 出发，学习者能够用 EXPLAIN 解释原因，并用前后对比证明修改有效。
- 工程价值：输入、解释、修改和验证都可以在本地 MySQL 或受控演示数据库中完成，反馈最直接。
- 首个学习单元：识别“函数包裹索引列”导致的范围条件失效。

### 4.2 工程案例

- `caseId`：`mysql-date-function-index-001`
- `dataMode`：`synthetic_demo`
- 业务背景：运营后台按日期查询订单列表，订单表约 500 万行。
- 初始症状：查询一个自然日的订单耗时明显高于预期。
- 关键约束：输出结果必须保持按创建时间倒序，不能通过删除筛选条件解决问题。

示例表结构：

```sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL,
  total_amount DECIMAL(12, 2) NOT NULL,
  KEY idx_orders_created_at (created_at)
);
```

问题 SQL：

```sql
SELECT id, user_id, status, total_amount, created_at
FROM orders
WHERE DATE(created_at) = '2026-08-01'
ORDER BY created_at DESC
LIMIT 20;
```

演示用初始证据：

| 字段 | 值 | 来源 |
| --- | --- | --- |
| `type` | `ALL` | `scenario_seed` |
| `key` | `NULL` | `scenario_seed` |
| `rows` | `5000000` | `scenario_seed` |
| `Extra` | `Using where; Using filesort` | `scenario_seed` |
| 预计耗时 | `3.2 s` | `scenario_seed` |

预设根因：`DATE(created_at)` 对索引列做函数计算，使优化器无法按日期范围直接定位。

推荐修复：

```sql
SELECT id, user_id, status, total_amount, created_at
FROM orders
WHERE created_at >= '2026-08-01 00:00:00'
  AND created_at < '2026-08-02 00:00:00'
ORDER BY created_at DESC
LIMIT 20;
```

验证要求：重新执行 `EXPLAIN`，记录 `type`、`key`、`rows`、`Extra` 和实际耗时；不能只提交“加了索引”的文字结论。

### 4.3 学习节点

| 节点 | 检查点 | 必须产出 |
| --- | --- | --- |
| 读 EXPLAIN | 预测 `type`、`key`、`rows` 的含义 | 一句完整判断 |
| 找根因 | 指出是哪一部分阻断索引范围 | 标注问题 SQL |
| 改写 SQL | 保持查询语义不变 | 修改后的 SQL |
| 验证结果 | 对比修改前后计划和耗时 | EXPLAIN 差异记录 |

### 4.4 知乎候选来源

| 来源 | 角色 | 说明 |
| --- | --- | --- |
| [MySQL 慢查询优化案例](https://zhuanlan.zhihu.com/p/2032748459783086251) | `principle` + `practice` | 提供 EXPLAIN 字段和函数、LIKE、OR 等对比案例 |
| [MySQL 索引明明建了，查询还是慢](https://zhuanlan.zhihu.com/p/1984583329639596230) | `case` | 提供隐式类型转换和 `key=NULL` 的案例 |
| [EXPLAIN 实战拆解索引失效场景](https://zhuanlan.zhihu.com/p/2067668610592531388) | `tradeoff` | 强调索引可用不等于优化器一定选择，需结合成本和数据分布 |

## 5. 场景二：Kafka 消息积压与分区排查

### 5.1 场景定位

- `id`：`kafka-consumer-lag`
- 目标：学习者不能只看到总 Lag 就扩容，而要区分全局积压、单分区热点、Rebalance 和下游处理慢。
- 工程价值：能把监控指标、消费者日志、分区分布和配置关联起来。
- 首个学习单元：从分区级 Lag 判断“增加消费者是否有用”。

### 5.2 工程案例

- `caseId`：`kafka-hot-partition-001`
- `dataMode`：`source_derived`
- 业务背景：订单事件由消费者组 `order-sync` 写入下游服务。
- 初始症状：总 Lag 快速增长，但不是所有分区都异常。

演示用分区证据：

| 分区 | Lag | 单条处理 P95 | 来源 |
| --- | ---: | ---: | --- |
| `partition-0` | `120000` | `820 ms` | `source_derived`，演示补充指标为 `scenario_seed` |
| `partition-1` | `800` | `90 ms` | `source_derived`，演示补充指标为 `scenario_seed` |
| `partition-2` | `760` | `95 ms` | `source_derived`，演示补充指标为 `scenario_seed` |
| `partition-3` | `910` | `88 ms` | `source_derived`，演示补充指标为 `scenario_seed` |

预设根因：生产者使用商户 ID 作为分区键，单个大商户形成热点，导致一个分区持续处理不过来；同一分区内无法通过增加消费者并行消费。

需要保留的分支判断：

- 所有分区 Lag 同时上涨：优先检查生产速率、消费者总吞吐、下游依赖和消费者是否存活；
- 单分区 Lag 异常：检查分区键分布、热点业务 ID、单条消息处理耗时；
- 消费者频繁加入或退出：检查 Rebalance、心跳、`max.poll.interval.ms` 和实例重启；
- 分区数小于消费者数：增加消费者不能突破分区并行度上限。

候选方案：

1. 短期：降低单条消息处理耗时，隔离慢消息，控制生产速率。
2. 中期：重新评估分区键；若不要求同一商户严格有序，可使用更均匀的业务键。
3. 长期：将慢下游调用异步化，并增加分区维度监控和回放能力。

### 5.3 学习节点

| 节点 | 检查点 | 必须产出 |
| --- | --- | --- |
| 读 Lag | 判断整体还是局部积压 | 分区级判断表 |
| 读消费者状态 | 识别 Rebalance 或处理阻塞 | 日志证据和假设 |
| 选修复方向 | 说明扩容为什么可能无效 | 方案取舍记录 |
| 验证方案 | 对比各分区 Lag 和消费速率 | 调整后的指标记录 |

### 5.4 知乎候选来源

| 来源 | 角色 | 说明 |
| --- | --- | --- |
| [一次 Kafka 消费积压排查：从单分区 Lag 定位到下游调用瓶颈](https://zhuanlan.zhihu.com/p/2041141211294131174) | `case` + `practice` | 提供单分区异常、假设和验证路径 |
| [Kafka 消息积压、重复、丢失与 Rebalance](https://zhuanlan.zhihu.com/p/2063627552636269665) | `principle` | 提供消费者变更、心跳和轮询超时等 Rebalance 触发条件 |
| [大数据相关](https://zhuanlan.zhihu.com/p/1963557524335755365) | `noise` | 检索结果相关性不足，不能作为主来源，只记录为过滤样本 |

## 6. 场景三：Redis 缓存一致性与并发窗口

### 6.1 场景定位

- `id`：`redis-cache-consistency`
- 目标：学习者能够定义“不一致”的可接受范围，画出并发时序，并根据业务约束选择缓存失效、重试、版本或 CDC 方案。
- 工程价值：最能体现知乎内容中的方案争议，但必须通过时序和压测证据避免退化成背诵“延迟双删”。
- 首个学习单元：解释为什么“删两次”不能天然保证强一致。

### 6.2 工程案例

- `caseId`：`redis-stale-cache-after-write-001`
- `dataMode`：`synthetic_demo`
- 业务背景：商品详情页使用 MySQL 保存价格，Redis 保存热点详情。
- 初始症状：用户修改价格后，部分读取在短时间内仍看到旧价格。
- 业务约束：商品详情允许秒级最终一致；权限、余额和库存扣减不能依赖过期缓存做最终判断。

演示时序：

```text
T1  Writer 提交 MySQL: price = 200
T2  Writer 删除 Redis: product:42
T3  Reader 从延迟副本读到旧值: price = 100
T4  Reader 回填 Redis: product:42 = 100
T5  后续请求继续命中旧缓存
```

演示用证据：

| 证据 | 值 | 来源 |
| --- | --- | --- |
| MySQL 主库价格 | `200` | `scenario_seed` |
| Redis 当前价格 | `100` | `scenario_seed` |
| 旧值持续时间 P99 | `3.2 s` | `scenario_seed` |
| 删除失败率 | `0.4%` | `scenario_seed` |
| 是否允许强一致 | `否，商品详情允许秒级最终一致` | `scenario_seed` |

预设根因：缓存删除和回填之间存在并发窗口，且读路径使用了存在同步延迟的副本；延迟双删的等待时间不能脱离实际读耗时、复制延迟和失败重试机制单独决定。

候选方案及适用条件：

| 方案 | 适用条件 | 主要代价 |
| --- | --- | --- |
| 提交数据库后删除缓存 + TTL | 读多写少、允许短暂旧值 | 删除失败需要可靠重试 |
| 延迟删除 + 持久化消息 | 可接受秒级最终一致 | 延迟窗口需要压测，仍需失败兜底 |
| Binlog / CDC 驱动失效 | 写入口多、希望统一收敛 | 基础设施和运维成本更高 |
| 版本号或时间戳校验 | 需要识别旧值，不能接受乱序覆盖 | 读写协议和缓存结构更复杂 |

MVP 的目标不是宣布某个方案“永远正确”，而是要求学习者完成：定义一致性目标、画出竞态时序、选择方案并说明代价。

### 6.3 学习节点

| 节点 | 检查点 | 必须产出 |
| --- | --- | --- |
| 定义问题 | 区分强一致、读后写一致和最终一致 | 业务约束表 |
| 画时序 | 找出旧值回填窗口 | 并发时序图或文字记录 |
| 方案比较 | 解释延迟双删、重试、CDC 的差异 | 方案决策记录 |
| 验证边界 | 设计并发测试和失败注入 | 测试结果与残余风险 |

### 6.4 知乎候选来源

| 来源 | 角色 | 说明 |
| --- | --- | --- |
| [Redis 和 MySQL 如何保证数据一致性](https://zhuanlan.zhihu.com/p/2068054950953981177) | `tradeoff` | 强调先定义可接受的旧值窗口，再选择 Cache-Aside、重试或 CDC |
| [延迟双删策略解决 Redis 缓存一致性](https://zhuanlan.zhihu.com/p/2067023170528339812) | `case` + `practice` | 提供并发窗口、延迟时间和失败重试的讨论 |
| [Redis 在使用中会遇到哪些坑](https://www.zhihu.com/question/57045322/answer/2073364071433376620) | `principle` | 提供缓存、BigKey、HotKey 和监控指标的经验集合 |

## 7. 三个场景的统一运行数据

### 7.1 学习计划层

三个场景可以作为同一份“后端工程问题诊断”学习计划下的三个可选实践分支：

| 阶段 | 目标 | 场景映射 |
| --- | --- | --- |
| 1. 读工程证据 | 从现象中提取可验证信息 | 三个场景都适用 |
| 2. 建立问题模型 | 把症状映射到机制和边界 | EXPLAIN / Lag / 时序 |
| 3. 做最小修复 | 修改 SQL、配置、分区策略或缓存协议 | 每个案例各自实践 |
| 4. 验证与复盘 | 对比前后证据，记录残余风险 | 三个场景都适用 |

### 7.2 实践事件类型

统一沿用现有 `PracticeEvent`，补充结构化字段：

| 事件类型 | 示例 | 是否保留原文 |
| --- | --- | --- |
| `reference` | 固定一条知乎来源 | 是 |
| `question` | Tutor 追问“为什么增加消费者可能无效？” | 是 |
| `error` | SQL 改写后结果集不一致 | 是 |
| `observation` | EXPLAIN 的 `rows` 从 5000000 变为 120000 | 是 |
| `evidence` | 用户提交最终判断和验证结果 | 是 |
| `decision` | 选择 CDC 而不是延迟双删，并记录理由 | 是 |

事件只追加，不通过模型总结覆盖原始事件。笔记大纲和文章正文是后续派生数据。

## 8. 前端按需读取边界

为了避免一个页面一次性请求全部数据，后续 API 或 mock store 按以下边界组织：

| 页面/动作 | 首次读取 | 延迟读取 |
| --- | --- | --- |
| 场景选择 | 场景摘要、案例标题、学习目标 | 不读取来源正文和全部证据 |
| 学习单元 | 当前案例、当前节点、首批来源摘要 | 来源详情、完整案例上下文 |
| Tutor Agent | 当前节点上下文、最近对话 | 用户发送问题后才检索知乎和生成回答 |
| 实践记录 | 当前案例的事件摘要和分页游标 | 点击筛选后加载原始日志、SQL 或指标 |
| 学习笔记 | 事件列表和当前大纲 | 生成文章时按需加载关联素材 |
| 复盘 | 统计结果、掌握变化、验证状态 | 点击某个指标后加载证据详情 |

建议的资源边界：

```text
GET /api/scenarios
GET /api/scenarios/:scenarioId/cases
GET /api/cases/:caseId/units/:unitId
GET /api/cases/:caseId/sources?unitId=...
GET /api/practice-runs/:runId/events?cursor=...
POST /api/practice-runs/:runId/events
GET /api/notes?planId=...
```

知乎正文、模型回答和实践原始输出都不应由总览页预加载。

## 9. 三个演示的共同验收标准

每个场景必须完成以下步骤，才算接入知行：

1. 用户能看到明确的工程背景和当前症状；
2. 用户能提交或修改至少一份上下文；
3. Tutor Agent 至少提出一个基于证据的追问；
4. 至少展示一条知乎来源，并说明其在当前节点中的作用；
5. 用户能提交假设或方案，而不是只点击“看答案”；
6. 系统能记录一次错误、观察或验证结果；
7. 系统能生成一个带来源的笔记大纲；
8. 页面明确区分演示数据、用户输入、知乎来源和运行时观察。

首批实现顺序：MySQL 完整接入，Kafka 接入同一套模型，Redis 接入方案比较和时序验证。不要先为三个场景分别制作页面。
