import type { CaseId, CaseManifest, SessionName } from './domain.js'

const manifests: Record<CaseId, CaseManifest> = {
  'mysql-order-list-index-001': {
    id: 'mysql-order-list-index-001',
    title: '慢查询与联合索引',
    schema: 'zhixing_lab_slow',
    allowedSessions: ['default'],
    fixtureVersion: '2026-08-28.1',
    tables: ['orders'],
    baselineIndexes: { orders: { PRIMARY: '', idx_orders_user_id: '(user_id)' } },
  },
  'mysql-deadlock-lock-order-001': {
    id: 'mysql-deadlock-lock-order-001',
    title: '死锁与锁等待',
    schema: 'zhixing_lab_deadlock',
    allowedSessions: ['tx-a', 'tx-b'],
    fixtureVersion: '2026-08-28.1',
    tables: ['accounts'],
    baselineIndexes: { accounts: { PRIMARY: '' } },
  },
  'mysql-deep-pagination-001': {
    id: 'mysql-deep-pagination-001',
    title: '深分页优化',
    schema: 'zhixing_lab_pagination',
    allowedSessions: ['default'],
    fixtureVersion: '2026-08-28.1',
    tables: ['events'],
    baselineIndexes: { events: { PRIMARY: '', idx_events_created_id: '(created_at, id)' } },
  },
}

export function getManifest(caseId: string): CaseManifest {
  const manifest = manifests[caseId as CaseId]
  if (!manifest) throw new Error(`unknown case: ${caseId}`)
  return manifest
}

export function listManifests(): CaseManifest[] {
  return Object.values(manifests)
}

export function isSessionName(value: string): value is SessionName {
  return value === 'default' || value === 'tx-a' || value === 'tx-b'
}

export function isCaseId(value: string): value is CaseId {
  return value in manifests
}
