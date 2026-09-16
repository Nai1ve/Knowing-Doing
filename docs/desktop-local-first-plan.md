# Knowing-Doing 桌面端与开源演进方案

日期：2026-09-16。分支：`codex/desktop-local-first`。代码基线：`c7cedc4`，来自 `codex/completion-integration`。

本文是实施设计，新增模块均为待开发。当前分支保留工作区已有未提交文件；创建分支不等于提交这些文件。本轮只创建分支和规划，未开始桌面端实现或发布。

## 1. 产品定位与首版边界

产品定位为本地优先的工程学习桌面应用：用户配置模型 API 和知识资料，系统提供规划、案例构建、独立验证以及证据沉淀。基本使用不需要产品服务器、知乎账号、开发环境或命令行。

首版默认单人本地工作区，保留后端 learner 主键方便沿用业务数据。联网范围由用户配置决定：远程模型会收到必要上下文；本地保存不意味着模型推理也离线。无模型时允许浏览历史、管理资料和恢复工作区；无 Docker 时允许规划、测评、知识卡与反思，实践活动明确提示运行时不可用，不能伪装成已验证。

建议先交付 macOS Apple Silicon 安装包；架构兼容 Windows/Linux，分别经过打包和运行时验证后再宣布支持。首版不做云同步、多人协作、任意插件执行、任意 MCP 接入或自动修改用户项目。

首次使用流程：创建本地工作区 → 配置模型并测试 → 可选导入知识资料 → 开始规划。只有首次进入实验时才检测并引导配置 Docker。知乎改为可选资料连接，不作为登录前提。

## 2. 技术路线与选型

建议 Electron + 现有 Vue + 独立 Node 产品服务。Electron 自带 Node 运行能力，适合复用 Fastify、better-sqlite3、pdfjs 和现有 TypeScript 业务服务。代价是安装体积和内存开销较大，需要维护 Chromium/Electron 更新。

Tauri 是备选：可以复用 Vue，但当前 Node 后端仍需单独封装 sidecar，并处理 Node、原生 SQLite 模块、跨平台二进制与签名。暂不引入 Rust 重写业务服务。最终选型通过 D0 安装包原型确认，不仅凭开发模式可运行判断。

进程职责：

| 组件 | 职责 | 权限 |
| --- | --- | --- |
| Vue Renderer | 规划、知识库、Gym、设置 UI | 无 Node、无 shell、无任意文件访问 |
| Electron Main / Preload | 窗口、系统对话框、密钥库、生命周期 | 小范围类型化 IPC；校验来源与参数 |
| Product Service 子进程 | Fastify、SQLite、Planner、Research、Gym、Verifier | 工作区数据与选定模型调用 |
| Runtime Supervisor / Runner | Docker 探测、容器生命周期与受控执行 | 仅在启用实践时使用 Docker |
| OpenHands Builder | 动态构建与修复 | 显式启用的高权限实验能力 |

Main 通过 Electron utility process 启动打包后的后端，避免阻塞窗口。D0 验证原生模块兼容性后固定 Electron、Node ABI 和打包工具版本。

### 通信设计

首版保留现有 HTTP/SSE API，避免一次重写全部 API client：子进程监听 `127.0.0.1:0`，系统分配端口；同一服务提供打包后的 Vue 静态文件与 API。主进程通过私有进程通道取得端口和一次性 bootstrap 凭据，建立该窗口会话后再加载页面。

鉴权在全局 hook 执行，早于业务路由，不存在未鉴权可写阶段。bootstrap 限时、一次性；每次启动轮换凭据。凭据不进入 URL、localStorage 或日志。严格校验 Host、Origin 和会话，关闭任意 CORS；写操作保留 CSRF。加载仅允许当前本地 origin，外部链接经 URL allowlist 交给系统浏览器，禁止远程页面在特权窗口运行。

独立浏览器或其他网页不能因为猜到端口就读写数据。该方案防网页跨源调用，不承诺防御已控制本机账户的恶意进程。开发服务器允许列表与正式安装包配置分离。

## 3. 现有代码迁移映射

| 当前模块 | 桌面化改动 | 保留内容 |
| --- | --- | --- |
| `backend/src/server.ts` | 提取无副作用的 `createProductService(config, dependencies)`，提供 start/stop/health | 业务服务装配及 API |
| `backend/src/config.ts` | 新增 desktop/web 运行模式、版本化本地配置 | Web 环境变量入口仍可运行 |
| `frontend/src/api/client.ts` 与流式请求 | 统一运行时地址/鉴权来源，清点所有直接 fetch 与 SSE | 现有业务 DTO |
| Identity / Auth / 路由守卫 | 桌面自动建立本地身份，取消强制知乎授权 | learner 归属、Web 登录模式 |
| DeepSeek 各模型适配器 | 统一 ModelGateway、角色路由与调用记录 | Prompt、Zod 契约、独立验证 |
| ResearchService / 来源库 | 组合本地资料与可选远程来源 | 引用、digest、可见性和卡片引用关系 |
| Planner / Practice Card / Mixed Gym | 注入本地依赖和能力目录 | 状态机、答题规则、完成判定 |
| Runner / Builder | 动态端口、随机内部凭据、Docker context 探测、用户级生命周期 | 签名引用、资源标签、Verifier |
| deploy / GitHub Actions | 新增桌面构建工作流 | 服务器部署保留为独立产物 |

当前集成分支已存在研究服务及较新的身份/PDF 改动，旧收尾审计不能作为当前缺失清单。桌面分支不顺带调整 Planner 回合规则；实施前以当前产品规则与测试确认，避免把历史审计中的三轮/六轮差异带入平台迁移。

## 4. 桌面壳与服务生命周期

建议增加 `desktop/`，包含 main、preload、服务监督器、密钥适配器和安装包配置。先复用 backend/frontend 目录，不急于全仓迁为 monorepo packages。

启动顺序：单实例锁 → 定位工作区 → 检查版本和恢复状态 → 一致性备份 → 数据迁移 → 启动产品服务 → 建立本机会话 → 展示 UI。异常应在恢复界面明确区分迁移失败、密钥不可用、端口/子进程失败，不显示永久加载动画。

关闭窗口和退出应用分开：首版关闭主窗口不隐式长时间执行高成本任务；存在任务时提供继续后台或取消退出选择。退出时停止接收任务、持久化中断状态、终止可取消模型请求、释放本应用容器租约、关闭 HTTP 和数据库。子进程崩溃有限重启，超过次数显示恢复入口。

睡眠/唤醒后重新检查连接、任务租约与容器状态。进程重启不能自动重复付费生成；先恢复已知任务或要求显式重试。服务不能通过 `process.exit()` 强制结束整个嵌入生命周期。

## 5. 用户模型配置

### 数据与接口

新增 provider_profiles、model_role_bindings、model_invocations。模型配置包含 id、label、protocol、baseUrl、model、secretRef、timeout、上下文上限和能力探测结果。角色包括 planner、assessment、card、tutor、writing、builder、embedding，可先共用一个默认模型。

首版支持 OpenAI-compatible Chat Completions 协议和 DeepSeek 预设；其他供应商、本地服务通过协议适配和能力检测逐步支持，不因接口名相同就宣称完全兼容。不强制本地模型提供 API key。

配置页支持保存、测试连接、选模型、角色覆盖、删除凭据；公共 API 只返回 `hasSecret` 和脱敏配置。ModelGateway 统一处理超时、取消、SSE、结构化输出、工具调用、用量和安全错误。工具调用/JSON 能力单独探测，普通聊天可用不代表能驱动 Builder。

运行任务冻结 provider/model/config revision，用户修改配置仅影响新任务。重试不跨供应商静默发送资料。记录 token 用量与估算费用，缺少可靠费率时标为未知；调用次数、token 和任务时限是硬限制，估算金额不宣称绝对计费上限。

### 密钥管理

使用操作系统密钥能力，通过 Main 的 SecretStore 抽象访问；可采用 Electron safeStorage 封装加密材料。按选定 Electron 版本使用其受支持 API。Linux 无安全存储或退化到 basic_text 时默认仅内存保存，提示用户配置密钥服务，不静默明文落盘。

普通配置只保存 secretRef；数据库、备份、错误报告和 UI 状态均不包含明文 API key。子进程仅在执行角色调用时获取所需凭据，Builder 不获得整个应用配置或其他模型密钥。来自历史服务器的密钥必须重新配置，不能随桌面安装包分发。

## 6. 本地知识库

首版支持用户选择的 PDF、Markdown、TXT 文件与目录，默认复制导入、冻结内容版本；后续再支持可撤销的目录监控。扫描 PDF 无可提取文本时明确提示需要 OCR，不当作成功导入；知乎解析作为用户选择的远程解析方式，上传前说明资料会离开设备。

数据模型建议新增 knowledge_libraries、knowledge_documents、knowledge_document_versions、knowledge_chunks、knowledge_index_jobs。记录工作区归属、内容 hash、来源路径、标题、页码/段落位置、解析器版本和索引状态。迁移编号实施时按当前最大序号分配，不能预占历史编号。

导入流程：用户文件授权 → 类型/大小检查 → 本地解析 → 分块 → 索引 → 可定位的检索结果。目录递归限制范围、文件数、深度；拒绝符号链接逃逸和默认扫描隐藏凭据目录。不自动读取整个用户主目录。

首版检索采用 SQLite FTS5，D0 验证随包 SQLite 编译能力；验证中文召回并用分词或字符切分方案配套测试，不假设默认英文 tokenizer 足够。第二阶段增加可选 embedding provider，保存模型和维度版本，变更后重建索引。没有 embedding 配置不影响核心使用。

KnowledgeRetrievalProvider 与现有远程来源合并为统一候选接口，进入 ResearchService 的去重、排序和最多两来源卡片策略。每条引用可定位到不可变资料版本和页段。用户删除资料后停止新检索；历史卡片保留最小必要快照，彻底删除须提示受影响引用。

Planner 只接收相关资料摘要，不把整库加入提示词。文档中的指令属于不可信内容，不能提升为 Agent 工具权限。第一版不部署额外向量数据库。

## 7. 本地实践与构建

拆为三个可感知的能力等级：基础规划与知识学习；安装 Docker 后使用已验证 Runtime；显式启用 OpenHands 后进行动态环境构建与修复。

首版使用用户安装的 Docker，不捆绑 Docker Desktop、不自动执行 sudo。探测 Docker CLI、当前 context、daemon、CPU 架构、内存、磁盘和网络；支持 macOS Unix socket 与 Windows named pipe 的平台差异，不能写死 `/var/run/docker.sock`。Windows/Linux 未验证前显示实验支持状态。

Runtime Supervisor 在用户级启动 Runner/Builder，替换服务器 systemd、固定端口和 `/home/ubuntu` 路径。按安装 ID、工作区 ID、build ID 标记资源，清理仅作用于这些标签；退出/卸载不运行全局 Docker prune。镜像按目标架构与 digest 配套，下载有大小提示、进度、取消和校验，不把多 GB 镜像打进桌面包。

现有启动依赖需改为惰性加载：无 MySQL、Docker、模型配置时产品服务仍能启动。MySQL 每案例容器不发布端口，通过受控 exec；Python 最终容器 network none。用户选定宿主资料目录不能直接整目录挂载给 Agent，工作文件先复制到应用管理的临时目录。

OpenHands 挂载 Docker socket 仍有主机级风险，普通容器并不构成强宿主隔离。设置页独立说明并显式启用高级 Builder；保留远程专用 Builder endpoint 接口。模型兼容与真实修复 smoke 通过后才标记动态构建可用，失败可使用预构建案例而不能跳过 Verifier。

## 8. 本地数据、导入与升级

应用配置和密钥引用位于 Electron userData；工作区位于用户选定路径，包含 product.sqlite、documents、artifacts、受限 logs、backups、可重建 indexes。SQLite 是当前工作区单写者，使用工作区锁；v1 每次只打开一个工作区。网络共享盘不作为首版受支持数据库位置。

每次 Schema 升级先通过 SQLite backup API 制作一致性快照，不能复制正在写入的 db 文件忽略 WAL。迁移失败进入恢复页。旧版本遇到更新 Schema 拒绝写入；回退应用版本不自动回退数据。

提供版本化导出/导入包和清单校验，排除密钥、会话、OAuth Token、运行时签名与未审查日志。导入进行路径穿越、大小、数量和引用一致性检查。旧 Web 数据通过显式导出指定 learner 的路线/画像/卡片/工件导入，不直接把生产完整多用户库复制到桌面。目标写入新工作区后验证，保留源数据。

## 9. 知乎与其他外部能力

保留当前知乎 Gateway，但从核心登录和核心研究依赖中解耦：本地知识检索、用户自配的公共检索不要求知乎 OAuth/source-sync 开关。重新梳理当前 config 中相关依赖和来源隔离规则。

桌面安装包不能内置开发者 App Key。首版支持本地资料与用户自行配置的平台 Access Secret；知乎 OAuth 收藏接入暂作为可选后续项。只有平台正式支持原生应用 PKCE/回环地址时才能采用对应流程；否则需要用户自建授权服务，或另行设计托管授权服务及隐私责任。现有固定服务器 HTTP 回调不能直接当作通用桌面登录方案。

任意 URL 抓取、外部知识库连接器和 MCP 留作后续，通过显式连接器接口扩展，避免首版形成任意网络/命令代理。

## 10. 开源与分发

开源交付包括 README 快速开始、架构与贡献指南、SECURITY、问题模板、示例配置、无凭据 fixtures、桌面开发/构建说明、依赖许可清单和支持矩阵。仓库主许可证需单独确定并核验依赖；第三方代码原许可证保留。发布前扫描工作树和 Git 历史中的密钥，历史泄露凭据先轮换，不能靠删除当前文件解决。

新增桌面 CI，保留 Web CI：受影响单元测试、类型检查、前后端构建、桌面启动/退出、原生 SQLite 读写、安装包 smoke。macOS 签名/公证、Windows 签名与 Linux 发布分别配置；没有签名资源时标为内部预览，不声称可无阻碍安装。

初期手动升级。后续自动更新使用签名产物与固定发布渠道，拒绝篡改包，更新前协调运行任务及数据备份。默认不采集遥测；诊断包由用户预览后导出。

## 11. 实施里程碑与验收

| 阶段 | 实现任务 | 验收门槛 |
| --- | --- | --- |
| D0 安装包可行性 | Electron 壳、utility process、Vue 静态资源、SQLite native module、PDF worker 打包 | 无 Node/npm 的干净 macOS 上安装启动，数据库读写及 PDF 解析成功；无 Docker/模型也能进设置 |
| D1 本地服务与身份 | 生命周期抽取、desktop config、本地会话、工作区锁、数据迁移备份 | 端口不可被未授权网页调用；双开、异常退出、重启及升级失败可恢复 |
| D2 模型配置与规划 | SecretStore、ModelGateway、设置引导、角色配置、Planner/Tutor/Card/Writing 适配 | 用户自配模型走通测评—需求—路线；错误 key、取消、超时可恢复；无秘密落入公开日志 |
| D3 本地知识库 | 文件导入、解析、FTS、中文召回、版本引用、Research 融合 | 资料导入后生成可追溯卡片；重复导入幂等；删除与解析失败行为正确 |
| D4 本地 Gym | Docker 探测、惰性 runtime、镜像下载、MySQL/Python、OpenHands 可选接入 | 两条真实实践由独立 Verifier 通过；知识错误映射 completed_with_gaps；取消/租约只清理本应用资源 |
| D5 开源预览发布 | 脱敏导入导出、文档、许可证决策、签名安装包、CI/E2E | 新设备安装—配置—资料—规划—卡片—实践—导出完整闭环；不依赖生产服务器 |

第一可用切片是 D0+D1+D2：桌面应用能独立安装、配置自己的模型并完成规划。随后交付 D3 的资料驱动卡片，再完成 D4 的本地实践。只有完成 D4 的真实验证才称为规划、构建、验证全闭环。

## 12. 并行安排与冲突控制

先由主 Agent 冻结 RuntimeConfig、SecretStore、ModelGateway、KnowledgeRetriever 和 DesktopBridge 的最小接口及 fixtures。桌面入口和 backend/server.ts 的生命周期改造由一个负责人独占。

最多同时两个开发 Agent：Terra 负责后端/桌面基础和运行时，Luna 负责 Vue 设置、知识库、状态恢复与交互测试。独立 worktree，指定同一契约提交作为基线；各主题独立提交，主 Agent 逐个整合验收。

| 批次 | Terra | Luna | 主 Agent |
| --- | --- | --- | --- |
| 0 | D0 桌面壳、原生模块和安装包验证 | 首次启动/配置界面，使用冻结 fixtures | 审核进程与通信方案，确认真实包可运行 |
| 1 | D1 生命周期 + D2 模型网关/密钥后端 | 本地身份、模型设置、角色配置、失败恢复 | 契约、配置和迁移整合，安全与规划闭环验收 |
| 2 | D3 知识库解析、索引、Research 接入 | 文件库、导入进度、检索引用 UI | 中文检索质量、数据导出设计 |
| 3 | D4 Docker Supervisor、Runner/Builder 适配 | 环境中心、镜像进度、Gym 恢复 UI | Docker 真机验证、跨平台打包和发布文档 |
| 4 | 修复集成发现的问题 | 桌面 E2E 与易用性收尾 | D5 签名发布、导入导出、安全和开源检查 |

可独立并行的能力：模型网关与知识库解析；桌面壳与 Vue 页面；Docker 适配与知识库 UI；开源文档与功能开发。不能并行自由修改的文件：配置 schema、数据库迁移编号、server.ts、鉴权中间件、统一 API client。两人并发限制意味着独立工作包可以调度交替，不代表每个工作包同时起一个 Agent。

## 13. 主要风险与决策点

- 原生 better-sqlite3 与 Electron ABI、PDF worker/资源路径：D0 在真实安装包内验证，失败先解决打包而非继续铺 UI。
- 本地模型不支持 JSON/工具调用：按角色能力检测和有限重试处理，不自动改用其他供应商。
- Docker 架构和资源差异：按平台发布能力矩阵，首版不承诺所有平台的动态构建。
- 日后 OAuth：依赖平台原生应用协议确认，不把应用密钥放进可逆向安装包。
- 开源许可证、签名证书和首批平台：作为正式公开发布前决策，不阻塞本地原型和接口设计。
- 迁移范围：保持业务语义稳定，桌面化期间不同时重写 Planner、Gym 完成规则或路线算法。

## 14. 实施参考

选型依据是现有代码与以下官方文档；具体 API 在锁定桌面依赖版本时再次校验：

- Electron 子进程能力：[utilityProcess](https://github.com/electron/electron/blob/main/docs/api/utility-process.md)。
- Electron 权限与隔离：[Security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)。
- Electron 系统密钥能力及平台差异：[safeStorage](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)。
- Tauri 外部进程打包：[Sidecar](https://v2.tauri.app/develop/sidecar/)。
- Tauri 安装包分发：[Distribute](https://v2.tauri.app/distribute/)。
