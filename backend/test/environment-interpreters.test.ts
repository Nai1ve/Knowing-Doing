import { describe, expect, it } from 'vitest'
import { getEnvironmentInterpreter } from '../src/environment-interpreters.js'
import { parseCaseSpec, parseExerciseSpecV2 } from '../src/case-schemas.js'

const pythonExercise = {
  specVersion: 2,
  capabilityKey: 'python.testing',
  title: '列表边界练习',
  scenario: '阅读并修复列表处理逻辑。',
  learningGoal: '理解列表索引和切片。',
  difficulty: 'introductory',
  environment: { key: 'python-pytest-v1', version: '1', services: ['python'] },
  starterAssets: [{ kind: 'file', key: 'test', path: 'test_list.py', content: 'def test_list():\n    assert True\n' }],
  tasks: [{ key: 'observe', instruction: '运行测试。', recommendedCommandKeys: ['pytest_quiet'], expectedObservation: '测试结果可见。' }],
  verification: { commandKeys: ['pytest_quiet'], successSignals: ['1 passed'] },
  tutorContext: { concepts: ['list'], likelyMisconceptions: [], evidenceToNotice: ['pytest 输出'] },
}

describe('environment interpreters', () => {
  it('validates and materializes a versioned Python exercise', () => {
    const spec = parseExerciseSpecV2(pythonExercise)
    const materialized = getEnvironmentInterpreter('python-pytest-v1').materializeExercise(spec)
    expect(materialized.starterFiles[0]).toMatchObject({ path: 'test_list.py' })
    expect(materialized.verification.commands).toEqual(['pytest -q'])
  })

  it('keeps non-Python command policy outside the Python validator', () => {
    const mysql = parseCaseSpec({
      title: 'MySQL 观察', scenario: '观察查询计划。', learningGoal: '理解 EXPLAIN。', difficulty: 'applied',
      environment: { templateKey: 'mysql-performance-v1', services: ['mysql'] },
      starterFiles: [{ path: 'README.md', content: '观察 SQL' }],
      tasks: [{ key: 'observe', instruction: '查看计划。', recommendedCommands: ['explain'], expectedObservation: '计划可见。' }],
      verification: { commands: ['explain'], successSignals: ['rows'] },
      tutorContext: { concepts: ['EXPLAIN'], likelyMisconceptions: [], evidenceToNotice: ['执行结果'] },
    })
    expect(mysql.verification.commands).toEqual(['explain'])
    expect(getEnvironmentInterpreter('python-pytest-v1').canExecute('explain')).toBe(false)
  })

  it('rejects an asset that the selected environment cannot initialize', () => {
    expect(() => parseExerciseSpecV2({ ...pythonExercise, starterAssets: [{ kind: 'schema', key: 'schema', content: 'CREATE TABLE x' }] })).toThrow('unsupported_asset_kind:schema')
  })

  it('interprets the admitted Go template with its own file and command policy', () => {
    const spec = parseExerciseSpecV2({
      ...pythonExercise,
      capabilityKey: 'go.testing',
      environment: { key: 'go-test-v1', version: '1', services: ['go'] },
      starterAssets: [{ kind: 'file', key: 'module', path: 'go.mod', content: 'module example.com/test\n\ngo 1.24\n' }],
      tasks: [{ key: 'test', instruction: '运行 Go 测试。', recommendedCommandKeys: ['go_test'], expectedObservation: '测试输出可见。' }],
      verification: { commandKeys: ['go_test'], successSignals: ['ok'] },
    })
    const materialized = getEnvironmentInterpreter('go-test-v1').materializeExercise(spec)
    expect(materialized.environment.key).toBe('go-test-v1')
    expect(materialized.verification.commands).toEqual(['go test ./...'])
    expect(getEnvironmentInterpreter('go-test-v1').canExecute('python -c "import os"')).toBe(false)
  })
})
