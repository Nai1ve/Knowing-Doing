import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ProductRepository } from './product-repository.js'

export class IdentityService {
  constructor(private readonly repository: ProductRepository) {}
  create() { const learnerId = randomUUID(); const id = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url'); const at = new Date().toISOString(); const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(); this.repository.ensureLearner(learnerId); this.repository.db.prepare('INSERT INTO learner_sessions(id, learner_id, csrf_token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, learnerId, createHash('sha256').update(csrf).digest('hex'), expiresAt, at, at); return { id, learnerId, csrf, expiresAt } }
  resolve(id: string | undefined) { if (!id) return null; const row = this.repository.db.prepare('SELECT learner_id FROM learner_sessions WHERE id=? AND expires_at>?').get(id, new Date().toISOString()) as { learner_id: string } | undefined; if (!row) return null; this.repository.db.prepare('UPDATE learner_sessions SET last_seen_at=? WHERE id=?').run(new Date().toISOString(), id); return row.learner_id }
  validCsrf(id: string, token: string | undefined) { if (!token) return false; const row = this.repository.db.prepare('SELECT csrf_token_hash FROM learner_sessions WHERE id=? AND expires_at>?').get(id, new Date().toISOString()) as { csrf_token_hash: string } | undefined; return Boolean(row && createHash('sha256').update(token).digest('hex') === row.csrf_token_hash) }
}
