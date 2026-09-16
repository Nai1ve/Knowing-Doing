// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PlanningRoadmapReadyCard from './PlanningRoadmapReadyCard.vue'

const brief = { id: 'brief-1', version: 1, status: 'confirmed' as const, confirmedAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z', content: { goal: '学习 MySQL', targetOutcome: '优化查询', deadline: '三个月', weeklyCommitment: '每周 6 小时', preferredDeliverable: '案例', constraints: [], priorities: [], evidenceNotes: [], openQuestions: [] } }

describe('PlanningRoadmapReadyCard', () => {
  it('presents the confirmed inputs and requires an explicit generation action', async () => {
    const generate = vi.fn()
    const revise = vi.fn()
    const host = document.createElement('div')
    const app = createApp(PlanningRoadmapReadyCard, { brief, onGenerate: generate, onRevise: revise })
    app.mount(host)
    await nextTick()

    expect(host.textContent).toContain('这些要求将决定路线的起点、节奏与实践形式')
    expect(host.textContent).toContain('优化查询')
    expect(generate).not.toHaveBeenCalled()
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('开始生成我的路线'))?.click()
    expect(generate).toHaveBeenCalledTimes(1)
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('返回修改需求'))?.click()
    expect(revise).toHaveBeenCalledTimes(1)
    app.unmount()
  })
})
