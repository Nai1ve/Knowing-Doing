import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { PlanningService } from '../src/planning.js'

function withPlanning<T>(callback: (service: PlanningService, repository: ProductRepository, storagePath: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-resume-'))
  const dbPath = path.join(directory, 'product.db')
  const storagePath = path.join(directory, 'resumes')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  try { return Promise.resolve(callback(new PlanningService(repository, { resumeStoragePath: storagePath }), repository, storagePath)).finally(() => { repository.close(); rmSync(directory, { recursive: true, force: true }) }) }
  catch (error) { repository.close(); rmSync(directory, { recursive: true, force: true }); return Promise.reject(error) }
}

function textPdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  const stream = `BT\n/F1 12 Tf\n36 100 Td\n(${escaped}) Tj\nET\n`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object }
  const xrefOffset = Buffer.byteLength(body)
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`
  return Buffer.from(`${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
}

describe('PlanningService learner resume documents', () => {
  it('accepts PDF content, versions learner documents, and retains historical files', async () => withPlanning(async (service, repository, storagePath) => {
    const session = service.createSession('resume-learner', { goal: '学习后端系统', clientRequestId: 'resume-session' })
    const first = await service.uploadResume('resume-learner', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('first resume')) })
    expect(first.mimeType).toBe('application/pdf')
    expect(first.parseStatus).toBe('ready')
    expect(first.pageCount).toBe(1)
    expect(readFileSync(path.join(storagePath, `${first.id}.pdf`), 'utf8')).toContain('%PDF-1.4')
    const second = await service.uploadResume('resume-learner', session.id, { filename: 'resume-v2.PDF', mimetype: 'application/pdf', file: Readable.from(textPdf('second resume')) })
    expect(service.getSession('resume-learner', session.id).resume?.id).toBe(second.id)
    expect(repository.db.prepare('SELECT extracted_text, version, is_current FROM learner_resume_documents WHERE id = ?').get(second.id)).toMatchObject({ extracted_text: 'second resume', version: 2, is_current: 1 })
    expect(existsSync(path.join(storagePath, `${first.id}.pdf`))).toBe(true)
    expect(readFileSync(path.join(storagePath, `${second.id}.pdf`), 'utf8')).toContain('second')
  }))

  it('inherits the learner current resume for a new planning session and replays an upload request', async () => withPlanning(async (service, repository) => {
    const first = service.createSession('resume-memory-learner', { goal: '学习后端系统', clientRequestId: 'resume-memory-first' })
    const uploaded = await service.uploadResume('resume-memory-learner', first.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('payment service and MySQL performance')), clientRequestId: 'resume-upload-1' })
    const replay = await service.uploadResume('resume-memory-learner', first.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('ignored by idempotency')), clientRequestId: 'resume-upload-1' })
    const next = service.createSession('resume-memory-learner', { goal: '重新规划后端路线', clientRequestId: 'resume-memory-next' })
    expect(replay.id).toBe(uploaded.id)
    expect(service.getSession('resume-memory-learner', next.id).resume?.id).toBe(uploaded.id)
    expect(repository.getPlanningResumeContext(next.id, 'resume-memory-learner')?.chunks[0]?.content).toContain('payment service')
  }))

  it('rejects non-PDF names, MIME types, and file contents', async () => withPlanning(async (service) => {
    const session = service.createSession('resume-validation', { goal: '学习后端系统', clientRequestId: 'resume-validation-session' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file: Readable.from(Buffer.from('not pdf')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.pdf', mimetype: 'text/plain', file: Readable.from(Buffer.from('%PDF-1.7\nlooks like a pdf')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('plain text')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'broken.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('%PDF-1.7\nbroken')) })).rejects.toMatchObject({ code: 'resume_parse_failed' })
  }))

  it('identifies a scanned PDF without persisting it as resume context', async () => withPlanning(async (service, repository, storagePath) => {
    const session = service.createSession('resume-scan', { goal: '学习后端系统', clientRequestId: 'resume-scan-session' })

    await expect(service.uploadResume('resume-scan', session.id, { filename: 'scanned.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('')) })).rejects.toMatchObject({ code: 'resume_text_unavailable' })
    expect(service.getSession('resume-scan', session.id).resume).toBeNull()
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM learner_resume_documents WHERE learner_id = ?').get('resume-scan')).toMatchObject({ count: 0 })
    expect(existsSync(storagePath)).toBe(true)
    expect(readdirSync(storagePath)).toEqual([])
  }))

  it('enforces the configured size limit', async () => withPlanning(async (service, repository, storagePath) => {
    const limited = new PlanningService(repository, { resumeStoragePath: storagePath, resumeMaxBytes: 8 })
    const session = service.createSession('resume-limit', { goal: '学习后端系统', clientRequestId: 'resume-limit-session' })
    await expect(limited.uploadResume('resume-limit', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('%PDF-1.7\nlarge')) })).rejects.toMatchObject({ code: 'resume_too_large' })
  }))
})
