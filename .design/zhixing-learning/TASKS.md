# Build Tasks: 知行黑客松 MVP

Generated from: `.design/zhixing-learning/DESIGN_BRIEF.md`
Date: 2026-08-28

本清单按纵向切片组织。每完成一个阶段，先按 [zhixing-delivery-plan.md](../../docs/zhixing-delivery-plan.md) 的评审模板审核，再开始下一项。

## 阶段 0：冻结

- [x] **建立阶段 0 数据包**：整理案例事实、知乎候选来源、实践证据字段和六个演示关键帧。_完成初次采集：7 条知乎候选已记录，2 组查询因服务端限流待补；详见 [zhixing-phase0-data-inventory.md](../../docs/zhixing-phase0-data-inventory.md)。_
- [ ] **冻结 MySQL 案例包与主 Demo**：将三个案例的讨论/尝试协议写入 [zhixing-mysql-case-pack.md](../../docs/zhixing-mysql-case-pack.md)，并只为慢查询案例编写三分钟可彩排剧本。_修改：案例文档；不创建 UI。_
- [ ] **统一 MVP 术语**：将 UI 和讲稿中的“学习计划 / K8s”默认文案切换为“场景训练 / MySQL 实践”，保留长期愿景但不在演示主路径展示。_修改：现有视图、Mock 数据和方案文档。_

## 阶段 1：案例引擎

- [ ] **建立 MySQL 场景数据契约**：在 `frontend/src/types/domain.ts` 和 `frontend/src/data/` 定义案例、讨论、Tutor 回应、尝试、证据和校验事件结构，并以三个 MySQL 案例驱动现有页面。_修改：`domain.ts`、`mock.ts`、Pinia stores；复用：现有 API service 边界。_
- [ ] **完成训练台纵切**：在现有 `LessonView` 工作台中完成“用户讨论 -> Tutor 回应 -> 用户尝试 -> 证据校验”的两轮循环；慢查询走完整闭环，死锁和深分页至少可进入同一训练台。_修改：`LessonView`、`TutorAgent`、`ContextIngest`、`PracticeLog`；复用：App shell、AsyncState。_
- [ ] **实现本地证据恢复**：刷新后恢复当前案例、阶段、事件和固定参考，空状态可从头重新开始。_修改：lesson / notes stores；覆盖：首次进入、刷新、重置和无证据状态。_

## 阶段 2：练习验证

- [ ] **交付可复现 MySQL Lab**：提供 Docker Compose、建表、固定种子、问题 SQL、基准和一键重置入口。_新建：`lab/mysql/`；验收：干净环境可复现三种执行计划。_
- [ ] **接入手动 EXPLAIN 证据**：把粘贴的 SQL、EXPLAIN 和基准原文保存为证据卡，解析有限字段并保留原文查看入口。_修改：ContextIngest、PracticeLog、案例 store；覆盖：有效、未知格式、粘贴为空。_
- [ ] **实现验证判定**：比较查询语义、扫描成本和基准结果，给出“支持 / 不支持 / 证据不足”，不通过单个 `type` 字段判定成败。_新建：案例判定模块；覆盖：错误修复、正确修复、数据不足。_

## 阶段 3：教练与来源

- [ ] **实现剧本化教练状态机**：每阶段以确定性规则控制进入、退出、必需证据和三级提示。_新建：coach state module；复用：TutorAgent UI。_
- [ ] **接入受限 Tutor 对话**：Tutor 只根据当前阶段和已记录证据发问或给提示，不能直接完成案例或改写用户证据。_修改：tutor service、lesson store、TutorAgent；覆盖：无进展、主动要提示、模型失败。_
- [ ] **编排知乎来源卡**：按当前阶段按需获取并展示来源角色、作者、链接、引用片段和使用理由。_新建：source service / card；复用：PinnedReferences；覆盖：来源缺失和检索失败。_

## 阶段 4：文章与发布预览

- [ ] **生成证据驱动大纲**：从事件流生成问题、假设、实验、失败、验证和残余风险结构，引用关联证据。_修改：notes service、NoteEditor；复用：PracticeLog。_
- [ ] **完成可编辑文章预览**：文章中明确区分演示数据、用户实测和知乎参考，并支持人工编辑。_修改：NotesView、NoteEditor。_
- [ ] **实现模拟知乎发布检查**：用户确认来源、隐私和复现步骤后进入“草稿预览已就绪”，不调用真实知乎写接口。_修改：NotesView、SettingsView；覆盖：检查未完成、确认完成、OAuth 未连接。_

## 阶段 5：演示加固

- [ ] **增加回放和重置模式**：在不依赖模型或网络时播放固定的 MySQL 证据链；Docker 与前端数据都可一键回到初始状态。_修改：scenario runtime、lab scripts。_
- [ ] **完成桌面可用性验证**：检查 1440px 和 1024px 下 SQL、来源、时间线和文章预览的滚动、溢出、键盘焦点与错误态。_修改：必要的布局和无障碍细节；复用：tokens.css。_
- [ ] **彩排与冻结**：连续三次从冷启动走到文章预览，录制备份视频；冻结后只处理阻断演示的问题。_不创建新功能。_

## 阶段 6：扩展

- [ ] **增加 Kafka 热分区案例**：复用案例引擎，验证分区 Lag、Rebalance 和扩容取舍。_新建：Kafka 场景数据与练习环境；不改 MySQL 状态机行为。_
- [ ] **增加 Redis 一致性案例**：复用案例引擎，记录时序、方案取舍、失败注入和残余风险。_新建：Redis 场景数据与练习环境；不改 MySQL 状态机行为。_
- [ ] **评估真实集成**：只在核心闭环稳定后接入 CLI 自动抓取与真实知乎 OAuth 发布。_新建：授权和审计边界；不作为黑客松阻断项。_
