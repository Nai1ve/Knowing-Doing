# P4：MySQL 动态案例物料与 Lab 适配

## 目标

将 MySQL 中“表结构、数据规模、错误索引、问题查询、观察目标”从固定 Lab case
中分离为 `ExerciseSpec` 的案例物料，使 Agent 能围绕例如“索引加错导致订单列表
慢查询”构造练习；`mysql-performance-v1` 仍只负责提供受控的 MySQL 运行环境。

这不是让 Agent 生成 Docker Compose 或连接用户数据库。

## 环境与案例的明确分工

| 对象 | 平台拥有 | Agent 可生成 |
| --- | --- | --- |
| `mysql-performance-v1` | MySQL 版本、隔离数据库、资源上限、执行白名单、清理方式 | 不可修改 |
| MySQL ExerciseSpec | 不适用 | schema seed、dataset seed 参数、fault seed、查询任务、EXPLAIN/benchmark command keys、私有修复解 |
| MySQL PracticeInstance | LabScheduler 分配的 run、lease、token、执行证据 | 不可修改 |

## MySQL 专用解释器

新增 `MySqlPerformanceInterpreter`，它是 P1 `EnvironmentInterpreter` 的实现：

```ts
type MySqlAsset =
  | { kind: 'schema'; key: string; schemaTemplateKey: string; parameters: Record<string, Scalar> }
  | { kind: 'dataset_seed'; key: string; seedProfileKey: string; parameters: { rowCount: number; distribution: string } }
  | { kind: 'fault_seed'; key: string; faultKey: 'wrong_index' | 'missing_index' | 'non_sargable_query'; parameters: Record<string, Scalar> }
  | { kind: 'fixture'; key: string; queryTemplateKey: string; parameters: Record<string, Scalar> }
```

模型可从 registry 选择 `schemaTemplateKey`、`seedProfileKey`、`faultKey`、
`queryTemplateKey` 及受限参数范围；不能输出任意 DDL/DML 字符串、任意 SQL 文件或
任何数据库连接信息。平台将这些声明物化为现有 Lab manifest 允许的操作。

初始支持能力只开放：

```text
mysql.slow-query.indexing -> mysql-performance-v1@1
```

固定 `mysql-order-list-index-001` 继续可用，作为回归样例与 fallback-free 的历史
路径；新 Agent 案例以不同 case/version 记录，绝不覆盖它。

## 生成与预检

P2 的 preflight 抽象扩展到 `mysql_lab`：

```text
临时 Lab 分配
  -> materialize schema/dataset/fault/query
  -> 执行 EXPLAIN 或 benchmark 前置验证
  -> 应用 private reference solution 的受控索引/查询修复
  -> 重复验证
  -> 保存结果并回收临时 Lab
```

案例的预期必须由可观测条件表达，例如 `EXPLAIN` 使用目标索引、rows 下降区间或
benchmark 比例。它们是案例运行契约，而不是聊天式“内容质量”评分。

Lab 的真实执行和生产数据永远隔离；动态预检不能复用 learner 正在操作的 Lab。

## 数据与 API

新增 `035_mysql_case_materialization.sql`：

- `case_materializations`：case、environment version、materialization fingerprint、
  registry version、状态与失败原因；
- `case_preflight_runs` 在 P2 表上复用 runtime kind，无需重复建表；
- 若 Lab 需要记录临时 seed 操作，新增 append-only `case_materialization_events`，
  不把动态 manifest 覆盖到全局固定 manifest。

新增案例工作台入口只在 `runtime_kind=mysql_lab` 且 case preflight `passed` 时返回。
`PracticeService` 增加显式 dispatcher：固定 case ID 才能进入旧 LabScheduler；
动态案例 UUID 由 MySQL adapter 启动，不得流入 `getManifest()` 或已有 MySQL token
校验路径。

## 验收

- 模型无法替换 MySQL 环境、输出裸 Docker/数据库连接配置或未注册的 SQL 模板；
- 典型“联合索引顺序错误”案例可以预检出错误计划，并用私有修复通过；
- 预检、学习者 Lab、固定 MySQL case 三者各自独立；
- 动态案例失败不会影响固定 Lab 的可用性；
- 数据集参数越界、错误 seed 无法物化、Lab 超时均进入真实失败状态；
- SQL 路径按 case/run 批量读取 materialization 与 artifacts，无全量扫描；
- 并发创建、预检和启动只保留一个有效的临时运行与一个 learner PracticeInstance。
