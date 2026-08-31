import type { CaseId } from './domain.js'

export type CaseStage = 'observe' | 'hypothesize' | 'inspect' | 'attempt' | 'verify' | 'resolved'
export type PracticeStatus = 'active' | 'resolved' | 'ended'
export type EventActor = 'system' | 'user' | 'tutor' | 'lab' | 'rule'
export type EventType =
  | 'case_presented'
  | 'user_message'
  | 'tutor_reply'
  | 'attempt_submitted'
  | 'evidence_captured'
  | 'artifact_added'
  | 'attempt_reviewed'
  | 'stage_transitioned'
  | 'memory_promoted'
  | 'note_outline_generated'
  | 'article_draft_generated'
  | 'writing_material_selected'
  | 'writing_section_edited'
  | 'tutor_failed'
  | 'lab_reopened'

export type WritingStatus = 'materials_ready' | 'outline_review' | 'article_review' | 'ready_for_preview'
export type WritingDocumentKind = 'outline' | 'article'
export type WritingDocumentStatus = 'draft' | 'generated' | 'needs_review' | 'confirmed'
export type WritingMaterialCategory = 'context' | 'symptom' | 'hypothesis' | 'evidence' | 'attempt' | 'solution' | 'source' | 'reflection'
export type WritingClaimKind = 'observed' | 'inferred' | 'source_based' | 'reflection' | 'recommendation'
export type WritingClaimStatus = 'supported' | 'needs_review' | 'unsupported'

export type ArtifactKind = 'user_message' | 'sql' | 'explain' | 'benchmark' | 'result_set' | 'error' | 'external_text' | 'tutor_reply' | 'source_excerpt' | 'note_outline' | 'article_draft'
export type ArtifactSourceKind = 'user' | 'lab' | 'tutor' | 'zhihu' | 'global_search' | 'system'
export type VerificationStatus = 'verified_lab' | 'external_unverified' | 'model_generated' | 'source_verified' | 'not_applicable'

export interface Learner {
  id: string
  createdAt: string
  updatedAt: string
}

export interface Intake {
  id: string
  learnerId: string
  goal: string
  technology: string
  outcome: string | null
  weeklyMinutes: number | null
  status: 'draft' | 'planned' | 'active' | 'completed'
  createdAt: string
  updatedAt: string
}

export interface PlanUnit {
  id: string
  planId: string
  position: number
  title: string
  objective: string
  caseId: CaseId | null
  status: 'upcoming' | 'current' | 'completed'
  sourceRefs: string[]
}

export interface LearningPlan {
  id: string
  learnerId: string
  intakeId: string
  title: string
  goal: string
  sourceStatus: 'local_catalog' | 'retrieved' | 'general_model_knowledge'
  status: 'draft' | 'confirmed' | 'active' | 'completed'
  createdAt: string
  updatedAt: string
  units: PlanUnit[]
}

export interface PracticeRun {
  id: string
  learnerId: string
  planUnitId: string | null
  caseId: CaseId
  labRunId: string | null
  stage: CaseStage
  hintLevel: number
  noProgressCount: number
  status: PracticeStatus
  createdAt: string
  updatedAt: string
}

export interface PracticeEvent {
  id: string
  learnerId: string
  practiceRunId: string
  sequence: number
  actor: EventActor
  type: EventType
  stage: CaseStage
  payload: Record<string, unknown>
  artifactRefs: string[]
  clientRequestId: string | null
  createdAt: string
}

export interface Artifact {
  id: string
  learnerId: string
  practiceRunId: string | null
  kind: ArtifactKind
  sourceKind: ArtifactSourceKind
  verificationStatus: VerificationStatus
  content: string
  metadata: Record<string, unknown>
  checksum: string
  createdAt: string
}

export interface PathNode {
  id: string
  practiceRunId: string
  stage: CaseStage
  title: string
  judgment: string
  outcome: string
  judgmentChange: string | null
  nextGap: string | null
  importance: 'low' | 'medium' | 'high'
  eventRefs: string[]
  artifactRefs: string[]
  createdAt: string
}

export interface StageMemory {
  id: string
  practiceRunId: string
  stage: CaseStage
  memory: Record<string, unknown>
  sourceEventRefs: string[]
  version: number
  updatedAt: string
}

export interface MemoryItem {
  id: string
  learnerId: string
  category: 'capability' | 'preference' | 'gap' | 'goal'
  topic: string
  status: 'active' | 'corrected' | 'deleted'
  statement: string
  scope: string
  confidence: number
  evidenceRefs: string[]
  userNote: string | null
  updatedAt: string
}

export interface SourceItem {
  id: string
  provider: 'zhihu' | 'global_search' | 'user_url'
  externalId: string | null
  title: string
  author: string | null
  url: string
  excerpt: string
  query: string | null
  retrievedAt: string
  metadata: Record<string, unknown>
}

export interface TutorSourceRef {
  sourceId: string
  reason: string
}

export interface TutorResponse {
  response: string
  intent: 'clarify' | 'triage' | 'evidence_request' | 'attempt_review' | 'tradeoff' | 'reflect'
  currentGap: string
  nextQuestion: string
  suggestedActions: string[]
  evidenceRefs: string[]
  sourceRefs: TutorSourceRef[]
  provider: 'model' | 'scripted'
  sourceStatus: 'retrieved' | 'general_model_knowledge' | 'not_needed' | 'unavailable'
}

export interface TutorSource {
  id: string
  title: string
  author: string | null
  url: string
  excerpt: string
  retrievedAt: string
  provider: SourceItem['provider']
  role: string
  reason: string
}

export interface PracticeSnapshot {
  run: PracticeRun
  events: PracticeEvent[]
  artifacts: Artifact[]
  pathNodes: PathNode[]
  stageMemories: StageMemory[]
  memories: MemoryItem[]
  tutorTurns: Array<{ id: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string; createdAt: string }>
}

export interface PracticeHistoryItem {
  id: string
  caseId: CaseId
  stage: CaseStage
  status: PracticeStatus
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastTutorProvider: string | null
  lastTutorSourceStatus: string | null
  labState: 'active' | 'reopen_required' | 'none'
}

export interface PracticeHistoryPage {
  items: PracticeHistoryItem[]
  nextCursor: string | null
}

export interface LabSegment {
  id: string
  practiceRunId: string
  labRunId: string
  fixtureVersion: string
  status: 'active' | 'ended'
  startedAt: string
  endedAt: string | null
  endedReason: string | null
}

export type TutorInvocationStatus = 'running' | 'succeeded' | 'failed' | 'interrupted'

export interface TutorInvocation {
  id: string
  practiceRunId: string
  userArtifactId: string
  clientRequestId: string
  provider: string
  model: string
  status: TutorInvocationStatus
  retrievalStatus: string
  sourceIds: string[]
  failureCode: string | null
  failureMessage: string | null
  latencyMs: number | null
  createdAt: string
  completedAt: string | null
}

export interface WritingMaterial {
  id: string
  projectId: string
  category: WritingMaterialCategory
  refType: 'artifact' | 'source' | 'event'
  refId: string
  title: string
  excerpt: string
  selected: boolean
  verificationStatus: VerificationStatus | 'source_verified'
  metadata: Record<string, unknown>
  createdAt: string
}

export interface WritingSection {
  id: string
  documentId: string
  sectionKey: string
  position: number
  title: string
  content: string
  required: boolean
  status: 'empty' | 'generated' | 'confirmed'
  evidenceRefs: string[]
  sourceRefs: string[]
  updatedAt: string
}

export interface WritingClaim {
  id: string
  documentId: string
  sectionId: string
  text: string
  kind: WritingClaimKind
  status: WritingClaimStatus
  evidenceRefs: string[]
  sourceRefs: string[]
  createdAt: string
}

export interface WritingReviewItem {
  id: string
  projectId: string
  code: string
  severity: 'info' | 'warning' | 'blocking'
  status: 'open' | 'resolved' | 'dismissed'
  message: string
  sectionId: string | null
  createdAt: string
}

export interface WritingDocument {
  id: string
  projectId: string
  kind: WritingDocumentKind
  revision: number
  status: WritingDocumentStatus
  title: string
  summary: string
  sections: WritingSection[]
  claims: WritingClaim[]
  createdAt: string
  updatedAt: string
}

export interface WritingProject {
  id: string
  learnerId: string
  practiceRunId: string
  articleType: 'engineering_practice_review'
  status: WritingStatus
  evidenceSnapshot: { capturedAt: string | null; materialIds: string[] }
  materials: WritingMaterial[]
  documents: WritingDocument[]
  reviewItems: WritingReviewItem[]
  createdAt: string
  updatedAt: string
}
