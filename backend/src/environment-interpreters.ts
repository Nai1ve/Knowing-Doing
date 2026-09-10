import type { CaseSpec, EnvironmentTemplate, ExerciseSpecV2, ReferenceSolutionV2 } from './product-types.js'
import { getEnvironmentTemplate, resolveEnvironmentCommand } from './environment-registry.js'

export interface EnvironmentInterpreter {
  readonly environmentKey: string
  readonly environmentVersion: string
  validateCaseSpec(spec: CaseSpec): void
  validateExerciseSpec(spec: ExerciseSpecV2): void
  materializeExercise(spec: ExerciseSpecV2): CaseSpec
  validateReferenceSolution(solution: ReferenceSolutionV2): void
  resolveCommand(commandKey: string): string
  canExecute(command: string): boolean
}

function templateFor(key: string, version: string): EnvironmentTemplate {
  const template = getEnvironmentTemplate(key, version)
  if (!template || template.status !== 'available') throw new Error(`unsupported_environment:${key}@${version}`)
  return template
}

function validatePath(path: string, allowedExtensions: string[], kind: string): void {
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`invalid_${kind}_path:${path}`)
  if (!allowedExtensions.some((extension) => path.endsWith(extension))) throw new Error(`unsupported_${kind}_extension:${path}`)
}

function validateFiles(files: Array<{ path: string; content: string }>, template: EnvironmentTemplate, kind: string): void {
  const paths = new Set<string>(); let totalBytes = 0
  if (files.length === 0 || files.length > template.assetPolicy.maxFiles) throw new Error(`${kind}_file_count_out_of_range`)
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`duplicate_${kind}_path:${file.path}`)
    validatePath(file.path, template.assetPolicy.allowedExtensions, kind); paths.add(file.path)
    totalBytes += Buffer.byteLength(file.content, 'utf8')
  }
  if (totalBytes > template.assetPolicy.maxTotalBytes) throw new Error(`${kind}_files_too_large`)
}

export class RegisteredEnvironmentInterpreter implements EnvironmentInterpreter {
  readonly environmentKey: string
  readonly environmentVersion: string

  constructor(protected readonly template: EnvironmentTemplate) {
    this.environmentKey = template.key; this.environmentVersion = template.version
  }

  resolveCommand(commandKey: string): string {
    const resolved = resolveEnvironmentCommand(this.environmentKey, this.environmentVersion, commandKey)
    if (!resolved) throw new Error(`unsupported_command_key:${commandKey}`)
    return resolved
  }

  protected resolveExecutableCommand(command: string): boolean {
    return this.template.commandPolicy.allowedCommandKeys.includes(command)
  }

  canExecute(command: string): boolean {
    return this.resolveExecutableCommand(command)
  }

  validateCaseSpec(spec: CaseSpec): void {
    if ((spec.environment.key ?? spec.environment.templateKey) !== this.environmentKey) throw new Error('environment_template_mismatch')
    validateFiles(spec.starterFiles, this.template, 'starter')
    const commands = [...spec.verification.commands, ...spec.tasks.flatMap((task) => task.recommendedCommands)]
    for (const command of commands) if (!this.canExecute(command)) throw new Error(`unsupported_command:${command}`)
  }

  validateExerciseSpec(spec: ExerciseSpecV2): void {
    if (spec.environment.key !== this.environmentKey || spec.environment.version !== this.environmentVersion) throw new Error('environment_template_mismatch')
    if (spec.starterAssets.length === 0) throw new Error('starter_assets_required')
    const files = spec.starterAssets.filter((asset) => asset.kind === 'file' || asset.kind === 'fixture').map((asset) => {
      if (!asset.path) throw new Error(`asset_path_required:${asset.key}`)
      return { path: asset.path, content: asset.content }
    })
    if (files.length > 0) validateFiles(files, this.template, 'starter')
    for (const asset of spec.starterAssets) {
      const supported = asset.kind === 'file' || asset.kind === 'fixture'
        ? this.template.initializationContract.supportsStarterFiles
        : asset.kind === 'schema'
          ? this.template.initializationContract.supportsSchemaSeed
          : asset.kind === 'dataset_seed'
            ? this.template.initializationContract.supportsDatasetSeed
            : this.template.initializationContract.supportsFaultSeed
      if (!supported) throw new Error(`unsupported_asset_kind:${asset.kind}`)
    }
    for (const commandKey of [...spec.verification.commandKeys, ...spec.tasks.flatMap((task) => task.recommendedCommandKeys)]) this.resolveCommand(commandKey)
  }

  materializeExercise(spec: ExerciseSpecV2): CaseSpec {
    this.validateExerciseSpec(spec)
    const assets = spec.starterAssets.filter((asset) => asset.kind === 'file' || asset.kind === 'fixture')
    return {
      title: spec.title, scenario: spec.scenario, learningGoal: spec.learningGoal, difficulty: spec.difficulty,
      environment: { key: this.environmentKey, version: this.environmentVersion, templateKey: this.environmentKey, services: spec.environment.services },
      starterFiles: assets.map((asset) => ({ path: asset.path!, content: asset.content })),
      tasks: spec.tasks.map((task) => ({ ...task, recommendedCommands: task.recommendedCommandKeys.map((key) => this.resolveCommand(key)) })),
      verification: { commands: spec.verification.commandKeys.map((key) => this.resolveCommand(key)), successSignals: spec.verification.successSignals },
      tutorContext: spec.tutorContext,
    }
  }

  validateReferenceSolution(solution: ReferenceSolutionV2): void {
    const files = solution.assets.filter((asset) => asset.kind === 'file' || asset.kind === 'fixture').map((asset) => {
      if (!asset.path) throw new Error(`reference_asset_path_required:${asset.key}`)
      return { path: asset.path, content: asset.content }
    })
    if (files.length > 0) validateFiles(files, this.template, 'reference')
    for (const asset of solution.assets) if (asset.kind !== 'file' && asset.kind !== 'fixture') throw new Error(`unsupported_reference_asset_kind:${asset.kind}`)
    for (const key of solution.verificationCommandKeys) this.resolveCommand(key)
  }
}

class PythonPytestInterpreter extends RegisteredEnvironmentInterpreter {
  resolveCommand(commandKey: string): string {
    const normalized = commandKey.trim().replace(/\s+/g, ' ')
    if (/^python -m pytest [\w./-]+(?: [\w./-]+)*$/.test(normalized)) return normalized
    return super.resolveCommand(commandKey)
  }

  protected resolveExecutableCommand(command: string): boolean {
    const normalized = command.trim().replace(/\s+/g, ' ')
    return normalized === 'pytest -q' || normalized === 'python -m pytest -q' || /^python -m pytest [\w./-]+(?: [\w./-]+)*$/.test(normalized)
  }
}

export function getEnvironmentInterpreter(key: string, version = '1'): EnvironmentInterpreter {
  const template = templateFor(key, version)
  return template.key === 'python-pytest-v1' ? new PythonPytestInterpreter(template) : new RegisteredEnvironmentInterpreter(template)
}
