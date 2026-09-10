import { describe, expect, it } from 'vitest'
import { getEnvironmentCapability, getEnvironmentTemplate, getEnvironmentTemplateForCapability, listEnvironmentTemplates, resolveCapability } from '../src/environment-registry.js'

describe('environment registry', () => {
  it('resolves available Python and MySQL templates with distinct runtimes', () => {
    expect(getEnvironmentTemplateForCapability('python.testing')).toMatchObject({ key: 'python-pytest-v1', version: '1', runtimeKind: 'docker_workspace', status: 'available' })
    expect(getEnvironmentTemplateForCapability('mysql.slow-query')).toMatchObject({ key: 'mysql-performance-v1', version: '1', runtimeKind: 'mysql_lab', status: 'available' })
    expect(getEnvironmentCapability('mysql.slow-query')?.environmentKey).toBe('mysql-performance-v1')
    expect(resolveCapability('mysql.slow-query')).toMatchObject({ capability: { environmentVersion: '1' }, template: { key: 'mysql-performance-v1' } })
  })

  it('keeps unsupported future environments planned', () => {
    const go = getEnvironmentTemplate('go-test-v1')
    expect(go).toMatchObject({ status: 'planned', key: 'go-test-v1' })
    expect(listEnvironmentTemplates().filter((item) => item.status === 'available').map((item) => item.key)).toEqual(['python-pytest-v1', 'mysql-performance-v1'])
  })
})
