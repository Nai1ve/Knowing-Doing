// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PlanningAssessmentCard from './PlanningAssessmentCard.vue'
import type { PlanningAssessment } from '@/types/product'

const failedAssessment: PlanningAssessment = {
  id: 'assessment-1',
  planningSessionId: 'session-1',
  version: 1,
  status: 'failed',
  questions: [],
  answers: {},
  skipped: [],
  currentQuestionIndex: 0,
  progress: { completed: 0, total: 12, current: 1, label: '水平测评' },
  summary: null,
  error: 'schema validation details must remain private',
  updatedAt: '2026-09-14T00:00:00.000Z',
}

describe('PlanningAssessmentCard', () => {
  it('explains recovery, preserves user context, and hides validation internals', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const retry = vi.fn()
    const app = createApp(PlanningAssessmentCard, { assessment: failedAssessment, error: failedAssessment.error, onRetry: retry })
    app.mount(host)
    await nextTick()

    expect(host.textContent).toContain('已保存的对话和画像仍然保留')
    expect(host.textContent).toContain('重试评估')
    expect(host.textContent).not.toContain('schema validation details')
    expect(host.textContent).not.toContain('rubric')

    host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(retry).toHaveBeenCalledTimes(1)
    app.unmount()
    host.remove()
  })
})
