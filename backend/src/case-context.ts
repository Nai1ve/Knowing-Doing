import { createHash } from 'node:crypto'
import { resolveCapability } from './environment-registry.js'
import { CaseBuilderError, type CaseBuilderContext, type CaseBuilderInput } from './case-builder.js'
import type { CaseSourceSnapshot, EnvironmentTemplate, SourceItem } from './product-types.js'

export interface FrozenCaseContext {
  fingerprint: string
  request: {
    roadmapNodeId: string
    inputKind: CaseBuilderInput['request']['input']['kind']
    brief: string | null
    desiredOutcome: string | null
    difficulty: CaseBuilderInput['request']['difficulty'] | null
  }
  environment: Pick<EnvironmentTemplate, 'key' | 'version' | 'runtimeKind' | 'displayName' | 'services' | 'resourceProfile' | 'initializationContract'> & { commandKeys: string[] }
  roadmapNode: CaseBuilderContext['roadmapNode']
  rationale: CaseBuilderContext['roadmapRationale']
  learnerProfile: CaseBuilderContext['learnerProfile']
  source: { id: string; title: string; author: string | null; url: string; excerpt: string; retrievedAt: string } | null
  sourceContent: { snapshotId: string; checksum: string; contentLength: number; contentMarkdown: string; segments: Array<{ segment: number; content: string }> } | null
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function hash(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex') }

function sourceSnapshot(source: SourceItem | null): FrozenCaseContext['source'] {
  if (!source) return null
  return { id: source.id, title: source.title, author: source.author, url: source.url, excerpt: source.excerpt.slice(0, 6000), retrievedAt: source.retrievedAt }
}

function snapshotContent(snapshot: CaseSourceSnapshot | null): FrozenCaseContext['sourceContent'] {
  if (!snapshot) return null
  const segments = snapshot.contentMarkdown.split(/\n{2,}/).map((content) => content.trim()).filter(Boolean).map((content, segment) => ({ segment, content: content.slice(0, 4000) }))
  return { snapshotId: snapshot.id, checksum: snapshot.contentChecksum, contentLength: snapshot.contentLength, contentMarkdown: snapshot.contentMarkdown.slice(0, 60000), segments }
}

export function compileCaseContext(input: CaseBuilderInput): FrozenCaseContext {
  const builderContext = input.context
  const roadmapNode = builderContext?.roadmapNode
  if (!roadmapNode) throw new CaseBuilderError('case_context_missing', '案例上下文缺少路线节点')
  const resolved = resolveCapability(roadmapNode.capabilityKey)
  if (!resolved) throw new CaseBuilderError('workspace_environment_unavailable', '案例上下文中的运行环境不可用')
  const environment = resolved.template
  const frozen = {
    request: {
      roadmapNodeId: input.request.roadmapNodeId,
      inputKind: input.request.input.kind,
      brief: input.request.input.kind === 'brief' ? input.request.input.brief ?? null : null,
      desiredOutcome: input.request.desiredOutcome ?? null,
      difficulty: input.request.difficulty ?? null,
    },
    environment: { key: environment.key, version: environment.version, runtimeKind: environment.runtimeKind, displayName: environment.displayName, services: environment.services, resourceProfile: environment.resourceProfile, initializationContract: environment.initializationContract, commandKeys: environment.commandPolicy.allowedCommandKeys },
    roadmapNode,
    rationale: builderContext.roadmapRationale,
    learnerProfile: builderContext.learnerProfile,
    source: sourceSnapshot(input.source),
    sourceContent: snapshotContent(input.sourceSnapshot ?? null),
  }
  return { ...frozen, fingerprint: hash(frozen) }
}

export function contextForPrompt(context: FrozenCaseContext): string {
  return JSON.stringify(context)
}
