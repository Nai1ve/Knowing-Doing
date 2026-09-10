# P1：能力解析与通用 ExerciseSpec

## 目标

把当前“路线节点必须等于 `python.testing`，所有 CaseSpec 都按 Python 文件与
pytest 命令校验”的实现，改为下列可验证边界：

```text
路线节点 capability key
  -> CapabilityResolver
  -> 已开放的 EnvironmentTemplate
  -> EnvironmentInterpreter
  -> 已校验的 ExerciseSpec
```

P1 不新增环境、不调用模型、不改变用户工作区页面。它只让后续的 Python list、
MySQL 动态案例和其他环境使用同一份案例契约。

## 为什么先做这一步

当前 `compileCaseContext()` 已能从 `roadmapNode.capabilityKey` 找到环境，但
`case-schemas.ts` 与 `CaseWorkspaceService` 仍全局限制 `.py/.json/.md/.txt`
以及 Python 命令。仅在目录里添加 `python.collections.list` 会让名字看似通用，
运行时仍无法承载 MySQL 的 schema、数据集和故障物料。

## 数据与类型契约

### 能力目录

保留源码受控的目录，不创建用户可编辑的环境表。新增：

```ts
type CapabilityDefinition = {
  key: string                       // 例如 python.collections.list
  environmentKey: string
  environmentVersion: string
  availability: 'available' | 'planned'
  exerciseKinds: ExerciseKind[]
  aliases: string[]                 // 仅用于路线/主题解析，不直接信任浏览器
}

type ExerciseKind = 'code_repair' | 'concept_drill' | 'data_diagnosis'
```

P1 先保留已有 `python.testing`、`mysql.performance`、`mysql.slow-query`；P2
再启用 `python.collections.list`。解析器只返回 `available` 定义，未开放能力只能
留在知识节点，不能发起 CaseRequest。

### 通用练习规格

在 `product-types.ts` 新增 `ExerciseSpecV2`，并使 `CaseSpec` 成为过渡别名或
兼容映射，而非并存两套业务语义。

```ts
type ExerciseAsset = {
  kind: 'file' | 'fixture' | 'schema' | 'dataset_seed' | 'fault_seed'
  key: string
  content: string
  path?: string
}

type ExerciseSpecV2 = {
  specVersion: 2
  capabilityKey: string
  title: string
  scenario: string
  learningGoal: string
  difficulty: 'introductory' | 'applied' | 'advanced'
  environment: { key: string; version: string; services: string[] }
  starterAssets: ExerciseAsset[]
  tasks: Array<{
    key: string
    instruction: string
    recommendedCommandKeys: string[]
    expectedObservation: string
  }>
  verification: { commandKeys: string[]; successSignals: string[] }
  tutorContext: { concepts: string[]; likelyMisconceptions: string[]; evidenceToNotice: string[] }
}

type ReferenceSolutionV2 = {
  assets: ExerciseAsset[]
  verificationCommandKeys: string[]
}
```

命令 key 是模型侧语义，例如 `pytest_quiet`、`mysql_explain_before`；真实命令
由环境解释器映射。模型不能把 `pytest -q`、`mysql -h ...` 等可执行字符串当成
跨环境协议。

### 环境解释器

新增内部接口，不向浏览器暴露：

```ts
interface EnvironmentInterpreter {
  readonly environmentKey: string
  validateSpec(spec: ExerciseSpecV2): void
  materializeStarter(spec: ExerciseSpecV2): RuntimeMaterialization
  materializeReference(solution: ReferenceSolutionV2): RuntimeMaterialization
  resolveCommands(keys: string[]): ResolvedCommand[]
}
```

`PythonPytestInterpreter` 负责扩展名、文件数、文件大小和 pytest command key。
未来 `MySqlPerformanceInterpreter` 负责 schema、受控数据 seed、fault seed 与
SQL operation key。禁止再在 `case-schemas.ts` 中使用 Python 正则作为全局限制。

## 变更范围

1. 将 `environment-registry.ts` 的 capability 数组升级为目录和解析 API。
2. 新增 `environment-interpreters.ts`；`runtime-adapter.ts` 只执行经过解释器
   物化后的输入，不解析案例业务内容。
3. 替换 `parseCaseSpec()`、`parseCaseGenerationOutput()` 的全局 Python 校验为：
   Zod 基础结构校验 -> 环境解析 -> interpreter 语义校验。
4. `FixtureCaseBuilder` 升级为 V2 fixture，保持 `provider=fixture` 与版本标记。
5. `CaseWorkspaceService` 从 spec 读取已解析的文件和 command，而不是自行调用
   `isAllowedPythonCommand()`。
6. 扩展 `LearningCase` 映射，让 API 返回 `specVersion`、capability 和环境快照，
   但不返回 reference solution。

## 数据迁移

新增 `032_case_exercise_spec_v2.sql`：

- `learning_cases.spec_version INTEGER NOT NULL DEFAULT 1`；
- `learning_cases.preflight_status TEXT NOT NULL DEFAULT 'not_required'`，为 P2
  预留，但 P1 不改变 ready 条件；
- `learning_cases.case_spec_json` 不改名，内容在新写入中存 V2，读取端按照
  `spec_version` 解析；
- 对已有 fixture 案例只做显式 V1 兼容读取，禁止批量改写历史 JSON；
- 新索引 `(learner_id, capability_key, updated_at DESC)` 只在现有按能力列表接口
  确认使用时增加，不能为了预期功能制造冗余索引。

迁移只通过 `npm run db:migrate` 人工执行。

## API 与前端

P1 的产品 API URL 不变。请求仍使用 `roadmapNodeId`，服务端决定 capability 和
环境。响应可新增只读 `exerciseFormat: 'v1' | 'v2'` 与环境显示信息，前端不显示
环境配置，也不预取 capability catalog。

## 测试与验收

- `python.testing` 的已有 fixture 与工作区回归通过；
- 一个 V2 Python spec 能经 Python interpreter 物化为文件与 `pytest -q`；
- 对同一 spec，MySQL asset 和 Python asset 不能跨解释器通过；
- 未开放 capability、环境版本不匹配、未知 command key、重复 asset key、路径
  越界均被拒绝；
- `reference_solution_json` 从任何 product API 响应中缺席；
- 现有 MySQL Scheduler 不会接收 ExerciseSpec 或 workspace case ID。

SQL 复查：案例按 learner/capability 查询使用复合索引；读取案例详情只做案例、
路线节点、环境快照的常数次查询，不逐 asset 查询。并发复查：既有
`(learner_id, input_fingerprint)` 与 job claim fence 继续有效；迁移不得改变其
唯一性。

## 完成定义

P1 完成后，平台可以证明：一份案例由服务器指定的能力和环境解释，Python 特例
不再阻塞其他解释器；但用户还不能用 `Python list` 生成动态案例。该能力属于 P2。
