# P5：环境模板逐项扩展准入

## 原则

不按“支持语言清单”一次性承诺 Go、Java、Rust、C++、Redis、Kafka。每个模板都是
一项独立的运行时产品，只有在镜像、命令、物料解释器、预检、清理和资源上限均通过
后才从 `planned` 变为 `available`。

推荐顺序：

```text
Go -> Java -> Rust -> C++ -> Go + Redis -> Kafka KRaft
```

前四项是单运行时模板，Redis 增加组合拓扑，Kafka 需要单独评估启动时间、内存和
磁盘，因此最后实施。

## 每个模板的最小交付包

1. 环境目录条目：key、version、runtime kind、服务拓扑、资源 profile、asset 与
   command policy、初始化契约；
2. 私有 Runner 配置：镜像、Docker 限制、内部端口和 cleanup 细节；
3. `EnvironmentInterpreter`：可接受物料、逻辑 command key 与 reference
   solution 的物化规则；
4. 一个 fixture 案例与一个模型生成案例，二者均通过真实 preflight；
5. workspace/Lab 生命周期、过期、重置、Runner 重启和并发验收；
6. 仅在上述通过后，将 capability 的 `availability` 改为 `available`。

## 模板差异表

| 模板 | 初始 capability | 物料形态 | 验证 command key | 特别检查 |
| --- | --- | --- | --- | --- |
| `go-test-v1` | `go.testing` | `.go`、`go.mod`、测试文件 | `go_test` | module cache 与无网络依赖 |
| `java-maven-v1` | `java.testing` | Maven 项目与测试 | `mvn_test` | 依赖预置、JVM 内存、构建时间 |
| `rust-cargo-v1` | `rust.testing` | Cargo 项目与测试 | `cargo_test` | crate cache、编译时间 |
| `cpp-cmake-v1` | `cpp.testing` | CMake、源码、测试 | `cmake_test` | 编译器资源、构建目录重置 |
| `go-redis-v1` | `go.redis` | Go 文件、Redis fixture | `go_test`、`redis_check` | 双容器连通性、数据清理 |
| `kafka-kraft-v1` | `kafka.events` | producer/consumer、topic fixture | `kafka_verify` | broker 启动、磁盘、主题隔离 |

## 通用验收阈值

每个模板必须定义并在 CI/本地真实 Runner 中验证：

- 可创建、可写 starter asset、可执行至少一个 command；
- starter 状态和 reference solution 状态均被 preflight 正确区分；
- 无网络、非 privileged、无宿主机挂载、无 Docker socket；
- 资源与时限不超过该模板已声明的 envelope；
- lease 到期、API 重启、Runner 重启后不会显示伪 active；
- command 与 asset 越界不会进入 Runner；
- workspace 概要查询、文件/执行分页查询使用索引且无 N+1。

## 发布方式

每个环境一个独立 feature commit 与 CodeGraph 重建。先合入 `planned` registry 与
测试，镜像和预检通过后才在后续提交中切为 `available`。如果模板在生产 Runner
不稳定，应退回 `planned` 并阻止新 CaseRequest；已有案例保持可读并显示真实不可用
状态，不删除历史证据。
