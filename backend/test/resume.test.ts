import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { PlanningService } from '../src/planning.js'
import type { RemoteResumePdfParser } from '../src/resume-parser.js'

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
async function waitForStatus(repository: ProductRepository, id: string, status: string) {
  await vi.waitFor(() => expect(repository.db.prepare('SELECT parse_status FROM learner_resume_documents WHERE id=?').get(id)).toMatchObject({ parse_status: status }), { timeout: 1_000, interval: 10 })
}

describe('PlanningService learner resume documents', () => {
  it('accepts PDF content, versions learner documents, and retains historical files', async () => withPlanning(async (service, repository, storagePath) => {
    const session = service.createSession('resume-learner', { goal: '学习后端系统', clientRequestId: 'resume-session' })
    const first = await service.uploadResume('resume-learner', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('first resume')) })
    expect(first.mimeType).toBe('application/pdf')
    expect(first.parseStatus).toBe('pending')
    await waitForStatus(repository, first.id, 'ready')
    expect(readFileSync(path.join(storagePath, `${first.id}.pdf`), 'utf8')).toContain('%PDF-1.4')
    const second = await service.uploadResume('resume-learner', session.id, { filename: 'resume-v2.PDF', mimetype: 'application/pdf', file: Readable.from(textPdf('second resume')) })
    await waitForStatus(repository, second.id, 'ready')
    expect(service.getSession('resume-learner', session.id).resume?.id).toBe(second.id)
    expect(repository.db.prepare('SELECT extracted_text, version, is_current FROM learner_resume_documents WHERE id = ?').get(second.id)).toMatchObject({ extracted_text: 'second resume', version: 2, is_current: 1 })
    expect(existsSync(path.join(storagePath, `${first.id}.pdf`))).toBe(true)
    expect(readFileSync(path.join(storagePath, `${second.id}.pdf`), 'utf8')).toContain('second')
  }))

  it('inherits the learner current resume for a new planning session and replays an upload request', async () => withPlanning(async (service, repository) => {
    const first = service.createSession('resume-memory-learner', { goal: '学习后端系统', clientRequestId: 'resume-memory-first' })
    const uploaded = await service.uploadResume('resume-memory-learner', first.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('payment service and MySQL performance')), clientRequestId: 'resume-upload-1' })
    const replay = await service.uploadResume('resume-memory-learner', first.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('ignored by idempotency')), clientRequestId: 'resume-upload-1' })
    await waitForStatus(repository, uploaded.id, 'ready')
    const next = service.createSession('resume-memory-learner', { goal: '重新规划后端路线', clientRequestId: 'resume-memory-next' })
    expect(replay.id).toBe(uploaded.id)
    expect(service.getSession('resume-memory-learner', next.id).resume?.id).toBe(uploaded.id)
    expect(repository.getPlanningResumeContext(next.id, 'resume-memory-learner')?.chunks[0]?.content).toContain('payment service')
  }))

  it('rejects non-PDF names, MIME types, and file contents', async () => withPlanning(async (service, repository) => {
    const session = service.createSession('resume-validation', { goal: '学习后端系统', clientRequestId: 'resume-validation-session' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file: Readable.from(Buffer.from('not pdf')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.pdf', mimetype: 'text/plain', file: Readable.from(Buffer.from('%PDF-1.7\nlooks like a pdf')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    await expect(service.uploadResume('resume-validation', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('plain text')) })).rejects.toMatchObject({ code: 'resume_pdf_only' })
    const broken = await service.uploadResume('resume-validation', session.id, { filename: 'broken.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('%PDF-1.7\nbroken')) })
    await waitForStatus(repository, broken.id, 'failed')
  }))

  it('identifies a scanned PDF without persisting it as resume context', async () => withPlanning(async (service, repository, storagePath) => {
    const session = service.createSession('resume-scan', { goal: '学习后端系统', clientRequestId: 'resume-scan-session' })

    const scanned = await service.uploadResume('resume-scan', session.id, { filename: 'scanned.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('')) })
    await waitForStatus(repository, scanned.id, 'failed')
    expect(service.getSession('resume-scan', session.id).resume?.parseStatus).toBe('failed')
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM learner_resume_documents WHERE learner_id = ?').get('resume-scan')).toMatchObject({ count: 1 })
    expect(existsSync(storagePath)).toBe(true)
  }))

  it('enforces the configured size limit', async () => withPlanning(async (service, repository, storagePath) => {
    const limited = new PlanningService(repository, { resumeStoragePath: storagePath, resumeMaxBytes: 8 })
    const session = service.createSession('resume-limit', { goal: '学习后端系统', clientRequestId: 'resume-limit-session' })
    await expect(limited.uploadResume('resume-limit', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('%PDF-1.7\nlarge')) })).rejects.toMatchObject({ code: 'resume_too_large' })
  }))

  it('maps remote quota, scanned, and local fallback failures to safe parse error codes', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-resume-codes-'))
    const dbPath = path.join(directory, 'product.db')
    const storagePath = path.join(directory, 'resumes')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    const sessionId = randomUUID()
    try {
      const remoteParser: RemoteResumePdfParser = {
        async parse() { throw Object.assign(new Error('remote down'), { code: 'zhihu_quota_exhausted' }) },
      }
      const service = new PlanningService(repository, { resumeStoragePath: storagePath, remoteResumeParser: remoteParser })
      const session = service.createSession('resume-codes', { goal: '学习后端系统', clientRequestId: 'codes-session' })
      const fallback = await service.uploadResume('resume-codes', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('payment service and MySQL performance')) })
      await waitForStatus(repository, fallback.id, 'ready')
      // Remote quota exhaustion is recorded while local parsing saved the document.
      expect(repository.db.prepare('SELECT parse_provider, parse_error_code FROM learner_resume_documents WHERE id=?').get(fallback.id)).toMatchObject({ parse_provider: 'local', parse_error_code: 'zhihu_quota_exhausted' })
      expect(service.getSession('resume-codes', session.id).resume?.parseErrorCode).toBe('zhihu_quota_exhausted')

      // A scanned PDF with no extractable text maps to a safe scanned code.
      const scanned = await service.uploadResume('resume-codes', session.id, { filename: 'scanned.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('')) })
      await waitForStatus(repository, scanned.id, 'failed')
      expect(repository.db.prepare('SELECT parse_error_code FROM learner_resume_documents WHERE id=?').get(scanned.id)).toMatchObject({ parse_error_code: 'resume_text_unavailable' })

      // A corrupt PDF that even the local fallback cannot parse maps to a safe code.
      const broken = await service.uploadResume('resume-codes', session.id, { filename: 'broken.pdf', mimetype: 'application/pdf', file: Readable.from(Buffer.from('%PDF-1.7\nbroken garbage')) })
      await waitForStatus(repository, broken.id, 'failed')
      expect(repository.db.prepare('SELECT parse_error_code FROM learner_resume_documents WHERE id=?').get(broken.id)).toMatchObject({ parse_error_code: 'resume_parse_failed' })
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fences parse leases and resumes interrupted processing after a service restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-resume-lease-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    try {
      repository.ensureLearner('lease-learner')
      const now = new Date().toISOString()
      const future = new Date(Date.now() + 5 * 60_000).toISOString()
      repository.db.prepare(`
        INSERT INTO learner_resume_documents(id, learner_id, original_filename, stored_filename, mime_type, size_bytes, sha256, parse_status, page_count, text_length, extracted_text, parse_error, version, is_current, created_at, updated_at, parse_lease_until, parse_lease_token)
        VALUES (?, 'lease-learner', 'resume.pdf', 'lease-doc.pdf', 'application/pdf', 1, 'h', 'processing', 0, 0, '', NULL, 1, 1, ?, ?, ?, 'active-lease-token')
      `).run('lease-doc', now, now, future)

      // An unexpired lease cannot be reclaimed by another worker.
      expect(repository.claimResumeParse('lease-doc')).toBeNull()
      // Restart recovery clears the lease and reopens the document for processing.
      repository.recoverResumeParses()
      expect(repository.db.prepare('SELECT parse_status, parse_lease_until, parse_lease_token FROM learner_resume_documents WHERE id=?').get('lease-doc')).toMatchObject({ parse_status: 'pending', parse_lease_until: null, parse_lease_token: null })
      // The recovered document can now be claimed again.
      expect(repository.claimResumeParse('lease-doc')).not.toBeNull()
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reclaims interrupted uploads and superseded files without touching current documents', async () => withPlanning(async (service, repository, storagePath) => {
    const session = service.createSession('cleanup-learner', { goal: '学习后端系统', clientRequestId: 'cleanup-session' })
    const first = await service.uploadResume('cleanup-learner', session.id, { filename: 'resume.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('first resume')) })
    await waitForStatus(repository, first.id, 'ready')
    const second = await service.uploadResume('cleanup-learner', session.id, { filename: 'resume-v2.pdf', mimetype: 'application/pdf', file: Readable.from(textPdf('second resume')) })
    await waitForStatus(repository, second.id, 'ready')
    writeFileSync(path.join(storagePath, 'orphan.pdf'), '%PDF-1.4 orphan')
    writeFileSync(path.join(storagePath, 'interrupted.uploading'), 'partial upload')

    const result = await service.cleanupStaleResumeFiles({ uploadTempMaxAgeMs: -1, retentionMs: -1 })
    expect(result.removedFiles).toEqual(expect.arrayContaining(['orphan.pdf', 'interrupted.uploading', `${first.id}.pdf`]))
    // The current document's file is retained.
    expect(existsSync(path.join(storagePath, `${second.id}.pdf`))).toBe(true)
    expect(existsSync(path.join(storagePath, 'orphan.pdf'))).toBe(false)
    expect(existsSync(path.join(storagePath, `${first.id}.pdf`))).toBe(false)
  }))
})
