# Design Review: 写作证据地图

Reviewed against: `.design/zhixing-learning/DESIGN_BRIEF.md`
Date: 2026-09-01

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-writing-desktop-1280.png` | Desktop (1280x800) | 写作证据地图、左侧聚类索引、中间聚类卡片与证据检查器 |
| `screenshots/review-writing-tablet-768.png` | Tablet (768x1024) | 聚类卡片纵向排列后的页面 |
| `screenshots/review-writing-mobile-375.png` | Mobile (375x812) | 移动端横向聚类导航与长页面 |

## Summary

当前页面把同一组聚类信息同时放在左侧导航和中间六张卡片中，造成标题、状态和记录数重复。移动端变成很长的连续卡片列表，用户无法快速聚焦一个聚类。数据层面，当前页面使用的新实践只有一个 `case_presented` 事件，因此前五簇为空；完整历史存在于另一条实践记录，且 learner 身份不同，不能直接复制。

## Must Fix

1. **聚类信息重复**：`WritingEvidenceMap.vue` 同时渲染 `.cluster-nav` 和 `.cluster-grid`。保留左侧为聚类目录，中间改为单个当前聚类详情，右侧保留按需加载的证据检查器。
2. **空实践被误认为历史缺失**：进入页面时默认选择当前实践的第一个聚类，并明确显示“当前实践暂无记录”；同时修复 learnerId 恢复和历史实践选择，不能跨 learner 自动合并。

## Should Fix

1. **证据链分散**：关键证据详情需要将代表 SQL 与对应 EXPLAIN、结果集组合展示，完整重复 SQL 仍保留在尝试簇。
2. **响应式阅读成本高**：1024px 以下使用“左侧目录 + 中间详情 + 证据抽屉/底部检查器”，移动端只保留横向目录和单簇详情，避免六张卡片全部展开。

## Could Improve

1. 在左侧目录增加“已确认 / 待确认 / 暂不纳入”状态筛选，但不增加第二套摘要内容。
2. 对历史重放显示来源实践、事件数量和时间范围，用户确认后再生成当前实践的证据簇。

## What Works Well

按需加载证据详情、原始记录保留、聚类确认状态和核心簇生成大纲的约束已经具备，适合在不改变文章证据链的前提下收敛界面。
