// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PlanningProfilePanel from './PlanningProfilePanel.vue'
import type { AgentPlanningSession, ProductResumeAttachment } from '@/types/product'

const resume = (parseStatus: ProductResumeAttachment['parseStatus']): ProductResumeAttachment => ({
  id: 'resume-1', learnerId: 'learner-1', planningSessionId: 'session-1', originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', parseStatus, pageCount: parseStatus === 'ready' ? 2 : 0, textLength: parseStatus === 'ready' ? 640 : 0, parseError: 'private provider details', version: 1, includedAt: '2026-09-14T00:00:00.000Z', includedInPlanningContext: parseStatus === 'ready', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
})

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
    ['failed', '失败，可重试'],
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
})
