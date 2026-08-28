import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CaseId, LabTokenPayload } from './domain.js'
import { LabError } from './errors.js'

function encode(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signature(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url')
}

export function signLabToken(payload: LabTokenPayload, secret: string): string {
  const body = encode(JSON.stringify(payload))
  return `${body}.${signature(body, secret)}`
}

export function verifyLabToken(token: string | undefined, secret: string, expected?: { runId: string; caseId: CaseId; revision?: number }): LabTokenPayload {
  if (!token) throw new LabError('unauthorized', '缺少 Lab 访问令牌', 401)
  const parts = token.split('.')
  if (parts.length !== 2) throw new LabError('unauthorized', 'Lab 访问令牌格式无效', 401)

  const expectedSignature = signature(parts[0], secret)
  const actualSignature = Buffer.from(parts[1])
  const validSignature = actualSignature.length === expectedSignature.length && timingSafeEqual(actualSignature, Buffer.from(expectedSignature))
  if (!validSignature) throw new LabError('unauthorized', 'Lab 访问令牌签名无效', 401)

  let payload: LabTokenPayload
  try {
    payload = JSON.parse(decode(parts[0])) as LabTokenPayload
  } catch {
    throw new LabError('unauthorized', 'Lab 访问令牌内容无效', 401)
  }

  if (payload.scope !== 'lab:execute' || payload.exp <= Date.now()) {
    throw new LabError('unauthorized', 'Lab 访问令牌已过期', 401)
  }
  if (expected && (payload.sub !== expected.runId || payload.caseId !== expected.caseId)) {
    throw new LabError('forbidden', 'Lab 访问令牌与当前运行不匹配', 403)
  }
  if (expected?.revision !== undefined && payload.revision !== expected.revision) {
    throw new LabError('revision_conflict', 'Lab 运行版本已变化，请刷新当前运行', 409, true, { expectedRevision: expected.revision, tokenRevision: payload.revision })
  }
  return payload
}
