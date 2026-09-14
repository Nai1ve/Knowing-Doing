# 知乎登录闭环实施计划与落地状态

本文档回答两个问题：**这条闭环要做成什么样**，以及**当前代码已经做到哪一步**。

前半部分是计划基线（技术契约、模块拆分、发布顺序、验收标准），后半部分是逐项核对结果。
核对基于对 `codex/planner-phased-diagnostic-push` 分支提交 `09a970e` 的只读代码审查，
核对日期 2026-09-14。所有结论都带 `文件:行号` 证据，可自行复核。

配套文档：[zhixing-identity-planner-zhihu-contract.md](zhixing-identity-planner-zhihu-contract.md)
是本文计划切出的**第一个实施切片**的契约冻结，仍然有效。

---

## 一、目标闭环

```text
知乎登录
→ 建立正式用户
→ 补充目标/上传简历
→ Planner 基线访谈
→ 稳定生成诊断题
→ 完成诊断与需求确认
→ 生成路线
→ 收藏/搜索/直答补充资料
→ 生成实践卡片
→ Mixed Gym 验证
→ 能力证据回写
```

本轮的优先级排序是明确的：先修**线上诊断题无法生成**，再把**知乎 OAuth 从"可选连接"升级为正式登录体系**。
搜索、PDF、收藏建立在正确的身份和鉴权基础上，随后推进。

---

## 二、状态标记说明

| 标记 | 含义 |
| --- | --- |
| ✅ 已完成 | 计划要求的能力已实现且有测试或明确代码路径 |
| 🟡 部分完成 | 主路径可用，但计划中的具体字段/边界/降级/测试有缺失 |
| ⬜ 未开始 | 代码中不存在 |
| ⚠️ 与计划冲突 | 现有实现与计划要求方向相反，需要改为计划形态 |

---

## 三、总体结论

**这条闭环已经走过大约三分之二，但剩下三分之一集中在"正式登录体系"和"研究能力"两块，恰好是计划里排在后面的模块。**

| 模块 | 状态 | 一句话结论 |
| --- | --- | --- |
| T0 技术契约 | 🟡 | 契约文档已冻结；契约的**代码类型**与**表结构**未按文档落地 |
| M1 Planner 诊断修复 | 🟡 | 题位分配/局部修复/确定性兜底已实现，**自动恢复未做** |
| M2 知乎数据访问层 | 🟡 | 正式 Envelope 已能解析，但**三处各写一遍**，模块化未开始 |
| M3 正式登录体系 | 🟡 | 身份稳定 ID 与门禁已做，**表结构/`me`/`logout`/冲突合并未做** |
| M4 PDF 解析 | 🟡 | 异步链路与降级已可用，**错误分档与进度体验缺失** |
| M5 收藏与来源库 | 🟡 | 收藏最近 N 条可用，**收藏夹分页与排序分层未做** |
| M6 搜索与直答 | ⬜ | 只有路线节点的知识路径一处，**门禁/配额/卡片链路未做** |
| M7 前端体验 | 🟡 | 卡片来源已做，**登录页形态与 Planner 失败恢复与计划冲突** |

**质量基线（2026-09-14 实测）**

| 项 | 结果 |
| --- | --- |
| 后端测试 | 36 个文件 / 163 个用例 **全部通过**（4.82s，退出码 0） |
| 前端测试 | 17 个文件 / 57 个用例 **全部通过**（2.08s，退出码 0） |
| 前端类型检查 | `vue-tsc --noEmit` **无错误** |

---

## 四、T0 技术契约

### T0.1 身份定义 —— 🟡 部分完成

计划要求的 `AuthSession` 类型在**后端不存在**。后端只有 `DeviceSession` / `ResolvedDeviceSession`
（`backend/src/identity-service.ts:13-24`），形状是 `{id, learnerId, csrfToken, expiresAt}`，
没有 `state` 判别字段，没有 `learner{displayName,avatarUrl,headline}`，没有 `connection{provider,status}`。

前端有一个**同名但不同形状**的 `AuthSession`（`frontend/src/stores/auth.ts:8-18`），
实际线上返回的是 `{learnerId, csrfToken, expiresAt, auth:{required,authenticated,provider,profile}}`
（`backend/src/app.ts:294`）。`reauthorization_required` 只作为数据库状态和错误码存在，
从未成为会话状态。

计划里三条原则的落地情况：

| 原则 | 状态 | 证据 |
| --- | --- | --- |
| `learnerId` 仍是内部主键 | ✅ | `learners` + `learner_sessions.learner_id`，ID 由 `randomUUID()` 生成（`identity-service.ts:46-48`） |
| `provider + providerUserId` 是外部身份唯一键 | ✅ | 部分唯一索引 `idx_provider_connections_provider_user_identity`（`060_zhihu_canonical_identity.sql:40-42`） |
| OAuth Token 不能作为用户 ID | ✅ | 显式注释"never derive identity from a token"（`zhihu-gateway.ts:167-169`） |
| 未登录只能访问认证接口和静态资源 | 🟡 | 门禁只覆盖 `/api/product/` 前缀路径（`app.ts:90`） |

### T0.2 知乎鉴权分层 —— 🟡 部分完成

计划要拆成 `ZhihuOAuthClient` 与 `ZhihuDeveloperClient` 两个明确分离的客户端。
实际是**两个类但边界不同**：

- `ZhihuGateway` 608 行（`zhihu-gateway.ts:130-608`）同时承担 OAuth 授权/回调、Token 加解密、身份 rebind、
  同步任务、游标管理、数据库写入和 Data Platform HTTP 请求。
- `ZhihuOpenApiClient`（`zhihu-openapi.ts`）承担 Data Platform 的检索/直答类接口。

即：**OAuth 与数据访问确实分开了，但"开发者客户端"这一层没有独立出来**，
业务适配器（identity/source/pdf/research）更是完全没有目录化。

请求头分发实际情况：

| 调用方 | `Authorization: Bearer` | `X-Request-Timestamp` | `X-OAuth-Token` |
| --- | --- | --- | --- |
| `ZhihuOpenApiClient`（检索/直答/文章） | ✅ `zhihu-openapi.ts:102` | ✅ `:103` | ❌ |
| `ZhihuPdfParseAdapter` | ✅ `zhihu-pdf-parse.ts:55` | ✅ `:55` | ❌ |
| `ZhihuGateway.authorizedUserPage`（收藏/自有内容） | ✅ `zhihu-gateway.ts:476` | ✅ `:478` | ✅ `:477` |
| OAuth `/access_token` | ❌（form 传 `app_id`/`app_key`） | ❌ | ❌ |

双凭证模式**只应用在 2 个用户数据接口上**，与计划一致（这两处确实是唯一读登录用户数据的地方）。

### T0.3 Feature Flags —— 🟡 部分完成

9 个 flag 中 **8 个已实现，`ZHIHU_RESEARCH_ENABLED` 全仓库零命中**。

| Flag | 状态 | 证据 |
| --- | --- | --- |
| `SIGNED_DEVICE_SESSION_ENABLED` | ✅ | `config.ts:82/110/205` |
| `ZHIHU_LOGIN_REQUIRED` | ✅ | `config.ts:83/112/206` |
| `ZHIHU_OAUTH_ENABLED` | ✅ | `config.ts:85/111/210` |
| `ZHIHU_PDF_PARSE_ENABLED` | 🟡 | 代码已读（`config.ts:40/163` → `server.ts:36`），但**未进任何部署产物** |
| `ZHIHU_SOURCE_SYNC_ENABLED` | ✅ | `config.ts:86/211` |
| `ZHIHU_RESEARCH_ENABLED` | ⬜ | 不存在 |
| `PLANNER_ASSESSMENT_V2_ENABLED` | ✅ | `config.ts:84/209` → `agent-planning.ts:776,778` |
| `PRACTICE_CARD_V2_ENABLED` | ✅ | `config.ts:87/212` |
| `MIXED_GYM_ENABLED` | ✅ | `config.ts:88/213` |

依赖校验（`config.ts:110-126`）—— 计划要求的四条**全部已实现**：

```text
ZHIHU_LOGIN_REQUIRED  → SIGNED_DEVICE_SESSION_ENABLED   ✅ :118
ZHIHU_LOGIN_REQUIRED  → ZHIHU_OAUTH_ENABLED             ✅ :119
ZHIHU_OAUTH_ENABLED   → SIGNED_DEVICE_SESSION_ENABLED   ✅ :117
ZHIHU_SOURCE_SYNC_ENABLED → ZHIHU_OAUTH_ENABLED         ✅ :120
MIXED_GYM_ENABLED → PRACTICE_CARD_V2_ENABLED            ✅ :121
```

**缺失的两条**：`source_sync → Access Secret` 与 `pdf_parse → Access Secret` 都没有校验，
即 `ZHIXING_ZHIHU_ACCESS_SECRET` 为空时仍可开启这两个 flag，运行时才失败。

### T0.4 部署产物与代码不同步 —— ⚠️

计划 T2.2 要求删除的旧配置路径，**在代码里删了，但在发布产物里还在**：

```
backend/.env.example:40-44
deploy/backend.env.example:49-53
.github/workflows/ci.yml:185          ← 仍主动写入部署用的 backend.env
```

`ci.yml:185` 一行同时写出 `ZHIHU_OAUTH_USER_PATH=/user`、`ZHIHU_OAUTH_COLLECTIONS_PATH=/user/collections`、
`ZHIHU_OAUTH_COLLECTION_ITEMS_PATH=/user/collection/{collection_id}`、`ZHIHU_OAUTH_CONTENT_PATH=/user/content`、
`ZHIHU_OAUTH_MOMENTS_PATH=/user/moments`。这些值现在已无人读取，但会随部署进入生产配置，
正是计划里"避免生产环境再次配置成不存在的接口"要根除的情况。

---

## 五、M1 Planner 线上故障修复

> 这是计划里的第一优先级，可以独立发布。

### T1.1 三层协议 —— 🟡 部分完成

计划要求的 `AssessmentBlueprint` / `QuestionContent` / `FrozenAssessment` 三个类型名**不存在**，
但**能力以等价形式实现**，且题位分配**与计划完全一致**。

已实现：

- `AssessmentQuestionSlot`（`agent-planning.ts:242-248`）：`{id, position, dimensionKey, type, difficulty}`
  —— 字段名是 `id` 而非计划写的 `slotId`（`slotId` 只作为模型别名被接受，`:449`）。
- 三段式 provider 调用：`generateAssessmentDimensions`（`:275`/`:721-728`）→
  `generateAssessmentContent`（`:276`/`:730-742`）→ `prepareAssessment` 校验持久化（`:962-995`）。
- 维度数限制 4～5（`normalizeAssessmentDimensions`，`:365`）。
- 服务端题位分配 `v2Slots`（`:393-408`）**精确匹配计划**：4 维 → 4×3=12；5 维 → `3+3+2+2+2`=12。
- 场景题与三档难度覆盖由 `AssessmentSchema.superRefine` 强制（`:56-57`），
  每套 `threeQuestionPatterns` 都含 `advanced` 档的 `scenario`（`:394-399`）。

未实现：

- **"最多 3 道区分题"完全没有**。`v2Slots` 固定 12 题，没有任何增量逻辑。
  仅在 v1 旧路径的提示词里残留一句"只有基线证据存在明显不确定性时才增加 1-3 道区分题"（`:711`），
  那是 `generateAssessment` 单次调用路径，不走 v2 题位。

### T1.2 输出标准化层 —— 🟡 部分完成

计划要求的 `normalizeAssessmentDraft()` 函数不存在，但**每一项能力都有落点**：

| 计划要求 | 实现位置 |
| --- | --- |
| 移除 Markdown 代码块与 thinking | `structured()` `:545` + `stripThinking` `:293` |
| 接受字段别名、输出 camelCase | `questionCandidate` `:426-440` |
| 题目 ID 由服务端生成 | `randomUUID()` `:986` |
| 题干去重 | `accept()` `:930-931`，兜底再去重 `:951-956` |
| 统一选项格式 + 稳定 `value` | `normalizedOptions` `:410-421`（回退 `option-${index+1}`） |
| 超长文本安全截断 | `:436-438`（题干 1200 / criteria 400 / evidence 300） |
| 不补写参考答案 | `:430-431`，缺 `referenceAnswer` 直接返回 `null` |

**一处偏差**：计划要求"文本题自动移除错误的 `options`"，实现是**整题拒绝**而非清理 ——
`AssessmentQuestionSchema.superRefine`（`:44`）对 `short_text|scenario` 带 `options` 的情况记 issue，
该题被丢弃并由确定性模板替换。功能上安全，但会消耗题位。

### T1.3 局部校验与局部修复 —— ✅ 已完成

`generateAssessmentV2`（`:911-960`）严格按计划实现：

```text
内容生成 1 次 (:939)
→ accept() 逐题校验
→ 仅缺失题位回传 repair:{invalidSlotIds} (:941-945)   ← 修复 1 次
→ 仍缺失的由 fallbackQuestion 确定性补齐 (:948-958)    ← 不再调模型
```

模型调用上限成立：维度 1 次（`:913-921`，网络失败吞掉后用通用维度）、题目 1 次、修复最多 1 次，
之后纯确定性。`fallbackQuestion`（`:456-476`）保证产出的题一定能通过 `AssessmentQuestionSchema.parse`。

### T1.4 诊断评估器强化 —— 🟡 部分完成

已实现：

- 无效维度给保守评价：`fallbackEvaluation`（`:1068-1071`）返回 `level: 'exposed'|'unknown'`、
  `confidence: 0.45|0.2`、明确的 `nextValidation`。
- 评价器失败**不清除用户答案**（`:1063-1065`）。
- **不会永久卡在 `assessment_evaluating`**：`:1064` 重置回 `assessment_answering`，
  重启时 `recoverInterruptedDiagnostics`（`:780-791`）做同样的事。

未实现：

- **选择题不使用服务端规则判定**。`evaluateAssessment`（`:744-756`）把全部题目连同
  `rubric`/`referenceAnswer` 交给模型。服务端只有 `validateAnswer`（`:1017-1022`）校验答案**形状**，不判对错。
- **模型评价结果不做逐维度校验**。`AssessmentEvaluationSchema`（`:59-63`）只校验形状，
  从不检查返回的维度键是否与冻结的 `dimensions_json` 对应；多余或缺失的键会被静默接受，
  `assessmentFrom`（`:830`）对未知键回退用 `dimension.key` 当标题。

### T1.5 自动恢复失败任务 —— ⬜ 未开始

**全仓库没有任何代码查询 `failure_code = 'assessment_invalid_output'`**，
该字符串只作为抛错点出现在 `agent-planning.ts:717`。

计划要求的四件事全部缺失：找出失败测评、保留旧记录并标记 `superseded`、用户重开 Planner 时幂等创建 v2、
前端提示"已使用稳定生成协议重新准备测评"。

最接近的现有行为是 `prepareAssessment:972`——在**用户显式请求新测评**时把旧的 `failed` 标记为 `superseded`，
且创建按 `client_request_id` 幂等（`:966-967`）。这不是"用户打开 Planner 自动恢复"。

> **这是 M1 里唯一完全未动的一项，也是"发布 A"能否成立的关键。**

### T1.6 问答轮次调整 —— 🟡 部分完成

已实现：

- `baseline_turn_count` 约束放宽到 0..6（`059_planning_sessions_baseline_six.sql:24`），
  059 重建了表，055 里的 0..3 已被取代。
- 需求校准保持 5（`059:25`；`agent-planning.ts:1083`）。
- 最多 6 轮：`baselineReady` `:867`（`userTurns >= 6 ||`）、进度 `:845`、写入钳制 `:1204`。
- 提前结束条件：`:861-868` —— `userTurns >= 2 && directionClear && evidencedDimensions.size >= 2 && concreteSignal`。
- **单一维度 0.35 不会提前结束**：`:867` 要求 `size >= 2`，计划点名的问题已修复。

未实现：

- **"已找到最重要的待验证缺口"这一条没有**。`baselineReady` 从不检查
  `context.openQuestions` / `followUpTopic`。
- `concreteSignal`（`:865`）的判定过宽：任何简历、任何规划证据、或任意 ≥30 字符的摘录都能满足，
  因此**可能在关键缺口未解决时提前结束**。

### T1.7 Planner 测试 —— 🟡 部分完成

`backend/test/planner-diagnostic.test.ts` 已覆盖：

- 连续两次无效结构（`:129-169`，断言兜底补齐、12 题、`contentCalls.length === 2`）
- 维度缺失/重复 → 通用兜底（`:96-127`）
- 缺 rubric / 缺参考答案（`:142`）
- 兜底后仍有 12 道合法题（`:152`）
- 公开接口不含 `rubric` / `referenceAnswer`（`:157-158,177,218`）

**未覆盖**：维度存在但题量不足；选择题无选项；短答题错误带 `options`；题干重复去重；
DeepSeek 输出 Markdown 围栏 JSON（该测试只存在于 `writing-agent.test.ts:10-11`）；
**服务重启发生在 preparing/evaluating**（`recoverInterruptedDiagnostics` 无测试，`service_restarted` 在测试中零命中）。

### T1.8 公开接口的答案隔离 —— ✅ 已完成（附一处设计内例外）

`assessmentFrom`（`:820-833`）是所有测评接口和 SSE 的唯一序列化器，**不映射** `rubric_json`
和 `reference_answer_json`。`evaluation_json` 仅在终态（`completed`/`abandoned`）才暴露（`:827-828`）。

设计内例外：`getAssessmentReview`（`:886-898`）在终态且显式调用时返回 `referenceAnswer`（`:895`，
不返回 rubric），前端在 `PlanningAssessmentCard.vue:84` 展示"参考答案"。这与计划"答题流程中不暴露"一致。

---

## 六、M2 知乎数据访问层

### T2.1 正式响应格式 —— 🟡 部分完成

大写 `Code`/`Message`/`Data` 和 `Items` **已经能正确解析**，但**三处各写一遍，没有统一客户端**。

| 关注点 | openapi | gateway | pdf 适配器 |
| --- | --- | --- | --- |
| HTTP 状态 | `zhihu-openapi.ts:109-119` | `zhihu-gateway.ts:483-494` | `zhihu-pdf-parse.ts:58-62` |
| `Code !== 0` | `:39-44,50,120` | `:494` | `:62` |
| `30001` 限流 | `:41` | `:494` | **缺失**（落到 `zhihu_business_error`） |
| `30002` 额度不足 | `:42` | `:494` | `:62` |
| 无效 JSON | `:112-115` | `:490` | `:60` |
| 超时/网络 | `:96-97,124` | **缺失**（无 `signal`/timeout） | `:53,64` |
| 重试 | 无 | 仅 429，4 次 | 无 |
| 日志脱敏 | 无 | 无 | 无 |

- **`ZhihuEnvelope<T>` 类型不存在**，全仓库零命中；每处都从 `Record<string, unknown>` 重新推导。
- 小写旧格式被**有意保留**以兼容（`zhihu-openapi.ts:60-62`，`test/zhihu-openapi.test.ts:47-51`）。
- **没有脱敏设施**。安全性靠"从不回显 provider 文本"：错误消息全是静态字符串，
  测试断言密钥和原始响应体不出现在结果中。provider 的 `Message` 从不向外传播。
- gateway **完全没有超时**（`:474-481`、`:519-528`、`:530-539` 均无 `signal`）。
- `updateToken`（`:572-580`）**零调用者是死代码**；`refresh_token` 已解析（`:10`）但从未使用。

### T2.2 删除错误接口配置 —— 🟡 部分完成

- `backend/src/config.ts` **已不再读取**那五个 `ZHIHU_OAUTH_*_PATH`，路径改为代码内字面量
  （`config.ts:198-202`：`/api/v1/user/collections`、`/api/v1/user/favlists`、`/api/v1/user/favlist_contents` 等），
  只有 `ZHIHU_OAUTH_AUTHORIZE_PATH` / `ZHIHU_OAUTH_TOKEN_PATH` 仍由 env 驱动（`:196-197`）。
- 但**旧 env 名仍在三个发布产物中存活**（见 T0.4）。
- **"服务端固定、版本化的能力目录"未做**：没有 catalog 模块，路径是 `LabConfig` 上的扁平字段
  （`:73-79`）复制进 `ZhihuGatewayOptions`（`zhihu-gateway.ts:63-67`）后直接使用（`:401,410`）。
- `zhihuArticlePath`（`ZHIXING_ZHIHU_ARTICLE_PATH`）仍存在且仍被使用：
  `config.ts:39,162` → `server.ts:35` → `zhihu-openapi.ts:176-178`，为空时抛 `zhihu_capability_disabled`。
  默认空并在注释里写明"No official article-body endpoint was confirmed"。

### T2.3 Gateway 模块化 —— ⬜ 未开始

`backend/src/zhihu/` 目录**不存在**，计划列出的 9 个文件（`oauth-client.ts`、`developer-client.ts`、
`identity-adapter.ts`、`source-adapter.ts`、`pdf-adapter.ts`、`research-adapter.ts`、`schemas.ts`、
`errors.ts`、`redaction.ts`）**一个都没有**。

实际边界与计划相反：OAuth 授权/回调、Token 加解密、身份 rebind、同步任务、游标和 Data Platform HTTP
全部挤在一个 608 行的 `ZhihuGateway` 里。

另外存在**两套并行错误体系**：`ZhihuOpenApiError`（`zhihu-openapi.ts:4-9`，被 openapi 和 pdf 适配器使用）
与 `LabError`（`backend/src/errors.ts:1-12`，被 gateway 使用）。

共享客户端清单（计划要求 vs 实际）：

| 能力 | 状态 |
| --- | --- |
| 加鉴权头 | 🟡 各自实现 |
| 请求和超时 | 🟡 openapi/pdf 有，gateway 无 |
| Envelope 解析 | 🟡 三份重复 |
| 错误映射 | 🟡 三种方言 |
| 一次安全重试 | ⬜ 开发者客户端与 PDF 适配器均无 |
| 配额和限流处理 | 🟡 gateway 有 429 退避，非"一次"也不覆盖 5xx/网络 |

### T2.4 Fake Zhihu Provider —— ⬜ 未开始（作为模块）

不存在 `FakeZhihuProvider` 类。三种 fake 机制各自内联：`fetchImpl` 注入、`globalThis.fetch` 打桩、
以及 `FakeSourceProvider`（`case-source-snapshot.test.ts:14-15`，只是个文本 provider）。

计划的场景矩阵**覆盖情况好于预期**，但有两个真实缺口：

| 场景 | 状态 |
| --- | --- |
| OAuth 授权回调 | ✅ `identity-oauth.test.ts:93-157,252-298` |
| Token 交换 | ✅ `:98,124,146,264-267` |
| **Token 过期** | 🟡 `expires_in` 已持久化（`zhihu-gateway.ts:207`），但无刷新路径，无过期测试 |
| **收藏分页** | 🟡 收藏只取一次 `Limit: '20'`，不跟游标（`:401-404`）；只有自有内容分页被循环 |
| PDF 异步状态 | ✅ `zhihu-pdf-parse.test.ts:11-44` |
| 搜索无结果 | ✅ `zhihu-openapi.test.ts:72-76` |
| 429 | ✅ `:96-112`，`Retry-After` 被遵守（`identity-oauth.test.ts:272-274,295`） |
| 额度不足 | ✅ `zhihu-openapi.test.ts:79-80,132-140` |
| 无效 JSON | ✅ `:114-130,142-152` |

**普通 CI 不调用真实知乎是靠约定而非强制**：CI 不带知乎 base URL 和密钥，故 `configured` 为 false，
每个测试自行注入 fake。没有任何网络阻断或 fake-provider 开关来强制这一点。

---

## 七、M3 正式登录系统

### T3.1 数据迁移 —— ⬜ 未完成（计划中的表结构不存在）

计划的 `059_zhihu_login_identity.sql` 从未创建（本仓库 059 是 `planning_sessions_baseline_six`）。
实际表结构在 056 和 060：

| 计划要求 | 实际 | 状态 |
| --- | --- | --- |
| 重建 `learner_sessions`，`learner_id` 可为空 | `learner_id TEXT NOT NULL`（`056:1-18`），无 bootstrap 会话 | ⬜ |
| `auth_stage` / `authenticated_at` / `revoked_at` | 三个字段都不存在 | ⬜ |
| `oauth_authorization_states` 关联 `learner_session_id` | 仍以 `learner_id NOT NULL` 为键（`056`） | ⬜ |
| state 只存哈希 / 5 分钟 / 只消费一次 | ✅ 哈希（`zhihu-gateway.ts:147-148`）、5 分钟（`:148`）、`consumed_at` 单次（`:177-180`） | ✅ |
| 新增 `provider_accounts` 表 | **全仓库不存在** | ⬜ |
| `provider_connections` 关联 `provider_account_id` | 仍以自身 `id` 为键 | ⬜ |
| `last_verified_at` / `reauthorization_required_at` | 只有 `status`，两字段均缺 | ⬜ |
| AES-256-GCM Token 加密 | ✅ `token_ciphertext`/`token_iv`/`token_tag`（`zhihu-gateway.ts:606-607`） | ✅ |

即：**计划的"以 `provider_accounts` 为中心"的身份模型没有建立**，现存的是更早的
"056 身份来源 + 060 canonical identity"设计。

### T3.2 稳定知乎身份门禁 —— 🟡 部分完成（错误码名称不符）

核心要求**已正确实现**：

- 身份**只**来自 OAuth token 响应的 `uid`：`stableProviderId(token.uid)`（`zhihu-gateway.ts:171`，
  `uid` 在 schema `:13`，`stableProviderId` 在 `:104-108`）。
- 不使用 token 哈希/昵称/头像/主页 URL 推断身份：`endpointIdentity` 硬编码为 `null`（`:170`），
  测试断言 `/user` **从未被请求**（`identity-oauth.test.ts:321`）。
- 旧的 `oauth-<24hex>` token 哈希 ID 被 `060:11-17` 显式清除。

**唯一不符**：缺失 `uid` 时抛的错误码是 **`oauth_provider_identity_unavailable`**（`zhihu-gateway.ts:172`，
status 502，`retryable` 默认 false），而计划明确要求 `zhihu_identity_unavailable`。后者全仓库零命中。

另注：`profile_json` 在回调中**总是写入 `'{}'`**，因为 `endpointIdentity.profile` 恒为 null（`:208`）；
存储的真实 profile 只来自测试插入。

### T3.3 兼容现有用户数据 —— 🟡 部分完成（(c) 未实现且行为有风险）

`zhihu-gateway.ts:181-211` 的逻辑：

| 场景 | 状态 | 实际行为 |
| --- | --- | --- |
| (a) 设备 learner 未绑定 → 绑到当前 learner | ✅ | `canonicalLearnerId = learnerId`（`:185`），`app.ts:309` rebind 到同一 learner，路线/卡片保留 |
| (b) 该知乎账号已绑定另一 learner → 切到已有 learner | ✅ | `existing?.learnerId ?? learnerId`（`:185`）+ `identity.rebind`（`app.ts:309`），测试 `identity-oauth.test.ts:93-116` |
| (c) 两边都有学习数据 → 不自动合并，记录 `identity_merge_required` | ⬜ | **未实现** |

**(c) 的实际行为值得注意**：当当前 learner 已持有另一个知乎账号、而新 uid 未被绑定时，
代码会**静默新建一个空 learner**（`canonicalLearnerId = randomUUID(); ensureLearner(...)`，`:190-193`）
并把会话移过去（`app.ts:309-310`）。既不合并，也不记录任何标记 ——
`identity_merge_required` 在全仓库零命中，也没有任何后台脚本消费这样的标记。
**用户会感觉自己的学习数据"消失"了。**

### T3.4 认证 API —— 🟡 部分完成

路由仅在 `identityService && signedDeviceSessionEnabled` 时注册（`app.ts:137-141`），
OAuth 路由仅在 `zhihuOauthEnabled` 时注册（`:298`）。

| 端点 | 状态 | 证据 |
| --- | --- | --- |
| `POST /api/auth/session` | ✅ | `app.ts:292-295` |
| `GET /api/auth/session` | ✅ | `app.ts:287-291` |
| **`GET /api/auth/me`** | ⬜ | 前后端均零命中 |
| `POST /api/auth/oauth/zhihu/start` | ✅ | `app.ts:300` → `zhihu.start()`（`zhihu-gateway.ts:139-158`） |
| `GET /api/auth/oauth/zhihu/callback` | ✅ | `app.ts:301-316`，302 到 `/settings` |
| **`POST /api/auth/logout`** | ⬜ | 零命中；**不存在任何会话失效路径**（`revoked_at` 字段也没有） |
| `DELETE /api/auth/connections/zhihu` | ✅ | `app.ts:299` → `disconnect()`（`zhihu-gateway.ts:359-382`） |

计划外已有端点：`GET /api/auth/connections`（`:297`）、source-sync / source-library 路由（`:318-327`）。

### T3.5 前端 Auth Gate —— 🟡 部分完成（多处与计划冲突）

| 计划 | 状态 | 实际 |
| --- | --- | --- |
| `AuthGateView` / `OAuthPendingView` / `OAuthResultView` | ⬜ | 三个视图**都不存在**，只有 `AuthView.vue` |
| 未认证访问业务页 → `/login` | 🟡 | 路由**是 `/auth` 不是 `/login`**（`router/index.ts:10`），`/login` 在 `frontend/src` 零命中；`/settings` 被标为 `meta.public`（`:25`）值得复核 |
| 已认证访问 `/login` → `/overview` | ✅ | guard `:41` + `AuthView.vue:26` |
| OAuth 成功 → 返回原始目标页或 `/overview` | 🟡 | 无 result 视图；`SettingsView.vue:42-53` 处理 `?connection=zhihu&result=success` 后经 `readOAuthReturnPath()` 跳转。后端**总是**把回调重定向到 `/settings`（`app.ts:311,314`），所以"原页面"是 sessionStorage 往返而非直接重定向 |
| **OAuth 失败 → 登录页显示安全错误码** | ⚠️ | 失败**停留在 `/settings`**，显示 `知乎授权失败：${oauthFailureMessage(reason)}`（`SettingsView.vue:52`） |
| **`reauthorization_required` → 登录页显示"重新授权"** | ⬜ | 前端 `reauthorization_required` **零命中**（后端在 `zhihu-gateway.ts:485` 发出）；`zhihu_auth_required`（`app.ts:91`）也未处理；`api/client.ts:24-55` 无 401 拦截器 |
| 删除 bootstrapSession 失败后放行旧流程的逻辑 | ⚠️ | **仍在**：`main.ts:12-14` 无条件挂载（`.finally(() => app.mount('#app'))`），注释写着"Bootstrap failure is non-fatal while the legacy rollout flag remains enabled" |

不过路由守卫现在确实会拦住业务路由（`index.ts:44`，测试 `index.spec.ts:68-75`），
所以这个"逃生舱"只剩 `/auth` 和 `/settings` 两个公开路由。

### T3.6 安全验收 —— 🟡 大部分达标

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 伪造 `X-Learner-Id` 无效 | ✅ | `onRequest` 用会话覆盖 `x-authenticated-learner-id`（`app.ts:88`），`learnerId()` 只读该头（`:269-271`），测试 `identity-oauth.test.ts:72-78`。**注意仅在 `signedDeviceSessionEnabled` 下成立** |
| 无 Cookie 不能访问业务数据 | 🟡 | 缺失/非法会话返回 401 `session_required`（`app.ts:85-87`），豁免仅 `POST /api/auth/session` 与 OAuth 回调（`:76-77,83`）。**但 `zhihuLoginRequired` 门禁只覆盖 `/api/product/`**（`:90`） |
| OAuth state 不可重放 | ✅ | 事务内检查并置 `consumed_at`，`changes !== 1` 保护（`zhihu-gateway.ts:177-180`），并发测试 `identity-oauth.test.ts:158-177` |
| state 不可跨浏览器消费 | 🟡 | 回调要求 state 的 `learner_id` 等于 cookie 会话的 learner（`zhihu-gateway.ts:162`，`app.ts:306-308`），浏览器 B 会被拒（`identity-oauth.test.ts:283`）；但**绑定的是 `learner_id` 而非计划要求的 `learner_session_id`** |
| Token/App Key/Access Secret 不入日志 | ✅ | gateway 完全无日志；全局错误处理只在非生产打印 `name: message`（`app.ts:104-105`）；测试断言密文与存储 JSON 不含 token（`identity-oauth.test.ts:138,215,286-287`） |
| 两个浏览器登录不同知乎账号数据隔离 | ⬜ | **无集成测试** |
| 退出登录后旧 Cookie 立即失效 | ⬜ | **无 logout 端点，无法验** |
| HTTP IP 下 Cookie 行为符合已接受的限制 | ✅ | `config.ts:126` + `deploy/backend.env.example:33-35,42` 的 `ALLOW_INSECURE_OAUTH_CALLBACK` |

> 计划提到 **App Key 曾出现在对话中，生产发布前应轮换**。此事未见任何代码或文档记录，仍需执行。

---

## 八、M4 知乎 PDF 解析

### T4.1 数据迁移 —— 🟡 部分完成（设计已变更）

**`resume_parse_jobs` 表不存在**（全仓库零命中）。解析状态改为 `learner_resume_documents` 上的列：

- `061_resume_pdf_parse_state.sql:14` `parse_status CHECK IN ('pending','processing','ready','failed')`
- `:19` `parse_lease_until`；`:46` 恢复索引 `(parse_status, parse_lease_until, updated_at)`
- `062` 加 `parse_provider`、`parse_error_code`、`provider_task_id`
- `063` 加 `parse_lease_token` + fence 索引

计划字段的缺失清单：`id`、`document_id`、`provider_file_id`、`progress`、`idempotency_key`、
`result_schema_version`、`started_at`、`completed_at`、`parser_kind`、`parse_job_id`、
`source_page_count`、`parsed_blocks_json`。

**敏感数据不落库 —— ✅ 已做到**：短时结果 URL 在适配器内部消费后丢弃
（`zhihu-pdf-parse.ts:13` 注释"IDs, URLs and source bytes never leave this adapter"），
只返回 `pageCount` + `text`；原始供应商错误体不存，只存映射后的 code（`:58-64` → `parse_error_code`）；
Access Secret 仅作请求头使用；**完全没有 base64 图片处理**。

### T4.2 后端流程 —— 🟡 部分完成

| 计划 | 状态 | 证据 |
| --- | --- | --- |
| `POST .../resume` 返回 **202** | ⚠️ | 实际返回 **201**（`app.ts:161`），`parseStatus='pending'`（`product-repository.ts:656`） |
| 本地检查 `%PDF-` | ✅ | `planning.ts:137` |
| SHA-256 幂等去重 | 🟡 | SHA-256 已算（`:119,129,139`）并用作 provider 的 `Idempotency-Key`（`zhihu-pdf-parse.ts:24`），**但上传幂等实际以 `clientRequestId` 为键**（`:106-108`，`product-repository.ts:650`） |
| 上传/建任务/轮询/下载/转文本 | ✅ | `zhihu-pdf-parse.ts:23-24,32-45,80-82` |
| 写入 Resume Context | ✅ | `product-repository.ts:669-676` → `ensureResumeChunks`（`:596-613`） |
| 后台 worker + 重启恢复 + 租约 fencing | ✅ | `planning.ts:149,150-172`；`product-repository.ts:663-667,678` |
| 临时文件按策略删除 | ⚠️ | `.uploading` 改名后**无限保留**（`planning.ts:115-118,138`），仅上传失败时删除（`:144`）。无保留策略，且测试断言历史文件被保留（`resume.test.ts:42-54`） |

### T4.3 降级策略 —— 🟡 部分完成

降级链**正确**：知乎优先 → 任何 provider 错误回落本地 pdfjs（`planning.ts:155-166`）→
两者都失败则 `parseStatus='failed'`（`:170`，`product-repository.ts:679`）。30002 额度不足已映射为回落触发条件。

**但用户提示未分档**：`failResumeParse` 硬编码 `parse_error='简历解析失败'`（`:679`），
`ResumeTextUnavailableError` 的描述性消息（`resume-parser.ts:18`）被丢弃。
前端只有 4 个状态标签（`PlanningProfilePanel.vue:10-12`）加一句通用的
`解析失败，可重新选择 PDF 重试。`（`:22`）。

**扫描版 PDF 的分支实际上是死代码**：`planningAgent.ts:180-181` 依赖 API 错误码
`resume_text_unavailable`，但异步端点**永远不会返回它**（解析失败发生在 201 之后）。
额度不足、可重试等区分消息同样缺失。

### T4.4 前端 —— 🟡 部分完成

已有：上传中（`PlanningProfilePanel.vue:22`）、`pending`="等待解析"、`processing`="解析中"、
`ready`="完成"、`failed`="失败，可重试"（`:10-12`），以及"正在等待解析结果…"。

缺失：排队态、数值进度（计划的 35%）、"整理画像"态。

**刷新后续轮询不重传 —— ✅ 已做**：`planningAgent.ts:198` 在加载时调 `pollResumeStatus(id)`，
轮询循环在 `:82-112`。

---

## 九、M5 用户收藏与来源库

### T5.1 正式接口与双凭证 —— 🟡 部分完成

- 上游路径已配置：`config.ts:198-202`（`/api/v1/user/collections`、`/contents`、`/followees`、
  `/favlists`、`/favlist_contents`）。
- **双凭证已正确发送**：读登录用户数据时同时带 `Authorization: Bearer <accessSecret>` 和
  `X-OAuth-Token`（`zhihu-gateway.ts:474-481`）。
- 自有 API 端点是 `/api/product/source-collections`、`/source-items`、`/source-search`（`app.ts:324-327`），
  **不是**计划写的 `/api/v1/...`（那组是上游知乎路径）。

### T5.2 快速同步与完整同步 —— 🟡 部分完成

| 计划 | 状态 | 证据 |
| --- | --- | --- |
| 收藏最近条目 | ✅ | `collectionsPath`，`Limit: '20'`（`zhihu-gateway.ts:400-403`） |
| 收藏夹列表 + 每个收藏夹第一页 | ⬜ | `favlistsPath` / `favlistContentsPath` **只声明从未调用**（`:66-67`，全文件仅 2 处出现） |
| 后台分页同步 | 🟡 | 自有内容分页 Offset/Limit 50（`:407-415`），**上限 200 条**（`offset < 200`）而计划要求 5000 |
| 每页保存 NextOffset | ✅ | `:412,462`（游标 JSON 与数据同事务提交） |
| 429 指数退避 | ✅ | `:519-528`（250·2^n + jitter，遵守 `Retry-After`） |
| 重启从 offset 恢复 | ✅ | `:271-276` 重新入队 + `:407` 读检查点 |
| 完整同步后才标远端删除 | ✅ | 删除扫描在自有内容循环之后、`try` 内（`:416-421`）；中途失败进 catch（`:427`）跳过 |

### T5.3 摘要策略 —— ✅ 已完成（附一处越界）

- 官方 `Title`/`Summary` 原样存储，不逐条调模型：`:443-456`（`excerpt = item.excerpt ?? item.summary`，
  `content_json` 只留 `{externalId, sourceKind, publishedAt}`）。
- SourceDigest 只为被卡片选中的条目生成：`mixed-gym-service.ts:53-54`。
- 不伪造全文：只做 HTML 剥离并截断 1200 字符（`:369-378`），测试断言脚本载荷被剥离（`mixed-gym.test.ts:116-126`）。

**一处越界**：计划要求"自有创作才能用'我的创作全文'接口，任意收藏文章不能错误调用"。
`digestFor` 对**任意**被选中的来源都调 `sourceContent.fetchArticle`（`:363-368`）。
当前因为 article 端点默认未配置（`config.ts:161-162`）总是抛错并回落摘要，
所以**暂时没有实际危害**，但一旦配置了该端点，收藏文章就会走错接口。

### T5.4 来源排序 —— 🟡 部分完成

已实现：仅收藏候选（`LIMIT 80`，无分层），相关性 = `overlap*0.8 + sourceWeight(0.04–0.18) + quality(≥0.14)`，
阈值 `>= 0.65`，最终 `slice(0, 2)`（`mixed-gym-service.ts:344-361,53`）。

未实现：知乎搜索 10 / 全网搜索 10 / 问题候选 5（**均未调用**）；无去重步骤；
权重与计划的 45/20/15/10/10 模型完全不同；`published_at` 已存储但未参与排序。

阈值 0.65 与"最多采用两个来源" —— ✅ 已做。

### T5.5 隐私 —— 🟡 部分完成

- 所有收藏查询按 `learner_id` 过滤：`zhihu-gateway.ts:292-299,306-311,281-287,353`；
  跨用户归属检查在 `agent-planning.ts:1686,1697`。
- 断开连接时删除无引用私有来源、对有引用者置 `content_json='{}'`/`status='removed'` 并保留引用 —— ✅ `:359-382`。
- 卡片公开文档只暴露 id/title/author/canonicalUrl（`mixed-gym-service.ts:19,61-63`）。
- **数据库层面的跨用户隔离测试缺失**：`backend/test` 中对 `source-collections`/`source-items`/`source-syncs`
  零命中；`identity-oauth.test.ts` 只覆盖 OAuth state 与身份。
- "收藏只能说明兴趣，不写成能力已掌握"：无专项文案测试（最接近的是 tutor/planner 提示词里的通用约束）。

---

## 十、M6 搜索、直答和问题发现

> **这是整体进度最靠后的模块。`ZHIHU_RESEARCH_ENABLED` 不存在，能力只有一个孤立入口。**

### T6.1 Research Gateway —— 🟡 部分完成

不存在 `ZhihuResearchGateway` 接口，`searchZhihu` / `searchGlobal` / `answerWithZhida` / `getQuota`
四个名字全部零命中。等价能力散落在 `ZhihuOpenApiClient`：
`search`（`:129`）、`globalSearch`（`:136`）、`recommendQuestions`（`:151`）、`questionAnswers`（`:161`）、
`fetchArticle`（`:173`）、直答经 `research()` 使用 `zhida-agent`（`:184-194`）。

**`getQuota` 不存在，也没有任何配额记账**（只有 `30002 → zhihu_quota_exhausted` 的映射）。

### T6.2 使用门禁 —— 🟡 部分完成（隐式成立，无显式守卫）

四个禁止阶段都在枚举里（`agent-planning.ts:234`）。知乎实际上只有一处调用点：
`agent-planning.ts:1690`（`knowledgeRoute`），而对 agent 路线节点的访问只可能在就绪之后
（`:1259-1260` 要求测评完成 + 需求摘要已确认）。

所以"构造上不可达"成立，但**没有任何显式的 allow/deny 检查**（无 `zhihuAllowed`、无阶段白名单）。
测评路径本身确实从不调用知乎。

### T6.3 路线生成中的用法 —— 🟡 部分完成

`knowledgeRoute`（`:1685-1692`）已实现：`research()` → 拆最多 3 个 query → 并行 `search()`（各 5 条）
→ 按 URL 去重 → 取前 3 → 存 `knowledge_route_sets.research_json` + `knowledge_route_items`
（角色 foundation/case/extension + `learning_question`）。

未实现：

- **`globalSearch` 从未被调用**（计划的"全网搜找官方/近期信息"缺失）。
- **无 `ResearchDigest` 类型**，`research_json` 存的是自由文本 + queries。
- **路线生成时不跑研究，Planner 也不读 digest**：Planner 提示词只消费用户证据与测评结果
  （`:647,1259-1260`），计划的"Planner 只读取 ResearchDigest"未实现。
- 缓存只有 route-set 指纹，不是 24 小时查询缓存。
- 无结果时直接抛 `zhihu_empty_result`（`:1690`），没有降级。

### T6.4 实践卡片中的用法 —— 🟡 部分完成

已实现：CardIntent（`mixed-gym-service.ts:316-331`）→ 收藏候选（`:53,344`）→
SourceDigest（`:363-385`）→ 卡片生成（`:56-59`，`practice-card-generator.ts:78-103`）。

未实现：**知乎搜、全网搜、问题发现、直答在卡片链路里全部缺失**；无每次调用的上限。

**直答模型分档未做**：`zhida-agent` **硬编码**（`zhihu-openapi.ts:185`），
`zhida-fast-1p5` 与 `zhida-thinking-1p5` 全仓库零命中，也没有任何模型选择逻辑。

### T6.5 问题发现的三个落点 —— ⬜ 未开始

`recommendQuestions`（`:151`）与 `questionAnswers`（`:161`）**定义但零调用者**。
三个落点（卡片场景题、Gym 后复习问题、写作选题）**一个都没做**。

"不用于诊断测评"是**空洞地成立**——测评流程只用模型 provider，根本不碰知乎。

### T6.6 配额和缓存 —— ⬜ 未开始（大部分）

- 24 小时查询缓存只存在于 **legacy CLI 路径**（`retrieval.ts:73,79-81`，
  `config.retrievalCacheTtlMs` = 24h，`config.ts:167`）。Data Platform 检索路径**绕过它**
  （`zhihu-gateway.ts:315-349` 每次直连）。
- 每卡"一次知乎搜 / 一次全网搜 / 一次直答"的计数与守卫：**无**。
- 80% 配额停止非必要直答：**无配额跟踪**。
- 额度不足降级为收藏 + 缓存：未实现。
- SourceDigest 只存 `sourceItemId`（`mixed-gym-service.ts:376`，落 `source_digests` 表，
  `057_practice_cards.sql:20-23`），**不记录上游 query/intent，无法追溯**。

---

## 十一、M7 前端完整体验

### T7.1 登录页 —— 🟡 部分完成

已存在 `frontend/src/views/AuthView.vue`，但**路由是 `/auth` 而非 `/login`**（`router/index.ts:10`）。

| 计划 | 状态 | 实际 |
| --- | --- | --- |
| 产品价值简介 | ✅ | `AuthView.vue:37` |
| 数据权限说明 | ✅ | `:38`（"知乎账号只用于确认你的身份…不会替代你的学习证据"） |
| 按钮文案"使用知乎登录" | 🟡 | 实际是**"使用知乎继续"**（`:40`），且有测试锁定当前文案（`AuthView.spec.ts:46`） |
| **HTTP 回调风险提示（设置页可见）** | ⬜ | 前端**完全没有**；`SettingsView.vue` 里也没有。只有后端守卫（`config.ts:126`） |

### T7.2 Planner —— 🟡 部分完成，**含三处与计划冲突**

**进度步骤**：结构对，**文案不对**。`planning-flow.ts:6-11` 定义的是 `基线 / 评估 / 需求 / 路线`，
计划要求 `了解你 / 水平诊断 / 确认目标 / 生成路线`。渲染于 `PlanningProgress.vue:13-16`。

**基线展示**：

| 计划 | 状态 |
| --- | --- |
| 当前第几轮 / 最多 6 轮 | ✅ `PlanningProgress.vue:20,22`，`baselineTurnMaximum = 6`（`planning-flow.ts:4`） |
| 已获得哪些证据 | 🟡 `PlanningProfilePanel.vue:22` 只显示**来源类型徽章**（`user_message`/`resume`/`diagnostic_assessment`/`lab`），无逐条摘要 |
| 为什么还需要继续追问 | ⬜ 无任何说明文案 |

**诊断失败的三个冲突点**：

| 计划 | 状态 | 实际 |
| --- | --- | --- |
| 自动重试 v2 | ⚠️ | **前端测试明确断言相反行为**：`planningAgent.spec.ts:91-93` "does not auto-create another assessment for a loaded failure, but retries once explicitly"。重试只能手动点按钮（`planningAgent.ts:233-242`） |
| 用兜底题集时仍进入答题 | ⚠️ | 兜底只在后端（契约文档 `:38-42`）。前端仅在 `status` 非终态时渲染答题（`PlanningAssessmentCard.vue:72`），`failed` 永远停留在错误卡片 |
| **不再只显示"评估暂时没有准备好"** | ⚠️ | **该字符串正是当前的错误卡片标题**：`PlanningAssessmentCard.vue:71`，变体在 `:35`、`planningAgent.ts:28,56,223`。测试只断言恢复句存在（`PlanningAssessmentCard.spec.ts:31`），**没有断言禁止标题不存在** |

### T7.3 PDF —— 🟡 部分完成

- 上传不阻塞整页 —— ✅ 上传在 aside（`PlanningProfilePanel.vue:22`），由局部 `uploadingResume` 驱动
  （`PlanningView.vue:25-36`），聊天/目标输入保持可用。
- 前端校验只有扩展名/mime（`ResumeUploadField.vue:19-24`），无大小限制。
- **解析完成后自动刷新 Planner Context —— 🟡**：`pollResumeStatus`（`planningAgent.ts:82-112`）会更新
  `session.value.resume` 并显示"已纳入规划上下文"，但**不重新拉取 planning session / profile / 下一题**。
  轮询上限 8 次（`:21,104`），到顶后显示"自动查询已暂停"。
- 解析内容参与题目设计：仅后端行为，前端只是展示。

### T7.4 内容库 —— 🟡 部分完成

| 计划 | 状态 | 证据 |
| --- | --- | --- |
| 放在 Settings 内，不新增顶级导航 | ✅ | `SettingsView.vue:62` `section#settings-library`，侧栏无入口（`AppSidebar.vue:10-19`） |
| 最近收藏 | ✅ | `:34,62` |
| 收藏夹 | ⬜ | 前端类型`learningExperience.ts:97-119` 无 favlist 概念 |
| 自己的内容 | ⬜ | `SourceItem` 无 kind 字段（`:109-119`），无 UI |
| 同步状态 | 🟡 | 只渲染最新一条 `syncs[0]?.status`（`:62`），无历史列表 |
| 最后同步时间 | ⬜ | `completedAt/startedAt` 存在（`:105`）但从未渲染 |
| 重新同步 | ✅ | `:38,62` |
| 解除知乎授权 | ✅ | `:31` + `ConnectionCard.vue` |

### T7.5 来源展示 —— 🟡 部分完成

- **卡片 —— ✅ 已做**：`PracticeCardSources.vue` 渲染标题（`:20`）、作者（`:20`）、
  来源类型中文化（`:9,:20`）、经 `safeExternalUrl` 守卫的原始链接（`:21`）、
  以及摘要/引用位置/采用原因/获取时间（`:22`）。接入 `UnifiedGymShell.vue:40`。
- **路线 —— ⬜ 未做**：节点只显示原始证据摘录，无标题/作者/类型/链接
  （`RouteView.vue:90`、`RoadmapDraftNode.vue:55-58`）；
  `RoadmapNode.evidence` 只有 `{sourceType, sourceId, excerpt}`（`types/product.ts:23`）；
  plan unit 上的 `sourceRefs`（`types/product.ts:8,16`）从未被渲染。
- `KnowledgeRoutePanel.vue:11` 展示每节点"3 picks"（含作者/标题/链接/摘要），
  但那是 **AI 建议的路线条目**，不是"实际采用的来源"，且缺 `sourceType`。

---

## 十二、发布顺序对照

| 阶段 | 计划的 Flag 变更 | 就绪度 | 阻塞项 |
| --- | --- | --- | --- |
| **A 线上诊断修复** | `PLANNER_ASSESSMENT_V2_ENABLED=true` | 🟡 | flag 已存在且默认 false；但 **T1.5 自动恢复未做**，已失败的 `assessment_invalid_output` 会话仍无法自动恢复 |
| **B 接口协议修正** | 保持来源同步关闭 | 🟡 | Envelope 已能解析；但旧路径仍在部署产物、无统一客户端、无脱敏设施 |
| **C 登录门禁** | `ZHIHU_LOGIN_REQUIRED=true` | 🟡 | flag 与依赖校验已就绪；**但 `provider_accounts` 表、`/auth/me`、`/auth/logout` 未做**，且 T3.3(c) 会静默新建空 learner |
| **D PDF** | `ZHIHU_PDF_PARSE_ENABLED=true` | 🟡 | 代码可用；**该 flag 未进任何部署产物**，无法在生产开启 |
| **E 收藏同步** | `ZHIHU_SOURCE_SYNC_ENABLED=true` | 🟡 | 收藏最近条目可用；**收藏夹分页未实现**，上限 200 而非 5000 |
| **F 搜索与直答** | `ZHIHU_RESEARCH_ENABLED=true` | ⬜ | **flag 不存在**，卡片链路无检索/直答，无配额记账 |

---

## 十三、验收标准对照

计划给出的端到端路径，逐步核对：

| # | 步骤 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 新浏览器打开网站 → 知乎登录页 | 🟡 | 是 `/auth`，非计划的 `/login`；无三个 Auth Gate 视图 |
| 2 | 完成 OAuth | ✅ | `app.ts:301-316` |
| 3 | 显示知乎资料 | 🟡 | `profile_json` 恒写 `'{}'`（`zhihu-gateway.ts:208`），真实资料取不到 |
| 4 | 上传扫描版 PDF | ✅ | 上传链路可用 |
| 5 | PDF 异步解析成功 | 🟡 | 异步+降级+重启恢复可用；扫描版提示是死代码 |
| 6 | Planner 完成 3～6 轮基线 | 🟡 | 0..6 已放开；但"最重要缺口已找到"未判，可能过早结束 |
| 7 | 稳定生成 12～15 道题 | ✅ | 12 题（4 维 4×3 / 5 维 3+3+2+2+2），兜底保证合法 |
| 8 | 分批作答并完成评价 | 🟡 | 不卡死、不清答案已做；选择题无服务端判定，维度键不校验 |
| 9 | 确认需求摘要 | ✅ | 上限 5 轮 `agent-planning.ts:1083` |
| 10 | 生成路线 | ✅ | — |
| 11 | 同步收藏 | 🟡 | 无收藏夹，上限 200 |
| 12 | 卡片采用收藏摘要 | ✅ | SourceDigest + 卡片来源面板 |
| 13 | 知乎搜/全网搜补充资料 | ⬜ | 卡片链路无检索；全网搜从未调用 |
| 14 | 完成知识题、Runtime 和反思 | ✅ | 既有能力 |
| 15 | 能力证据回写 | ✅ | 既有能力 |

**横切验收项**：

| 验收项 | 状态 |
| --- | --- |
| 连续注入无效模型输出也不阻塞测评 | ✅ 后端已保证（T1.3） |
| 两个知乎账号数据完全隔离 | ⬜ 无集成测试 |
| 页面/日志无 Token、App Key、Access Secret、rubric、参考答案 | ✅ 已做（附终态 review 端点的设计内例外） |
| 测评期间不能调搜索或直答拿答案 | 🟡 构造上成立，无显式门禁 |
| 收藏同步可分页恢复 | ✅ |
| PDF 任务可在服务重启后恢复 | ✅ 代码已做，**但无测试**（T1.7 缺口之一） |
| 后端测试、前端测试、类型检查、生产构建全部通过 | ✅ 前三项 2026-09-14 实测通过；**生产构建未在这次核对中执行** |
| 真实知乎测试只在受保护 Smoke 中执行 | 🟡 靠 CI 不配密钥的约定，无强制机制 |

---

## 十四、按优先级排列的缺口清单

### P0 —— 阻断计划里的"发布 A"

1. **T1.5 自动恢复失败测评**（⬜）。没有它，线上已失败的 `assessment_invalid_output` 会话不会自愈，
   "发布 A"的三个验证目标只达成两个。这是 M1 唯一完全未动的一项。
2. **T7.2 前端不进入答题态**（⚠️）。即使后端出了兜底题集，`failed` 状态在前端仍只显示错误卡片，
   而那张卡片的标题正是计划明令禁止的"评估暂时没有准备好"。
3. **T7.2 自动重试方向相反**（⚠️）。现有测试断言"不自动重试"，需要连同测试一起改。

### P1 —— 阻断"发布 C 登录门禁"

4. **T3.3(c) 静默新建空 learner**（⬜）。用户已绑定 A 账号后登录 B 账号，学习数据会"消失"。
   在没有 `identity_merge_required` 前，不建议开启 `ZHIHU_LOGIN_REQUIRED`。
5. **`POST /api/auth/logout` 与会话失效路径缺失**（⬜）。没有 `revoked_at` 字段，
   也删不掉旧 Cookie，T3.6 的"退出后旧 Cookie 立即失效"无法验收。
6. **`GET /api/auth/me` 缺失**（⬜），前端取不到正式用户资料。
7. **`provider_accounts` 表与 `learner_sessions` 重建未做**（⬜）。计划的身份模型没有建立，
   现在用的是 056/060 的旧模型。

### P2 —— 部署正确性

8. **`ci.yml:185` 仍写旧接口路径到生产配置**（⚠️）。会随部署进入生产 env。
9. **`ZHIHU_PDF_PARSE_ENABLED` 未进三个部署产物**（⬜），"发布 D"无法开启。
10. **`source_sync` / `pdf_parse` 未校验 Access Secret**（⬜），可配置成运行时才失败的组合。

### P3 —— M5/M6 能力补齐

11. **收藏夹（favlists / favlist_contents）声明未调用**（⬜），同步上限 200 而非 5000。
12. **来源排序分层与权重未按计划**（🟡），无去重、无检索候选。
13. **M6 整体**（⬜）：flag、Gateway 接口、配额记账、24h 缓存、直答模型分档、问题发现三落点。
14. **`fetchArticle` 对任意来源调用**（🟡），配置了 article 端点后收藏文章会走错接口。

### P4 —— 架构与测试债

15. **`backend/src/zhihu/` 模块化未开始**（⬜），HTTP 三处重复、无统一脱敏、gateway 无超时。
16. **T1.7 六个测试缺口**（🟡），含服务重启恢复的 zero 覆盖。
17. **跨用户数据隔离 DB 测试缺失**（⬜）。

---

## 十五、与计划的架构偏差（需要拍板）

以下几处实现**有意或无意地偏离了计划的设计**，不是单纯的"未完成"，建议明确取舍后再推进：

| 计划设计 | 实际实现 | 建议 |
| --- | --- | --- |
| 独立 `resume_parse_jobs` 表 | 解析状态做成 `learner_resume_documents` 的列 | 列方案更简单且已含租约/fencing，**建议保留现状并回写文档**，不追计划 |
| `provider_accounts` 独立表 | 身份直接挂在 `provider_connections` | 影响 T3.3 的合并语义；**建议先确认是否真的需要多身份模型**，再决定是否迁移 |
| `oauth_authorization_states` 关联 `learner_session_id` | 仍关联 `learner_id` | 影响跨浏览器绑定的严格性，成本低，**建议按计划改** |
| 统一 `ZhihuEnvelope` + 共享客户端 | 三处各自解析 | 直接关系 T2.1/T2.3 与脱敏；**建议按计划统一** |
| 路线研究产出 `ResearchDigest` 供 Planner 读取 | 只在路线节点按需生成 `research_json` | 涉及产品语义，**需要产品决策** |
| 上传返回 202 | 返回 201 | 契约细节，**建议按计划改** |

---

## 十六、文档边界

本文只做两件事：冻结闭环计划，记录**当前代码的真实进度**。

未覆盖：具体实现步骤拆分、Terra/Luna 并行分工的执行细节、每个测试的写法。
这些属于实施层，应在按优先级推进时另起任务文档，并随代码更新本文的状态列。

任何状态发生变化的条目，请连同 `文件:行号` 一并更新，保持本文可复核。
