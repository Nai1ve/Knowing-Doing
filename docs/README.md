# 知行文档索引

本文档集合服务于同一个目标：先交付一个可被评委完整体验的工程实践闭环，再逐步扩展为面向开发者的实践学习系统。

| 文档 | 回答的问题 | 使用时机 |
| --- | --- | --- |
| [zhixing-hackathon-plan.md](zhixing-hackathon-plan.md) | 为什么做、为什么是知乎、Demo 如何打动评委 | 方案评审、讲稿和演示 |
| [zhixing-delivery-plan.md](zhixing-delivery-plan.md) | 做什么、不做什么、阶段如何验收 | 开发排期和阶段评审 |
| [zhixing-mysql-case-spec.md](zhixing-mysql-case-spec.md) | 第一个工程案例的剧本、证据和通过条件 | 场景实现、练习环境和演示彩排 |
| [zhixing-phase0-data-inventory.md](zhixing-phase0-data-inventory.md) | 阶段 0 需要采集什么、已采到什么、如何核验 | 数据采集、来源筛选和 Demo 准备 |
| [zhixing-demo-flow.md](zhixing-demo-flow.md) | 三分钟主路径、异常分支和现场兜底 | Demo 脚本、分支模拟和覆盖验收 |
| [zhixing-case-source-module.md](zhixing-case-source-module.md) | 真实来源如何经过 AI 改造成可复现案例，以及模块输入输出 | 案例生成、来源追溯和后续推荐 |
| [zhixing-mysql-case-pack.md](zhixing-mysql-case-pack.md) | 三个 MySQL 案例及其共同的讨论、Tutor 和尝试协议 | MVP 案例准备和案例引擎实现 |
| [zhixing-post-mvp-capabilities.md](zhixing-post-mvp-capabilities.md) | MVP 之后的学习主线、画像、计划、反馈和案例扩展能力 | 后续产品规划和开发排期 |
| [../backend/README.md](../backend/README.md) | Docker Lab API、人工 migration、权限与验收边界 | 后端启动、部署和集成测试 |
| [.design/zhixing-learning/DESIGN_BRIEF.md](../.design/zhixing-learning/DESIGN_BRIEF.md) | 体验原则和视觉方向 | 前端设计决策 |
| [.design/zhixing-learning/INFORMATION_ARCHITECTURE.md](../.design/zhixing-learning/INFORMATION_ARCHITECTURE.md) | 页面、路由、信息和数据边界 | 信息架构与接口设计 |
| [.design/zhixing-learning/TASKS.md](../.design/zhixing-learning/TASKS.md) | 可独立完成的开发切片 | 开发执行和逐项审核 |

## 当前决策

- 黑客松 MVP 只演示 **场景模式**，不实现任务模式、创作模式和账号体系。
- MVP 准备三个 MySQL 案例：慢查询、死锁与锁等待、深分页；慢查询是三分钟主 Demo。
- 交互主线是：用户讨论 -> Tutor 回应 -> 用户尝试 -> 证据校验 -> 下一轮讨论 -> 文章预览。
- 教练由代码持有状态和通过条件；模型只能在当前阶段提问、解释和整理，不能替用户直接跳过验证。
- 证据以手动粘贴为主，平台预置的单 MySQL Docker Lab 保证可复现；CLI、真实知乎 OAuth 发布和第二案例只作为后续加分项。

## 文档边界

产品方案不再重复实现细节，阶段计划不再重复评委叙事，案例规格不再承担接口和页面设计。任何新需求先判断它属于哪个边界，再补充对应文档。
