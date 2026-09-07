import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientId } from './client-id'

describe('createClientId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0)
        return bytes
      },
    })

    expect(createClientId()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('returns a UUID-shaped id when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)

    expect(createClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
