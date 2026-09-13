import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ProductRepository } from './product-repository.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000

type SessionRow = {
  id: string
  learner_id: string
  csrf_token_hash: string
  expires_at: string
}

export interface DeviceSession {
  id: string
  learnerId: string
  csrfToken: string
  expiresAt: string
}

export interface ResolvedDeviceSession {
  id: string
  learnerId: string
  expiresAt: string
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export class IdentityService {
  constructor(private readonly repository: ProductRepository) {}

  issue(existingId?: string): DeviceSession {
    const existing = this.row(existingId)
    const csrfToken = randomBytes(32).toString('base64url')
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

    if (existing) {
      this.repository.db.prepare(
        'UPDATE learner_sessions SET csrf_token_hash = ?, expires_at = ?, last_seen_at = ? WHERE id = ?',
      ).run(hash(csrfToken).toString('hex'), expiresAt, now, existing.id)
      return { id: existing.id, learnerId: existing.learner_id, csrfToken, expiresAt }
    }

    const learnerId = randomUUID()
    const id = randomBytes(32).toString('base64url')
    this.repository.ensureLearner(learnerId)
    this.repository.db.prepare(
      'INSERT INTO learner_sessions(id, learner_id, csrf_token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, learnerId, hash(csrfToken).toString('hex'), expiresAt, now, now)
    return { id, learnerId, csrfToken, expiresAt }
  }

  resolve(id: string | undefined): ResolvedDeviceSession | null {
    const row = this.row(id)
    if (!row) return null
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    this.repository.db.prepare(
      'UPDATE learner_sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?',
    ).run(expiresAt, now, row.id)
    return { id: row.id, learnerId: row.learner_id, expiresAt }
  }

  validCsrf(id: string, token: string | undefined): boolean {
    if (!token) return false
    const row = this.row(id)
    if (!row) return false
    const actual = hash(token)
    const expected = Buffer.from(row.csrf_token_hash, 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private row(id: string | undefined): SessionRow | null {
    if (!id) return null
    return this.repository.db.prepare(
      'SELECT id, learner_id, csrf_token_hash, expires_at FROM learner_sessions WHERE id = ? AND expires_at > ?',
    ).get(id, new Date().toISOString()) as SessionRow | undefined ?? null
  }
}
