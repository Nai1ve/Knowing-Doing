import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
})
markdown.validateLink = (url: string) => /^https?:\/\//i.test(url)

function normalizeFencedCodeBlocks(content: string): string {
  let fence: '`' | '~' | null = null
  const lines: string[] = []

  for (const line of content.split('\n')) {
    let remaining = line
    while (remaining) {
      const marker = remaining.match(/(`{3,}|~{3,})/)
      if (!marker || marker.index === undefined) {
        lines.push(remaining)
        break
      }

      const index = marker.index
      if (!fence) {
        const prefix = remaining.slice(0, index).trimEnd()
        if (prefix) lines.push(prefix)
        lines.push(remaining.slice(index).trimEnd())
        fence = marker[1][0] as '`' | '~'
        break
      }

      if (marker[1][0] !== fence) {
        lines.push(remaining)
        break
      }

      const before = remaining.slice(0, index).trimEnd()
      if (before) lines.push(before)
      lines.push(marker[1])
      fence = null
      remaining = remaining.slice(index + marker[1].length).trimStart()
    }
  }

  return lines.join('\n')
}

export function renderSafeMarkdown(content: string): string {
  return DOMPurify.sanitize(markdown.render(normalizeFencedCodeBlocks(content)), {
    ALLOWED_TAGS: ['a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  })
}
