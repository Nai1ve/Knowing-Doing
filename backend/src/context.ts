import type { Artifact, CaseSpec, LearningCase, PathNode, PracticeEvent, PracticeRun, StageMemory } from './product-types.js'

export interface TutorContext {
  hot: { goal: string; caseId: string; stage: string; latestError: string | null; currentGap: string | null }
  recentEvents: Array<{ sequence: number; type: string; stage: string; payload: Record<string, unknown>; artifactRefs: string[] }>
  rawEvidence: Array<{ id: string; kind: string; verificationStatus: string; content: string; metadata: Record<string, unknown> }>
  path: Array<{ stage: string; judgment: string; outcome: string; judgmentChange: string | null; nextGap: string | null }>
  stageMemory: Array<{ stage: string; memory: Record<string, unknown>; sourceEventRefs: string[] }>
  availableSourceIds: string[]
  workspace?: WorkspaceTutorContext['workspace']
}

export interface WorkspaceTutorContext {
  hot: TutorContext['hot']
  recentEvents: TutorContext['recentEvents']
  rawEvidence: TutorContext['rawEvidence']
  path: TutorContext['path']
  stageMemory: TutorContext['stageMemory']
  availableSourceIds: string[]
  workspace: {
    status: string
    node: { title: string; summary: string; completionStandard: string }
    case: { title: string; scenario: string; learningGoal: string; difficulty: string; tutorContext: CaseSpec['tutorContext'] }
    currentTask: { key: string; instruction: string; recommendedCommands: string[]; expectedObservation: string } | null
    recentExecutions: Array<{ command: string; status: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number | null }>
    recentFiles: Array<{ path: string; revision: number; content: string }>
  }
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

function contextRoadmapNode(item: LearningCase): { title: string; summary: string; completionStandard: string } {
  const context = item.inputSnapshot.context
  if (!context || typeof context !== 'object') return { title: item.roadmapNodeId, summary: '', completionStandard: '' }
  const node = (context as Record<string, unknown>).roadmapNode
  if (!node || typeof node !== 'object') return { title: item.roadmapNodeId, summary: '', completionStandard: '' }
  const value = node as Record<string, unknown>
  return {
    title: typeof value.title === 'string' ? value.title : item.roadmapNodeId,
    summary: typeof value.summary === 'string' ? value.summary : '',
    completionStandard: typeof value.completionStandard === 'string' ? value.completionStandard : '',
  }
}

function workspaceArtifacts(artifacts: Artifact[]) {
  const recentFiles = artifacts.filter((artifact) => artifact.kind === 'workspace_file').slice(-6).map((artifact) => ({
    path: typeof artifact.metadata.path === 'string' ? artifact.metadata.path : 'unknown',
    revision: typeof artifact.metadata.revision === 'number' ? artifact.metadata.revision : 0,
    content: artifact.content.slice(0, 5000),
  }))
  const executionArtifacts = artifacts.filter((artifact) => artifact.kind === 'workspace_output' || artifact.kind === 'workspace_error')
  return { recentFiles, executionArtifacts }
}

export function buildWorkspaceTutorContext(input: {
  goal: string
  run: PracticeRun
  learningCase: LearningCase
  workspaceStatus: string
  events: PracticeEvent[]
  artifacts: Artifact[]
  pathNodes: PathNode[]
  stageMemories: StageMemory[]
  sourceIds?: string[]
}): WorkspaceTutorContext {
  const base = buildTutorContext(input)
  const { recentFiles, executionArtifacts } = workspaceArtifacts(input.artifacts)
  const executionByArtifact = new Map(executionArtifacts.map((artifact) => [artifact.id, artifact]))
  const recentExecutions = input.events.filter((event) => event.type === 'workspace_execution_finished').slice(-6).map((event) => {
    const artifact = event.artifactRefs.map((id) => executionByArtifact.get(id)).find(Boolean)
    const payload = event.payload
    return {
      command: typeof payload.command === 'string' ? payload.command : '',
      status: typeof payload.status === 'string' ? payload.status : 'unknown',
      exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
      stdout: artifact?.kind === 'workspace_output' ? artifact.content.slice(0, 4000) : '',
      stderr: artifact?.kind === 'workspace_error' ? artifact.content.slice(0, 4000) : '',
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
    }
  })
  const spec = input.learningCase.spec
  const executedCommands = new Set(recentExecutions.map((execution) => execution.command))
  const currentTask = spec?.tasks.find((task) => !task.recommendedCommands.some((command) => executedCommands.has(command))) ?? spec?.tasks.at(-1) ?? null
  const node = contextRoadmapNode(input.learningCase)
  return {
    ...base,
    rawEvidence: base.rawEvidence.filter((item) => item.kind === 'external_text' || item.kind.startsWith('workspace_')),
    workspace: {
      status: input.workspaceStatus,
      node,
      case: spec ? { title: spec.title, scenario: spec.scenario, learningGoal: spec.learningGoal, difficulty: spec.difficulty, tutorContext: spec.tutorContext } : { title: input.learningCase.id, scenario: '', learningGoal: input.goal, difficulty: 'unknown', tutorContext: { concepts: [], likelyMisconceptions: [], evidenceToNotice: [] } },
      currentTask: currentTask ? { key: currentTask.key, instruction: currentTask.instruction, recommendedCommands: currentTask.recommendedCommands, expectedObservation: currentTask.expectedObservation } : null,
      recentExecutions,
      recentFiles,
    },
  }
}
