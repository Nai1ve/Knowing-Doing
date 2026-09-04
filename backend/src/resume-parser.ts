import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface ResumeParseResult {
  pageCount: number
  text: string
}

export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeParseError'
  }
}

interface TextItemLike {
  str?: unknown
  hasEOL?: unknown
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ResumeParseError(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

function pageText(items: unknown[]): string {
  const lines: string[] = []
  let line = ''
  for (const value of items) {
    const item = value as TextItemLike
    if (typeof item.str !== 'string') continue
    line += item.str
    if (item.hasEOL === true) {
      lines.push(line)
      line = ''
    }
  }
  if (line) lines.push(line)
  return lines.join('\n').replace(/\u00a0/g, ' ').trim()
}

export async function parseResumePdf(data: Buffer, options: { timeoutMs?: number; maxPages?: number } = {}): Promise<ResumeParseResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxPages = options.maxPages ?? 30
  let document: (Awaited<ReturnType<typeof getDocument>>['promise'] extends Promise<infer T> ? T : never) | undefined
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(data),
      disableAutoFetch: true,
      disableStream: true,
      useSystemFonts: true,
      verbosity: 0,
    })
    document = await withTimeout(loadingTask.promise, timeoutMs, 'PDF 解析超时，请检查文件是否损坏')
    if (document.numPages > maxPages) throw new ResumeParseError(`PDF 页数不能超过 ${maxPages} 页`)

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await withTimeout(document.getPage(pageNumber), timeoutMs, 'PDF 页面解析超时，请重试')
      try {
        const content = await withTimeout(page.getTextContent(), timeoutMs, 'PDF 文本提取超时，请重试')
        pages.push(pageText(content.items as unknown[]))
      } finally {
        page.cleanup()
      }
    }
    const text = pages.filter(Boolean).join('\n\n').replace(/[ \t]+\n/g, '\n').trim()
    if (!text) throw new ResumeParseError('PDF 中没有可提取的文本，可能是扫描图片格式')
    return { pageCount: document.numPages, text }
  } catch (error) {
    if (error instanceof ResumeParseError) throw error
    const message = error instanceof Error ? error.message : 'PDF 内容无法读取'
    throw new ResumeParseError(`PDF 解析失败：${message}`)
  } finally {
    if (document) await document.cleanup()
  }
}
