export const MAX_FILE_BYTES = 262144
export const MAX_TOTAL_FILE_BYTES = 2 * 1024 * 1024

export function isValidWorkspacePath(path: string): boolean {
  return path.length > 0 && path.length <= 180 && !path.startsWith('/') && !path.includes('..') && !path.includes('\\') && /\.(py|json|md|txt)$/.test(path)
}

export function isValidPythonCommand(command: string, allowed: Set<string>): boolean {
  return (allowed.has(command) || command === 'pytest -q') && (command === 'pytest -q' || command === 'python -m pytest -q' || /^python -m pytest [\w./-]+(?: [\w./-]+)*$/.test(command))
}
