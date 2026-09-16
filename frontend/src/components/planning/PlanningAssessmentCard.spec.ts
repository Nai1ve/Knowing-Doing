// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PlanningAssessmentCard from './PlanningAssessmentCard.vue'
import type { PlanningAssessment, PlanningAssessmentStatus } from '@/types/product'

function assessment(status: PlanningAssessmentStatus, overrides: Partial<PlanningAssessment> = {}): PlanningAssessment {
  return {
    id: 'assessment-1',
    planningSessionId: 'session-1',
    version: 1,
    status,
    questions: status === 'answering' ? [{ id: 'q-1', key: 'q1', position: 1, dimensionKey: 'foundation', difficulty: 'foundation', type: 'single_choice', prompt: '你更常使用哪种方式排查问题？', options: [{ value: 'a', label: '先看日志' }, { value: 'b', label: '先改配置' }] }] : [],
    answers: {},
    skipped: [],
    currentQuestionIndex: 0,
    progress: { completed: 0, total: 12, current: 1, label: '水平测评' },
    summary: null,
    error: null,
    updatedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  }
}

const failedAssessment = assessment('failed', { error: 'schema validation details must remain private' })
const supersededAssessment = assessment('superseded')

function render(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(PlanningAssessmentCard, props)
  app.mount(host)
  return { host, app }
}

describe('PlanningAssessmentCard', () => {
  it('explains recovery, preserves user context, and hides validation internals', async () => {
    const retry = vi.fn()
    const { host, app } = render({ assessment: failedAssessment, error: failedAssessment.error, onRetry: retry })
    await nextTick()

    expect(host.textContent).toContain('已保存的对话和画像仍然保留')
    expect(host.textContent).toContain('重试评估')
    expect(host.textContent).not.toContain('schema validation details')
    expect(host.textContent).not.toContain('rubric')

    const retryButton = host.querySelector('button')
    expect(retryButton?.classList.contains('secondary-button')).toBe(true)
    retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(retry).toHaveBeenCalledTimes(1)
    app.unmount()
    host.remove()
  })

  it('renders a failed assessment as an explainable stage, not a generic not-ready error', async () => {
    const { host, app } = render({ assessment: failedAssessment, error: failedAssessment.error })
    await nextTick()

    expect(host.textContent).toContain('评估没有完成')
    expect(host.textContent).toContain('评估题目暂时没有准备好')
    expect(host.textContent).not.toContain('评估暂时没有准备好')
    expect(host.textContent).not.toContain('schema validation')
    app.unmount()
    host.remove()
  })

  it('shows preparing and evaluating as busy stages with safe copy', async () => {
    const preparing = assessment('preparing')
    const evaluating = assessment('evaluating')

    const first = render({ assessment: preparing })
    await nextTick()
    expect(first.host.textContent).toContain('正在准备测评')
    expect(first.host.textContent).toContain('正在准备评估…')
    first.app.unmount()
    first.host.remove()

    const second = render({ assessment: evaluating })
    await nextTick()
    expect(second.host.textContent).toContain('正在整理测评结果')
    expect(second.host.textContent).toContain('正在整理评估结果…')
    second.app.unmount()
    second.host.remove()
  })

  it('shows the recovered badge when the server regenerated the assessment with the stable protocol', async () => {
    const recovered = assessment('answering', { recoveredFromFailure: true })
    const { host, app } = render({ assessment: recovered })
    await nextTick()

    expect(host.textContent).toContain('已使用稳定生成协议重新准备测评')
    expect(host.textContent).toContain('第 1 / 1 题')
    app.unmount()
    host.remove()
  })

  it('renders a superseded assessment as an explainable replacement state', async () => {
    const { host, app } = render({ assessment: supersededAssessment })
    await nextTick()

    expect(host.textContent).toContain('评估已由新版本取代')
    expect(host.textContent).toContain('测评已更新')
    app.unmount()
    host.remove()
  })

  it('renders an abandoned terminal state without exposing answer keys', async () => {
    const abandoned = assessment('abandoned', {
      summary: { dimensions: [{ key: 'foundation', label: '基础', level: 'exposed', confidence: 0.4, evidence: [], nextValidation: '补一个具体案例' }] },
    })
    const { host, app } = render({ assessment: abandoned })
    await nextTick()

    expect(host.textContent).toContain('测评已结束')
    expect(host.textContent).toContain('查看逐题复核')
    expect(host.textContent).not.toContain('rubric')
    app.unmount()
    host.remove()
  })

  it('keeps skip and navigation lightweight while making abandonment explicitly dangerous', async () => {
    const save = vi.fn()
    const abandon = vi.fn()
    const { host, app } = render({ assessment: assessment('answering'), onSave: save, onAbandon: abandon })
    await nextTick()

    const skip = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('明确跳过'))
    const previous = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('上一题'))
    const complete = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('完成评估'))
    const end = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('结束评估'))

    expect(skip?.classList.contains('text-button')).toBe(true)
    expect(previous?.classList.contains('text-button')).toBe(true)
    expect(complete?.classList.contains('primary-button')).toBe(true)
    expect(end?.classList.contains('danger-button')).toBe(true)
    expect(end?.classList.contains('text-button')).toBe(false)

    skip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(save).toHaveBeenCalledWith({ q1: null }, ['q1'])
    end?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(abandon).toHaveBeenCalledWith({ q1: null }, ['q1'])
    app.unmount()
    host.remove()
  })
})
