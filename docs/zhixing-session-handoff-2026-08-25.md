# 知行项目会话交接快照

生成日期：2026-08-25

## 1. 恢复入口

仓库：`git@github.com:Nai1ve/Knowing-Doing.git`

默认分支：`main`

换电脑后的最短恢复路径：

```bash
git clone git@github.com:Nai1ve/Knowing-Doing.git
cd Knowing-Doing
git log --oneline -5
sed -n '1,260p' docs/zhixing-session-handoff-2026-08-25.md
cd frontend
npm install
npm run dev
```

前端默认使用 Vite。当前项目是桌面优先 Web，不是原生桌面应用。

## 2. 产品共识

产品名称：知行（Knowing-Doing）。

核心定位：面向程序员的 AI 个性化技术学习规划与执行系统。用户从“系统学习一项技术”进入，系统先理解目标、基础和时间，再生成带里程碑的数周计划；学习过程由实践、Tutor Agent、知乎来源和学习证据共同驱动。

已经确认的产品边界：

- K8s 不再是产品中心，只是一个可以保留的实践分支；
- 首批工程案例构建为 MySQL 慢查询、Kafka 消息积压、Redis 缓存一致性；
- 三个案例共用一套案例、证据、知乎来源、实践记录和笔记模型；
- MySQL 是第一个完整演示闭环，Kafka 和 Redis 复用同一套运行模型；
- 知乎不是普通搜索结果列表，而是原理、案例、方案取舍和练习素材的编排层；
- 用户的原始 SQL、日志、配置、指标和错误必须保留，模型输出不能覆盖原始事实；
- 学习笔记从参考内容、问题、错误和实践观察自动积累，再由模型生成可编辑大纲；
- 知乎发布需要用户人工确认和 OAuth 授权，当前没有伪造发布成功；
- Web 不直接执行本地终端、读取 kubeconfig 或控制生产集群；CLI 连接器需要用户主动安装和授权。

## 3. 已完成内容

### 产品与设计文档

- `.design/zhixing-learning/DESIGN_BRIEF.md`：设计简报；
- `.design/zhixing-learning/INFORMATION_ARCHITECTURE.md`：页面、导航、数据边界和工作台信息架构；
- `docs/zhixing-product-direction.md`：产品方向和长期主线；
- `docs/zhixing-mvp-prd.md`：MVP 产品需求基线；
- `docs/zhixing-engineering-scenarios.md`：三个工程案例的数据契约和种子数据；
- `prototype/zhixing-sample.html`：早期单文件原型，保留用于设计参考。

### Vue 前端

`frontend/` 是 Vue 3 + TypeScript + Vite + Pinia + Vue Router + lucide-vue-next 前端。

当前页面：

- `/overview`：学习总览；
- `/route`：树形整体学习路线；
- `/lesson`：当前学习单元和实践工作台；
- `/notes`：实践记录、AI 大纲、文章编辑边界；
- `/review`：周复盘和调整建议；
- `/profile`：学习画像和画像依据；
- `/settings`：知乎、模型服务和 CLI 连接状态，OAuth 接口预留。

前端当前以 Mock 数据为主，API 服务层已经按计划、学习单元、Tutor、笔记、画像和 OAuth 拆分，避免单页面集中发请求。真实后端、真实模型和知乎 OAuth 尚未接入。

### 知乎 CLI 与检索

知乎 CLI 已安装并验证，版本为 `0.4.0`。认证状态曾通过 `auth status --verify` 验证有效。Access Secret 只保存在本机 Keychain，未写入本仓库。

已检索和分析的候选方向：K8s、MySQL、Redis、Go、Java、RAG、Agent、CI/CD、Kafka、Outbox。最终选择 MySQL、Kafka、Redis 作为首批工程案例。

原始搜索结果曾保存在本机临时目录 `/tmp/zhihu-scenario-analysis.Tkk0S6/`，该目录不属于仓库，也没有作为凭据或运行状态提交。

## 4. 三个案例当前定义

### MySQL 慢查询

案例 ID：`mysql-date-function-index-001`

主链路：慢 SQL -> EXPLAIN -> 识别函数包裹索引列 -> 改写日期范围条件 -> 对比 `type`、`key`、`rows`、`Extra` 和耗时。

当前演示数据是合成数据，包含 500 万行、`type=ALL`、`key=NULL` 和约 3.2 秒初始耗时。不能把这些数字展示为真实生产事实。

### Kafka 消息积压

案例 ID：`kafka-hot-partition-001`

主链路：总 Lag -> 分区级 Lag -> 区分全局积压和单分区热点 -> 检查分区键、处理耗时和 Rebalance -> 选择修复方向 -> 对比 Lag 和消费速率。

关键演示证据是一个分区 Lag 约 120000，而其他分区约 800；这个案例强调增加消费者不一定能解决单分区瓶颈。

### Redis 缓存一致性

案例 ID：`redis-stale-cache-after-write-001`

主链路：定义业务一致性目标 -> 画出旧值回填时序 -> 比较删除缓存、延迟消息、重试、CDC 和版本校验 -> 设计并发或失败注入验证 -> 记录残余风险。

这个案例不把“延迟双删”当作绝对答案。商品详情可以接受秒级最终一致，但权限、余额和库存不能依赖过期缓存做最终判断。

## 5. 下一阶段实现顺序

1. 将 `EngineeringScenario`、`EngineeringCase`、`ContextArtifact`、`EvidenceArtifact`、`PracticeRun` 和 `SourceReference` 转成前端类型和 Mock 数据；
2. 把场景选择接入学习计划创建流程，但不改变“系统学习一项技术”的主入口；
3. 先把 MySQL 案例接入学习单元和工作台，完成上下文输入、Tutor 追问、知乎来源、验证结果和笔记素材记录；
4. 用同一套组件和数据协议接入 Kafka；
5. 接入 Redis 的时序和方案比较；
6. 再接入真实后端 API、知乎搜索和模型服务；
7. 最后做浏览器验证、空状态、加载失败、来源不可用和移动端溢出检查。

## 6. 当前已知限制

- `docs/zhixing-mvp-prd.md` 中仍有早期 Kubernetes 默认 MVP 的历史表述，产品方向文档和工程案例文档已经表达新的三场景方向；后续应统一 PRD 版本；
- 前端页面目前展示的是 K8s Mock 学习内容，三场景还没有进入真实页面交互；
- OAuth、知乎检索后端、模型生成和 CLI 自动抓取均为接口预留或 Mock；
- 当前没有真实 MySQL、Kafka、Redis 集群运行验证，案例中的指标和日志需要明确标注为演示或来源派生；
- 当前未提交 `node_modules`、`dist`、`.env` 等生成物或环境文件，它们由 `.gitignore` 排除，换电脑后使用 `npm install` 恢复依赖。

## 7. 验证记录

2026-08-25：在 `frontend/` 执行：

```bash
npm run build
```

结果：`vue-tsc -b` 和 `vite build` 均通过，Vite 成功生成生产构建。

## 8. 会话恢复边界

本文件是当前会话的可迁移上下文快照，包含继续开发所需的产品决策、代码状态、数据模型和下一步。Codex 的原始 rollout 日志、浏览器状态、Keychain 凭据、临时目录和本机路径不写入 Git；它们不是可靠的跨电脑恢复机制，也不应作为项目资产传播。

恢复时应以仓库当前 `main`、本文件和各产品文档为准。若代码和文档出现冲突，先核对 `git log` 和实际前端运行结果，再继续实现。
