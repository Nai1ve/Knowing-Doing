export const MAX_FILE_BYTES = 262144
export const MAX_TOTAL_FILE_BYTES = 2 * 1024 * 1024

export type RunnerTemplatePolicy = {
  extensions: readonly string[]
  commands: readonly string[]
  defaultImageEnv: string
}

export const TEMPLATE_POLICIES: Record<string, RunnerTemplatePolicy> = {
  'python-pytest-v1': {
    extensions: ['.py', '.json', '.md', '.txt'],
    commands: ['pytest -q', 'python -m pytest -q'],
    defaultImageEnv: 'WORKSPACE_PYTHON_IMAGE',
  },
  'go-test-v1': {
    extensions: ['.go', '.mod', '.sum', '.md', '.txt'],
    commands: ['go test ./...'],
    defaultImageEnv: 'WORKSPACE_GO_IMAGE',
  },
}

export function getTemplatePolicy(templateKey: string): RunnerTemplatePolicy | null {
  return TEMPLATE_POLICIES[templateKey] ?? null
}

export function isValidWorkspacePath(path: string, extensions: readonly string[] = TEMPLATE_POLICIES['python-pytest-v1'].extensions): boolean {
  return path.length > 0 && path.length <= 180 && !path.startsWith('/') && !path.includes('..') && !path.includes('\\') && extensions.some((extension) => path.endsWith(extension))
}

export function isValidTemplateCommand(templateKey: string, command: string, allowed: Set<string>): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const policy = getTemplatePolicy(templateKey)
  if (!policy) return false
  if (allowed.has(normalized) && policy.commands.includes(normalized)) return true
  return templateKey === 'python-pytest-v1' && allowed.has(normalized) && /^python -m pytest [\w./-]+(?: [\w./-]+)*$/.test(normalized)
}

export function isValidPythonCommand(command: string, allowed: Set<string>): boolean {
  return isValidTemplateCommand('python-pytest-v1', command, allowed)
}

export function isValidGoCommand(command: string, allowed: Set<string>): boolean {
  return isValidTemplateCommand('go-test-v1', command, allowed)
}
