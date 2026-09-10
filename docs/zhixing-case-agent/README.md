# 案例 Agent 后续阶段总览

更新时间：2026-09-10

## 目的

把一个学习意图或一篇知乎文章，稳定地变成可进入的实践，而不把 Docker
配置、镜像选择或宿主机能力交给模型。

最终链路：

```text
学习节点 / 用户简述 / 已冻结的来源内容
  -> 能力解析（服务端）
  -> 环境解析（服务端）
  -> Intent -> Blueprint -> ExerciseSpec（模型）
  -> Runtime Preflight（服务端真实运行）
  -> Practice Instance（用户工作区或 Lab）
```

其中环境回答“在哪里做”，案例回答“做什么”。两者各自版本化，不能相互
代替。

## 已确认基线

以下能力已经在当前仓库实现，不在后续阶段重做：

| 已有能力 | 位置 | 当前限制 |
| --- | --- | --- |
| 版本化环境目录 | `backend/src/environment-registry.ts` | 只有 `python-pytest-v1`、`mysql-performance-v1` 可用 |
| 环境运行时适配层 | `backend/src/runtime-adapter.ts` | Docker workspace 已接入；MySQL 仍沿用现有 Lab 路径 |
| 冻结案例上下文 | `backend/src/case-context.ts` | 来源只冻结 `SourceItem.excerpt` |
| 三段 Case Agent | `backend/src/case-builder.ts` | Intent、Blueprint、Generate 已有；尚未真实预检 |
| 私有参考解 | `learning_cases.reference_solution_json` | 已保存，不会通过产品 API 返回 |
| Python 工作区 | `workspace-runner/`、`CaseWorkspaceService` | 文件和命令校验仍以 Python 为全局规则 |

因此，`“学习 Python list”` 目前不会生成 list 案例：能力目录只有
`python.testing`，fixture 仍固定生成订单汇总器案例，模型生成后的案例也
没有在真实容器中证明“初始状态失败、参考解通过”。

## 实施顺序

| 阶段 | 文档 | 一句话交付 | 前置 |
| --- | --- | --- | --- |
| P1 | [能力与练习规格](/Users/naive/code/zhihu/docs/zhixing-case-agent/phase-1-capability-and-exercise-spec.md) | 服务端将逻辑能力解析到唯一可用环境，案例物料不再写死 Python | 当前 M4-A/M4-B |
| P2 | [Python list 与真实预检](/Users/naive/code/zhihu/docs/zhixing-case-agent/phase-2-python-list-preflight.md) | `python.collections.list` 可生成、预检并进入真实 pytest 工作区 | P1 |
| P3 | [知乎文章到案例](/Users/naive/code/zhihu/docs/zhixing-case-agent/phase-3-source-snapshot.md) | Agent 使用冻结后的文章内容，而不仅是摘要 | P1、P2 |
| P4 | [MySQL 动态案例](/Users/naive/code/zhihu/docs/zhixing-case-agent/phase-4-mysql-dynamic-cases.md) | MySQL 表、数据量、错误索引和查询成为案例物料，而不是环境配置 | P1、P2 |
| P5 | [环境逐项扩展](/Users/naive/code/zhihu/docs/zhixing-case-agent/phase-5-environment-expansion.md) | 按模板逐个增加 Go、Java、Rust、C++、Redis、Kafka | P1，且每项独立 |

P2 是第一个必须完成的垂直切片。P3 和 P4 可以并行设计，但 P4 不应在
P2 的预检机制未稳定前实现。P5 不是“同时支持所有语言”的项目，而是一套
逐环境准入流程。

## 不变约束

- Agent 只可从服务端传入的 capability key 集合中选择；服务端再解析
  `EnvironmentTemplate(key, version)`。
- Agent 不输出 Dockerfile、镜像、Compose、挂载、网络、端口、Docker 参数、
  宿主机路径或密钥。
- `ExerciseSpec` 只携带声明式案例物料；环境解释器决定如何写文件、建表、
  导入数据或注入故障。
- 每次生成保留输入快照、环境快照、模型阶段记录、预检输出和版本。旧案例、
  旧工作区与 MySQL Lab 不被覆盖。
- “ready” 表示该案例已通过该环境的真实预检，不表示用户已经掌握。
- 模型、来源抓取或 Runner 出错时写真实失败状态并允许重试；不替换成固定案例
  或伪造可执行状态。

## 共通工程门槛

每一个阶段完成前都必须执行：

```text
1. npm run db:migrate（人工执行 migration）
2. 后端单元/集成测试与 build
3. 前端 typecheck、测试与 build（有界面改动时）
4. 真实 Runner 或 Lab 的阶段验收
5. EXPLAIN QUERY PLAN 检查新增高频查询
6. 并发和幂等复查
7. 一次独立 Git 提交，并重建 CodeGraph
```

每阶段的具体数据契约、状态机、接口、测试和验收路径见对应文件。
