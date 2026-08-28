import type { Artifact, PathNode, PracticeEvent, PracticeRun, StageMemory } from './product-types.js'

export interface TutorContext {
  hot: { goal: string; caseId: string; stage: string; latestError: string | null; currentGap: string | null }
  recentEvents: Array<{ sequence: number; type: string; stage: string; payload: Record<string, unknown>; artifactRefs: string[] }>
  rawEvidence: Array<{ id: string; kind: string; verificationStatus: string; content: string; metadata: Record<string, unknown> }>
  path: Array<{ stage: string; judgment: string; outcome: string; judgmentChange: string | null; nextGap: string | null }>
  stageMemory: Array<{ stage: string; memory: Record<string, unknown>; sourceEventRefs: string[] }>
  availableSourceIds: string[]
}

export function buildTutorContext(input: { goal: string; run: PracticeRun; events: PracticeEvent[]; artifacts: Artifact[]; pathNodes: PathNode[]; stageMemories: StageMemory[]; sourceIds?: string[] }): TutorContext {
  const latestError = [...input.artifacts].reverse().find((artifact) => artifact.kind === 'error')
  const latestStageMemory = input.stageMemories.find((memory) => memory.stage === input.run.stage)
  const recentEvents = input.events.slice(-12).map((event) => ({ sequence: event.sequence, type: event.type, stage: event.stage, payload: event.payload, artifactRefs: event.artifactRefs }))
  const rawEvidence = input.artifacts.filter((artifact) => ['explain', 'benchmark', 'result_set', 'error', 'sql', 'external_text'].includes(artifact.kind)).slice(-10).map((artifact) => ({ id: artifact.id, kind: artifact.kind, verificationStatus: artifact.verificationStatus, content: artifact.content, metadata: artifact.metadata }))
  return {
    hot: { goal: input.goal, caseId: input.run.caseId, stage: input.run.stage, latestError: latestError?.content ?? null, currentGap: typeof latestStageMemory?.memory.currentGap === 'string' ? latestStageMemory.memory.currentGap : null },
    recentEvents,
    rawEvidence,
    path: input.pathNodes.slice(-8).map((node) => ({ stage: node.stage, judgment: node.judgment, outcome: node.outcome, judgmentChange: node.judgmentChange, nextGap: node.nextGap })),
    stageMemory: input.stageMemories.map((memory) => ({ stage: memory.stage, memory: memory.memory, sourceEventRefs: memory.sourceEventRefs })),
    availableSourceIds: input.sourceIds ?? [],
  }
}
