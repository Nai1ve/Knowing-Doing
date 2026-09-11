import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const originalIdentityMode = process.env.ZHIXING_IDENTITY_MODE
const originalNodeEnv = process.env.NODE_ENV
const originalTokenSecret = process.env.LAB_TOKEN_SECRET

afterEach(() => {
  if (originalIdentityMode === undefined) delete process.env.ZHIXING_IDENTITY_MODE
  else process.env.ZHIXING_IDENTITY_MODE = originalIdentityMode
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalTokenSecret === undefined) delete process.env.LAB_TOKEN_SECRET
  else process.env.LAB_TOKEN_SECRET = originalTokenSecret
})

describe('identity mode configuration', () => {
  it('keeps browser learner identity when client mode is explicitly configured', () => {
    process.env.NODE_ENV = 'production'
    process.env.ZHIXING_IDENTITY_MODE = 'client'
    process.env.LAB_TOKEN_SECRET = 'test-token-secret'

    expect(loadConfig().identityMode).toBe('client')
  })

  it('uses shared demo identity as the production default', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ZHIXING_IDENTITY_MODE
    process.env.LAB_TOKEN_SECRET = 'test-token-secret'

    expect(loadConfig().identityMode).toBe('shared_demo')
  })
})
