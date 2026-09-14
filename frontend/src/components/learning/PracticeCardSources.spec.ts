// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PracticeCardSources from './PracticeCardSources.vue'
import type { PublicSourceReference } from '@/types/learningExperience'

function render(sources: PublicSourceReference[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(PracticeCardSources, { sources })
  app.mount(host)
  return { host, app }
}

describe('PracticeCardSources', () => {
  it('renders legacy and extended source references without exposing private material', async () => {
    const { host, app } = render([
      { id: 'legacy', title: '旧版来源', author: '作者', canonicalUrl: 'https://example.com/legacy' },
      { id: 'extended', title: '<img src=x onerror=alert(1)>', author: null, canonicalUrl: 'javascript:alert(1)', sourceType: 'favorite', summary: '<script>private answer</script>', sourceAnchor: '第 3 节', selectedReason: '与当前目标相关', fetchedAt: '2026-09-14T00:00:00.000Z' },
    ])
    await nextTick()

    expect(host.textContent).toContain('本卡参考来源')
    expect(host.textContent).toContain('参考材料，不等于标准答案')
    expect(host.textContent).toContain('旧版来源')
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(host.textContent).toContain('查看摘要与采用信息')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/legacy')
    expect(host.querySelector('a')?.getAttribute('target')).toBe('_blank')
    expect(host.querySelector('a')?.getAttribute('rel')).toContain('noreferrer')
    expect(host.querySelectorAll('a')).toHaveLength(1)
    app.unmount()
    host.remove()
  })

  it('does not render an empty source section or an unsafe external link', async () => {
    const empty = render([])
    await nextTick()
    expect(empty.host.querySelector('[aria-label="本卡参考来源"]')).toBeNull()
    empty.app.unmount()
    empty.host.remove()

    const unsafe = render([{ id: 'unsafe', title: '不安全来源', author: null, canonicalUrl: 'data:text/html,unsafe' }])
    await nextTick()
    expect(unsafe.host.textContent).toContain('不安全来源')
    expect(unsafe.host.querySelector('a')).toBeNull()
    unsafe.app.unmount()
    unsafe.host.remove()
  })
})
