import { describe, expect, it, vi } from 'vitest'
import { ensurePracticeCard } from './learningExperienceService'

describe('learning experience API contract', () => {
  it('uses the product prefix and idempotency key for card creation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ id: 'card-1', planUnitId: 'unit-1', mode: 'mixed', title: 'Card', objective: '', summary: '', activities: [], sourceReferences: [], completionPolicy: { requiredActivityTypes: [], maxAttemptsPerActivity: 2 }, status: 'ready', version: 1, createdAt: '', updatedAt: '' }) })
    vi.stubGlobal('fetch', fetchMock)

    await ensurePracticeCard('unit-1', 'mixed', 'same-action-key')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/product/plan-units/unit-1/practice-card')
    expect(fetchMock.mock.calls[0][1].headers.get('Idempotency-Key')).toBe('same-action-key')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({})
  })
})
