import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const managedKeys = [
  'ZHIXING_IDENTITY_MODE', 'NODE_ENV', 'LAB_TOKEN_SECRET', 'SIGNED_DEVICE_SESSION_ENABLED',
  'ZHIHU_OAUTH_ENABLED', 'ZHIHU_LOGIN_REQUIRED', 'ZHIHU_SOURCE_SYNC_ENABLED', 'PRACTICE_CARD_V2_ENABLED',
  'PLANNER_ASSESSMENT_V2_ENABLED',
  'MIXED_GYM_ENABLED', 'ZHIHU_OAUTH_APP_ID', 'ZHIHU_OAUTH_APP_KEY',
  'OAUTH_TOKEN_ENCRYPTION_KEY', 'ALLOW_INSECURE_OAUTH_CALLBACK', 'PUBLIC_ORIGIN',
  'ZHIHU_OAUTH_REDIRECT_URI',
] as const
const originalEnvironment = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of managedKeys) {
    const original = originalEnvironment[key]
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

describe('identity mode configuration', () => {
  it('keeps planner assessment v2 disabled until explicitly enabled', () => {
    delete process.env.PLANNER_ASSESSMENT_V2_ENABLED
    expect(loadConfig().plannerAssessmentV2Enabled).toBe(false)
    process.env.PLANNER_ASSESSMENT_V2_ENABLED = 'true'
    expect(loadConfig().plannerAssessmentV2Enabled).toBe(true)
  })

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

  it('enforces the OAuth security and feature dependency gates', () => {
    process.env.NODE_ENV = 'production'
    process.env.LAB_TOKEN_SECRET = 'test-token-secret'
    process.env.ZHIXING_IDENTITY_MODE = 'client'
    process.env.SIGNED_DEVICE_SESSION_ENABLED = 'true'
    process.env.ZHIHU_OAUTH_ENABLED = 'true'
    process.env.ZHIHU_OAUTH_APP_ID = 'app-id'
    process.env.ZHIHU_OAUTH_APP_KEY = 'app-key'
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'x'.repeat(32)
    process.env.ALLOW_INSECURE_OAUTH_CALLBACK = 'true'
    process.env.PUBLIC_ORIGIN = 'http://119.45.243.102'
    process.env.ZHIHU_OAUTH_REDIRECT_URI = 'http://119.45.243.102/api/auth/oauth/zhihu/callback'

    expect(loadConfig().zhihuOauthEnabled).toBe(true)
    process.env.ZHIHU_OAUTH_REDIRECT_URI = 'http://example.test/callback'
    expect(() => loadConfig()).toThrow(/Zhihu OAuth requires/)
  })

  it('does not allow source sync or mixed Gym without their prerequisite flags', () => {
    process.env.NODE_ENV = 'production'
    process.env.LAB_TOKEN_SECRET = 'test-token-secret'
    process.env.ZHIHU_SOURCE_SYNC_ENABLED = 'true'
    expect(() => loadConfig()).toThrow(/ZHIHU_OAUTH_ENABLED=true/)
    delete process.env.ZHIHU_SOURCE_SYNC_ENABLED
    process.env.MIXED_GYM_ENABLED = 'true'
    expect(() => loadConfig()).toThrow(/PRACTICE_CARD_V2_ENABLED=true/)
  })

  it('requires signed device sessions and Zhihu OAuth before requiring Zhihu login', () => {
    process.env.NODE_ENV = 'production'
    process.env.LAB_TOKEN_SECRET = 'test-token-secret'
    process.env.ZHIHU_LOGIN_REQUIRED = 'true'
    expect(() => loadConfig()).toThrow(/SIGNED_DEVICE_SESSION_ENABLED=true/)

    process.env.SIGNED_DEVICE_SESSION_ENABLED = 'true'
    expect(() => loadConfig()).toThrow(/ZHIHU_OAUTH_ENABLED=true/)
  })
})
