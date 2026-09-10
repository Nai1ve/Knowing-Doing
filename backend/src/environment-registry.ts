import type { EnvironmentTemplate, ExerciseKind, RuntimeKind } from './product-types.js'

export type EnvironmentCapability = {
  capabilityKey: string
  environmentKey: string
  environmentVersion: string
  provider: 'fixture' | 'model'
  status: 'available' | 'planned'
  exerciseKinds: readonly ExerciseKind[]
  aliases: readonly string[]
}

const templates: EnvironmentTemplate[] = [
  {
    key: 'python-pytest-v1', version: '1', runtimeKind: 'docker_workspace', status: 'available', displayName: 'Python + pytest 工作区',
    capabilityKeys: ['python.testing'], services: [{ key: 'python', role: 'runtime', displayName: 'Python 3.13' }], resourceProfile: 'small',
    assetPolicy: { allowedExtensions: ['.py', '.json', '.md', '.txt'], maxFiles: 10, maxTotalBytes: 2 * 1024 * 1024 },
    commandPolicy: { allowedCommandKeys: ['pytest', 'pytest_quiet'] },
    initializationContract: { supportsStarterFiles: true, supportsDatasetSeed: false, supportsSchemaSeed: false, supportsFaultSeed: false },
  },
  {
    key: 'mysql-performance-v1', version: '1', runtimeKind: 'mysql_lab', status: 'available', displayName: 'MySQL 性能实验环境',
    capabilityKeys: ['mysql.performance', 'mysql.slow-query'], services: [{ key: 'mysql', role: 'database', displayName: 'MySQL' }], resourceProfile: 'data-intensive',
    assetPolicy: { allowedExtensions: ['.sql', '.md', '.txt'], maxFiles: 8, maxTotalBytes: 1024 * 1024 },
    commandPolicy: { allowedCommandKeys: ['sql', 'explain', 'benchmark'] },
    initializationContract: { supportsStarterFiles: false, supportsDatasetSeed: true, supportsSchemaSeed: true, supportsFaultSeed: true },
  },
  ...plannedTemplate('go-test-v1', 'Go 测试工作区', 'go.testing', 'Go'),
  ...plannedTemplate('java-maven-v1', 'Java Maven 工作区', 'java.testing', 'Java'),
  ...plannedTemplate('rust-cargo-v1', 'Rust Cargo 工作区', 'rust.testing', 'Rust'),
  ...plannedTemplate('cpp-cmake-v1', 'C++ CMake 工作区', 'cpp.testing', 'C++'),
  ...plannedTemplate('go-redis-v1', 'Go + Redis 工作区', 'go.redis', 'Go'),
  ...plannedTemplate('kafka-kraft-v1', 'Kafka KRaft 实验环境', 'kafka.events', 'Kafka'),
]

function plannedTemplate(key: string, displayName: string, capabilityKey: string, runtimeName: string): EnvironmentTemplate[] {
  return [{
    key, version: '1', runtimeKind: 'docker_workspace', status: 'planned', displayName, capabilityKeys: [capabilityKey],
    services: [{ key: runtimeName.toLowerCase(), role: 'runtime', displayName: runtimeName }], resourceProfile: 'small',
    assetPolicy: { allowedExtensions: ['.md', '.txt'], maxFiles: 10, maxTotalBytes: 2 * 1024 * 1024 }, commandPolicy: { allowedCommandKeys: [] },
    initializationContract: { supportsStarterFiles: false, supportsDatasetSeed: false, supportsSchemaSeed: false, supportsFaultSeed: false },
  }]
}

const capabilities: EnvironmentCapability[] = [
  { capabilityKey: 'python.testing', environmentKey: 'python-pytest-v1', environmentVersion: '1', provider: 'fixture', status: 'available', exerciseKinds: ['code_repair', 'concept_drill'], aliases: ['Python 测试', 'pytest'] },
  { capabilityKey: 'mysql.performance', environmentKey: 'mysql-performance-v1', environmentVersion: '1', provider: 'fixture', status: 'available', exerciseKinds: ['data_diagnosis'], aliases: ['MySQL 性能'] },
  { capabilityKey: 'mysql.slow-query', environmentKey: 'mysql-performance-v1', environmentVersion: '1', provider: 'fixture', status: 'available', exerciseKinds: ['data_diagnosis'], aliases: ['MySQL 慢查询', 'EXPLAIN', '索引优化'] },
  { capabilityKey: 'go.testing', environmentKey: 'go-test-v1', environmentVersion: '1', provider: 'model', status: 'planned', exerciseKinds: ['code_repair', 'concept_drill'], aliases: ['Go 测试'] },
  { capabilityKey: 'java.testing', environmentKey: 'java-maven-v1', environmentVersion: '1', provider: 'model', status: 'planned', exerciseKinds: ['code_repair', 'concept_drill'], aliases: ['Java 测试'] },
  { capabilityKey: 'rust.testing', environmentKey: 'rust-cargo-v1', environmentVersion: '1', provider: 'model', status: 'planned', exerciseKinds: ['code_repair', 'concept_drill'], aliases: ['Rust 测试'] },
  { capabilityKey: 'cpp.testing', environmentKey: 'cpp-cmake-v1', environmentVersion: '1', provider: 'model', status: 'planned', exerciseKinds: ['code_repair', 'concept_drill'], aliases: ['C++ 测试'] },
]

export function getEnvironmentTemplate(key: string, version = '1'): EnvironmentTemplate | null {
  return templates.find((item) => item.key === key && item.version === version) ?? null
}

const commandAliases: Record<string, Record<string, string>> = {
  'python-pytest-v1': {
    pytest: 'pytest -q',
    pytest_quiet: 'pytest -q',
    'pytest -q': 'pytest -q',
    'python -m pytest -q': 'python -m pytest -q',
  },
}

/** Resolves a model-owned logical command key to a platform-owned command. */
export function resolveEnvironmentCommand(environmentKey: string, version: string, commandKey: string): string | null {
  const template = getEnvironmentTemplate(environmentKey, version)
  if (!template) return null
  if (commandAliases[environmentKey]?.[commandKey]) return commandAliases[environmentKey][commandKey]
  return template.commandPolicy.allowedCommandKeys.includes(commandKey) ? commandKey : null
}

export function getEnvironmentTemplateForCapability(capabilityKey: string): EnvironmentTemplate | null {
  const capability = getEnvironmentCapability(capabilityKey)
  return capability ? getEnvironmentTemplate(capability.environmentKey, capability.environmentVersion) : null
}

export function getEnvironmentCapability(capabilityKey: string): EnvironmentCapability | null {
  return capabilities.find((item) => item.capabilityKey === capabilityKey) ?? null
}

export function getEnvironmentCapabilityForTemplate(templateKey: string): EnvironmentCapability | null {
  return capabilities.find((item) => item.environmentKey === templateKey) ?? null
}

export function resolveCapability(capabilityKey: string): { capability: EnvironmentCapability; template: EnvironmentTemplate } | null {
  const capability = getEnvironmentCapability(capabilityKey)
  if (!capability || capability.status !== 'available') return null
  const template = getEnvironmentTemplate(capability.environmentKey, capability.environmentVersion)
  return template && template.status === 'available' ? { capability, template } : null
}

export function listEnvironmentTemplates(): readonly EnvironmentTemplate[] { return templates }

export function listEnvironmentCapabilities(): readonly EnvironmentCapability[] { return capabilities }

export function isRuntimeKind(value: string): value is RuntimeKind {
  return value === 'mysql_lab' || value === 'docker_workspace'
}
