# P2：Python list 案例与真实运行预检

## 目标

交付首条真正动态的学习案例：

```text
“我想学习 Python list 的创建、索引、切片和可变性”
  -> python.collections.list
  -> python-pytest-v1
  -> Agent 生成 list 案例与私有参考解
  -> 临时容器验证
  -> ready
  -> 用户进入同模板工作区实践
```

这一步回答“能力能不能实现”：能，前提是环境由服务端确定、案例由模型生成、
并在交付前由真实 Runner 验证。仅 Zod 合格不能证明案例能运行。

## 入口与能力解析

在 P1 capability catalog 中启用：

```text
capabilityKey: python.collections.list
environment:  python-pytest-v1@1
exerciseKinds: concept_drill | code_repair
aliases:       Python list, 列表, 创建、索引、切片、可变性
```

路线生成器或节点编辑器必须显式写入 `capability_key=python.collections.list` 与
`learning_mode=workspace`。自由文本不直接决定 Docker；它只能由既有路线解析
逻辑映射到上述 capability。

## Agent 输入输出

### 冻结输入

`CaseContextCompiler` 提供：

- capability 定义、环境逻辑命令 key 与允许 asset kinds；
- 路线节点标题、完成标准、安排理由；
- learner 画像中与 Python 相关的维度和来源摘要；
- brief、期望产出、难度；
- 可选的已冻结来源快照（P3 后增强）。

不得提供 Docker 镜像、端口、挂载、Runner token、宿主机路径、模型密钥或其他
学习者的案例。

### 分段输出

| 阶段 | 输出 | 校验 | 是否展示给用户 |
| --- | --- | --- | --- |
| Intent | `CaseIntent` | scope 包含 list 学习点；能力必须等于已解析能力 | 否 |
| Blueprint | `CaseBlueprint` | 资产类型、command key 和任务顺序适合 Python interpreter | 否 |
| Generate | `ExerciseSpecV2 + ReferenceSolutionV2` | 环境不可替换；starter/reference 完全分离 | 案例规格的公开部分 |
| Preflight | `CasePreflightReport` | 真实初始失败、参考解成功 | 状态和可读失败文案 |

List 案例至少包含：可执行模块、pytest 测试、失败的 starter 行为、说明文档；
题面可以是库存标签、分页结果或任务队列，不必固定为“背 API”。测试要覆盖创建、
索引、切片和可变性中的本次学习范围，范围由 Intent 决定。

## Runtime Preflight

### 状态机

```text
case_generation_job: queued -> running -> preflighting -> succeeded | failed
learning_case:       generating -> preflighting -> ready | failed
preflight_run:        queued -> provisioning -> verifying_starter
                     -> verifying_reference -> passed | failed | interrupted
```

不能在 Generate 成功后立刻把 `learning_cases.status` 标为 ready。

### 执行步骤

1. 生成阶段通过 interpreter 校验后，写入不完整案例与私有 reference solution；
2. 创建一次不关联 learner PracticeRun 的临时 `python-pytest-v1` runner run；
3. 写入 starter assets，执行 spec 的 verification command keys；
4. 预期初始命令非零退出，且输出能命中本次定义的失败信号；
5. 在同一临时运行中应用 reference solution assets，再次执行同一命令；
6. 预期退出码为 0，且输出命中 success signals；
7. 保存截断后的 stdout/stderr、exit code、duration、命令 key 和环境版本；
8. 无论成功或失败都调用 Runner end；
9. 只有 passed 才在条件更新中将 case/job 置为 `ready/succeeded`。

这不是内容质量打分。它只验证“用户进入的起点确实有问题，平台保留的解法确实能
在同一环境中通过”。

### 故障与一次修复

- Intent、Blueprint 或 Generate JSON 不合法：保留现有一次结构修复；
- Preflight starter/reference 任一不符合预期：将失败输出作为**新的 preflight
  diagnostics**，用原冻结上下文和原 Blueprint 对 Generate 发起一次实现修复；
- 修复后的版本重新完整预检；仍失败则 task/case 落为 failed；
- 不以 fixture 替代失败的 model case，不把 reference solution 暴露给用户。

## 数据与服务

新增 `033_case_preflight_runs.sql`：

```text
case_preflight_runs
  id, learning_case_id, case_generation_job_id, attempt_number,
  environment_key, environment_version, runtime_kind, runner_run_id,
  status, starter_execution_json, reference_execution_json,
  failure_code, failure_message, started_at, completed_at, created_at
```

- `UNIQUE(case_generation_job_id, attempt_number)`；
- `(learning_case_id, created_at DESC)` 用于案例详情；
- `(status, updated_at)` 只用于 worker 恢复；
- runner run ID 不经产品 API 返回。

新增 `CasePreflightService`，它只依赖 `EnvironmentInterpreter` 与
`RuntimeAdapter`。不要把临时运行、执行、清理继续堆入
`CaseWorkspaceService.processCaseJob()`；后者已是耦合热点。

生成任务的 attempt fence 要覆盖 preflight：只有持有 job `worker_token` 且
`attempt_count` 未变化的 worker 可以完成 case/job。服务启动时，遗留
`provisioning/verifying_*` preflight 先标 `interrupted` 并清理 runner run，随后
将对应生成 job 按现有恢复策略重排，不能猜测它成功。

## API 与体验

复用生成任务查询 API，新增安全的只读字段：

```ts
preflight: {
  status: 'queued' | 'running' | 'passed' | 'failed' | null
  updatedAt: string | null
  userMessage: string | null
}
```

用户只看到“正在验证案例可运行性”或真实失败原因。案例 ready 后显示场景、任务和
验证方法，不显示私有解和预检容器输出。浏览器进入工作区后仍是独立的 learner
workspace run，绝不复用 preflight 的容器。

## 测试与验收

- 模型输入 `Python list` 后 context 中有 `python.collections.list`，环境固定为
  `python-pytest-v1@1`；
- starter `pytest -q` 确实失败，应用 private reference 后确实成功；
- Agent 将环境改成 Go、写入 Dockerfile、使用未知 command key 时被拒绝；
- starter 直接通过、reference 仍失败、Runner 超时、Runner 失联均真实失败；
- 同一 `clientRequestId`、同一 fingerprint、并发 retry 只产生一条有效 job 与
  一条有效 preflight attempt；
- 重启后中断 preflight 不会显示 ready；
- 用户工作区启动后仍可执行失败 -> 修改 -> 成功，并保留自己的 artifacts；
- 现有 fixture case 与 MySQL Lab 回归通过。

使用真实 Docker runner 执行上述验收，Fake Runner 只覆盖服务单测。检查
`case_preflight_runs` 的恢复与详情查询命中索引；预检 worker 按状态分页领取，
不扫描所有案例。
