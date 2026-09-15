// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PlanningProfilePanel from './PlanningProfilePanel.vue'
import type { AgentPlanningSession, ProductResumeAttachment } from '@/types/product'

function resume(parseStatus: ProductResumeAttachment['parseStatus'], overrides: Partial<ProductResumeAttachment> = {}): ProductResumeAttachment {
  return {
    id: 'resume-1', learnerId: 'learner-1', planningSessionId: 'session-1', originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', parseStatus, pageCount: parseStatus === 'ready' ? 2 : 0, textLength: parseStatus === 'ready' ? 640 : 0, parseError: 'private provider details', version: 1, includedAt: '2026-09-14T00:00:00.000Z', includedInPlanningContext: parseStatus === 'ready', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z', ...overrides,
  }
}

const session = (attachment: ProductResumeAttachment): AgentPlanningSession => ({
  id: 'session-1', learnerId: 'learner-1', goal: '成为可靠的后端工程师', status: 'active', mode: 'agent', agentStatus: 'idle', stage: 'baseline', progress: { completed: 1, total: 3, current: 2, label: '基础了解' }, readiness: { canGenerateRoadmap: false, blockers: ['assessment_not_terminal'], nextAction: '继续补充信息' }, assessment: null, requirementBrief: null, revision: 1, messages: [], requiredTopics: [], profile: null, resume: attachment, roadmapId: null, roadmapGeneration: null, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
})

function render(attachment: ProductResumeAttachment, props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(PlanningProfilePanel, { session: session(attachment), ...props })
  app.mount(host)
  return { host, app }
}

describe('PlanningProfilePanel resume status', () => {
  it.each([
    ['pending', '等待解析'],
    ['processing', '解析中'],
    ['ready', '完成'],
    ['failed', '解析失败'],
  ] as const)('shows the safe %s status', async (status, label) => {
    const { host, app } = render(resume(status))
    await nextTick()
    expect(host.textContent).toContain(label)
    expect(host.textContent).not.toContain('private provider details')
    app.unmount()
    host.remove()
  })

  it('shows uploading and bounded polling states without provider details', async () => {
    const { host, app } = render(resume('ready'), { uploading: true, resumePolling: true, resumePollError: null })
    await nextTick()
    expect(host.textContent).toContain('上传中')
    expect(host.textContent).toContain('正在等待解析结果')
    expect(host.textContent).toContain('2')
    expect(host.textContent).toContain('640')
    app.unmount()
    host.remove()
  })

  it('explains the waiting and processing stages with human copy', async () => {
    const waiting = render(resume('pending'))
    await nextTick()
    expect(waiting.host.textContent).toContain('排队等待解析')
    waiting.app.unmount()
    waiting.host.remove()

    const processing = render(resume('processing'))
    await nextTick()
    expect(processing.host.textContent).toContain('正在提取 PDF 文本')
    processing.app.unmount()
    processing.host.remove()
  })

  it('renders the profile-consolidation stage after a ready parse', async () => {
    const { host, app } = render(resume('ready', { includedInPlanningContext: false }))
    await nextTick()
    expect(host.textContent).toContain('已解析')
    expect(host.textContent).toContain('正在整理画像并纳入规划上下文')
    app.unmount()
    host.remove()
  })

  it('renders a degraded parse notice only when flagged as degraded', async () => {
    const normal = render(resume('ready'))
    await nextTick()
    expect(normal.host.textContent).not.toContain('降级解析')
    normal.app.unmount()
    normal.host.remove()

    const degraded = render(resume('ready'), { degraded: true })
    await nextTick()
    expect(degraded.host.textContent).toContain('本地备选方案完成解析')
    degraded.app.unmount()
    degraded.host.remove()
  })

  it('offers a retry action on failure and never leaks the raw error body', async () => {
    const { host, app } = render(resume('failed'), { uploadError: null })
    await nextTick()
    expect(host.textContent).toContain('解析失败')
    expect(host.textContent).toContain('可重新选择文件重试')
    expect(host.textContent).not.toContain('private provider details')
    expect(host.textContent).not.toMatch(/provider.?task/i)
    app.unmount()
    host.remove()
  })
})
