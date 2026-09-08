import type { CaseRequest, CaseSpec, SourceItem } from './product-types.js'
import { parseCaseSpec } from './case-schemas.js'

export interface CaseBuilderInput {
  request: CaseRequest
  source: SourceItem | null
}

export interface CaseBuilderProvider {
  readonly providerName: 'fixture' | 'model'
  build(input: CaseBuilderInput): Promise<CaseSpec>
}

export class FixtureCaseBuilder implements CaseBuilderProvider {
  readonly providerName = 'fixture' as const

  async build(input: CaseBuilderInput): Promise<CaseSpec> {
    const context = input.request.input.kind === 'brief'
      ? input.request.input.brief ?? '完成一次 Python 测试修复实践。'
      : `参考材料：${input.source?.title ?? '已选知乎材料'}\n${input.source?.excerpt ?? ''}`
    return parseCaseSpec({
      title: '订单汇总器中的边界条件修复',
      scenario: `你接手了一个负责汇总订单金额的 Python 小模块。当前实现可以处理大多数订单，但边界条件测试失败。请先运行测试、阅读已有实现，再用最小修改修复问题。\n\n本次输入：${context.slice(0, 1200)}`,
      learningGoal: input.request.desiredOutcome?.trim() || '通过阅读代码、运行测试和小步修改，完成一次可验证的 Python 问题修复。',
      difficulty: input.request.difficulty ?? 'applied',
      environment: { templateKey: 'python-pytest-v1', services: [] },
      starterFiles: [
        { path: 'README.md', content: '# 订单汇总器\n\n先运行 `pytest -q`，观察失败测试，再定位实现问题。\n' },
        { path: 'src/order_summary.py', content: "from decimal import Decimal\n\ndef summarize_orders(orders: list[dict]) -> dict:\n    paid = [order for order in orders if order.get('status') == 'PAID']\n    total = sum(Decimal(str(order.get('amount', 0))) for order in paid)\n    return {'count': len(paid), 'total': str(total)}\n" },
        { path: 'tests/test_order_summary.py', content: "from src.order_summary import summarize_orders\n\ndef test_only_paid_orders_are_summarized():\n    assert summarize_orders([\n        {'status': 'PAID', 'amount': '10.50'},\n        {'status': 'PENDING', 'amount': '99.00'},\n    ]) == {'count': 1, 'total': '10.50'}\n\ndef test_missing_amount_is_not_silently_accepted():\n    assert summarize_orders([{'status': 'PAID'}]) == {'count': 0, 'total': '0'}\n" },
      ],
      tasks: [
        { key: 'observe', instruction: '运行测试并记录第一个失败现象，先不要修改代码。', recommendedCommands: ['pytest -q'], expectedObservation: '测试会指出缺少金额的 PAID 订单不应被计入。' },
        { key: 'inspect', instruction: '阅读实现与测试，说明输入缺失字段时当前逻辑如何计算。', recommendedCommands: ['pytest -q'], expectedObservation: '当前实现把缺失金额当成 0，但仍把订单计数为已支付。' },
        { key: 'fix', instruction: '用最小改动修复实现，并重新运行测试验证。', recommendedCommands: ['pytest -q'], expectedObservation: '所有测试通过，count 与 total 同时符合预期。' },
      ],
      verification: { commands: ['pytest -q'], successSignals: ['2 passed', 'passed'] },
      tutorContext: { concepts: ['边界条件', '测试驱动修复', 'Decimal 金额计算'], likelyMisconceptions: ['把测试通过当成无需理解原因', '只修 total 而忽略 count'], evidenceToNotice: ['首次失败输出', '修改前后文件差异', '最终 pytest 输出'] },
    })
  }
}
