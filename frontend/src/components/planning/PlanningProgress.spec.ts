// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PlanningProgress from './PlanningProgress.vue'

function render(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(PlanningProgress, props)
  app.mount(host)
  return { host, app }
}

describe('PlanningProgress', () => {
  it('shows the server-provided sixth baseline turn and adaptive copy', async () => {
    const { host, app } = render({ stage: 'baseline', progress: { completed: 5, total: 6, current: 6, label: '基础了解' } })
    await nextTick()

    expect(host.textContent).toContain('第 6 / 6 轮')
    expect(host.textContent).toContain('至少 2 轮，最多 6 轮')
    app.unmount()
    host.remove()
  })

  it('uses stage progress for non-baseline phases', async () => {
    const { host, app } = render({ stage: 'assessment_answering', progress: { completed: 4, total: 12, current: 5, label: '水平测评' } })
    await nextTick()

    expect(host.textContent).toContain('水平测评')
    expect(host.textContent).toContain('4 / 12')
    expect(host.textContent).not.toContain('最多 6 轮')
    app.unmount()
    host.remove()
  })
})
