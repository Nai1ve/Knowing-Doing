// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderSafeMarkdown } from './markdownRenderer'

describe('renderSafeMarkdown', () => {
  it('renders the Tutor markdown used in the workspace', () => {
    const tick = String.fromCharCode(96)
    const fence = tick.repeat(3)
    const html = renderSafeMarkdown('# 判断\n\n- 观察\n- 验证\n\n' + tick + 'EXPLAIN' + tick + '\n\n' + fence + 'sql\nSELECT 1\n' + fence)
    expect(html).toContain('<h1>判断</h1>')
    expect(html).toContain('<li>观察</li>')
    expect(html).toContain('<code>EXPLAIN</code>')
    expect(html).toContain('<pre><code>SELECT 1')
  })

  it('keeps http links and strips raw HTML and unsafe links', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>\n\n[知乎](https://www.zhihu.com/question/1) [危险](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).toContain('href="https://www.zhihu.com/question/1"')
    expect(html).not.toContain('href="javascript:')
  })
})
