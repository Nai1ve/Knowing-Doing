import type { LabCaseId, LabExecutionResult, LabSessionName } from './lab'

export type CaseStage = 'observe' | 'hypothesize' | 'inspect' | 'attempt' | 'verify' | 'resolved'

export interface ProductIntake { id: string; learnerId: string; goal: string; technology: string; outcome: string | null; weeklyMinutes: number | null; status: string; createdAt: string; updatedAt: string }
export interface ProductPlanUnit { id: string; planId: string; position: number; title: string; objective: string; caseId: LabCaseId | null; status: 'upcoming' | 'current' | 'completed'; sourceRefs: string[] }
export interface ProductPlan { id: string; learnerId: string; intakeId: string; title: string; goal: string; sourceStatus: string; status: string; createdAt: string; updatedAt: string; units: ProductPlanUnit[] }
export interface ProductPracticeRun { id: string; learnerId: string; planUnitId: string | null; caseId: LabCaseId; labRunId: string | null; stage: CaseStage; hintLevel: number; noProgressCount: number; status: 'active' | 'resolved' | 'ended'; createdAt: string; updatedAt: string }
export interface ProductArtifact { id: string; learnerId: string; practiceRunId: string | null; kind: string; sourceKind: string; verificationStatus: string; content: string; metadata: Record<string, unknown>; checksum: string; createdAt: string }
export interface ProductEvent { id: string; sequence: number; actor: string; type: string; stage: CaseStage; payload: Record<string, unknown>; artifactRefs: string[]; createdAt: string }
export interface ProductPathNode { id: string; stage: CaseStage; title: string; judgment: string; outcome: string; judgmentChange: string | null; nextGap: string | null; importance: string; eventRefs: string[]; artifactRefs: string[]; createdAt: string }
export interface ProductStageMemory { id: string; stage: CaseStage; memory: Record<string, unknown>; sourceEventRefs: string[]; version: number; updatedAt: string }
export interface ProductMemory { id: string; learnerId: string; category: string; topic: string; status: string; statement: string; scope: string; confidence: number; evidenceRefs: string[]; userNote: string | null; updatedAt: string }
export interface ProductTutorResponse { response: string; intent: string; currentGap: string; nextQuestion: string; suggestedActions: string[]; evidenceRefs: string[]; sourceRefs: Array<{ sourceId: string; reason: string }>; provider: 'model' | 'scripted'; sourceStatus: string }
export interface ProductTutorMessage { id: string; role: 'user' | 'assistant'; content: string; source?: string }
export interface ProductSnapshot { run: ProductPracticeRun; events: ProductEvent[]; artifacts: ProductArtifact[]; pathNodes: ProductPathNode[]; stageMemories: ProductStageMemory[]; memories: ProductMemory[]; tutorTurns: Array<{ id: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string; createdAt: string }> }
export interface ProductLabRun { runId: string; caseId: LabCaseId; revision: number; status: 'active'; fixtureVersion: string; expiresAt: string; idleExpiresAt: string; sessions: Array<{ id: string; name: LabSessionName; status: 'open' | 'closed' }> }
export interface ProductPracticeStart { practice: ProductPracticeRun; lab?: { run: ProductLabRun; accessToken: string }; queue?: { ticketId: string; caseId: LabCaseId; status: string; position?: number; pollAfterMs?: number; expiresAt: string } }
export interface ProductLabAccess { status: 'waiting' | 'ready' | 'expired' | 'cancelled'; ticketId?: string; run?: ProductLabRun; accessToken?: string }
export interface ProductLabExecution { execution: LabExecutionResult; run: ProductPracticeRun; snapshot: ProductSnapshot }
