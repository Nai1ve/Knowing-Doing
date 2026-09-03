import type { CaseId } from './domain.js'

export type CaseStage = 'observe' | 'hypothesize' | 'inspect' | 'attempt' | 'verify' | 'resolved'
export type PracticeStatus = 'active' | 'ready_to_close' | 'resolved' | 'ended'
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
export type WritingClusterKey = 'problem' | 'hypothesis' | 'evidence' | 'attempts' | 'solution' | 'principles'
export type WritingClusterStatus = 'pending' | 'accepted' | 'rejected'
export type WritingClusterMemberRole = 'primary' | 'supporting' | 'duplicate' | 'context'
export type WritingClusterSummaryStatus = 'rule_ready' | 'queued' | 'running' | 'model_ready' | 'model_failed'
export type WritingCapsuleStatus = 'rule_ready' | 'queued' | 'running' | 'model_ready' | 'model_failed'
export type WritingGenerationKind = 'capsule' | 'outline' | 'article' | 'draft' | 'humanize'
export type WritingGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'
export type WritingDraftPhase = 'indexing' | 'outlining' | 'drafting' | 'humanizing' | 'checking' | 'ready' | 'failed'
export type WritingDraftStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'

export type ArtifactKind = 'user_message' | 'sql' | 'explain' | 'benchmark' | 'result_set' | 'error' | 'external_text' | 'tutor_reply' | 'source_excerpt' | 'note_outline' | 'article_draft'
export type ArtifactSourceKind = 'user' | 'lab' | 'tutor' | 'zhihu' | 'global_search' | 'system'
export type VerificationStatus = 'verified_lab' | 'external_unverified' | 'model_generated' | 'source_verified' | 'not_applicable'

export interface Learner {
  id: string
  userId: string | null
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  displayName: string | null
  status: 'active' | 'disabled'
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

export type DiagnosticTargetKey = 'mysql_performance' | 'general'
export type DiagnosticSessionStatus = 'draft' | 'ready' | 'proposed' | 'confirmed' | 'superseded'
export type PlanProposalStatus = 'ready' | 'confirmed' | 'superseded'
export type LearningMode = 'lab' | 'unavailable'

export interface DiagnosticTurn {
  id: string
  sessionId: string
  position: number
  questionKey: string
  question: string
  answer: string
  createdAt: string
  updatedAt: string
}

export interface ProfileEvidence {
  id: string
  learnerId: string
  diagnosticSessionId: string
  evidenceKey: string
  sourceKind: 'user_input'
  content: string
  status: 'active' | 'superseded'
  createdAt: string
  updatedAt: string
}

export interface DiagnosticSession {
  id: string
  learnerId: string
  intakeId: string
  goal: string
  targetKey: DiagnosticTargetKey
  status: DiagnosticSessionStatus
  rulesVersion: string
  revision: number
  createdAt: string
  updatedAt: string
  turns: DiagnosticTurn[]
  evidence: ProfileEvidence[]
}

export interface PlanProposalUnit {
  position: number
  title: string
  objective: string
  caseId: CaseId | null
  status: PlanUnit['status']
  availability: PlanUnit['availability']
  learningMode: LearningMode
  estimatedMinutes: number
  rationale: string
  sourceRefs: string[]
}

export interface PlanProposal {
  id: string
  learnerId: string
  diagnosticSessionId: string
  inputFingerprint: string
  templateKey: string
  targetKey: DiagnosticTargetKey
  status: PlanProposalStatus
  rulesVersion: string
  revision: number
  inputSnapshot: Record<string, unknown>
  planSnapshot: { title: string; goal: string; planState: 'active' | 'pending_content'; units: PlanProposalUnit[] }
  rationale: Array<{ key: string; label: string; effect: string }>
  confirmedPlanId: string | null
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
  availability: 'available' | 'coming_soon'
  completedAt: string | null
  sourceRefs: string[]
  learningMode: LearningMode
  estimatedMinutes: number
  rationale: string
}

export interface LearningPlan {
  id: string
  learnerId: string
  intakeId: string
  title: string
  goal: string
  sourceStatus: 'local_catalog' | 'retrieved' | 'general_model_knowledge'
  status: 'draft' | 'confirmed' | 'active' | 'completed'
  templateKey: string
  revision: number
  weeklyMinutes: number | null
  createdAt: string
  updatedAt: string
  units: PlanUnit[]
  planState: 'active' | 'pending_content'
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

export type PracticePinTargetType = 'artifact' | 'source'

export interface PracticePin {
  id: string
  learnerId: string
  practiceRunId: string
  targetType: PracticePinTargetType
  targetId: string
  title: string
  body: string
  source: string
  url: string | null
  createdAt: string
}

export interface PracticeCompletionCheck {
  key: string
  label: string
  complete: boolean
  detail: string
}

export interface PracticeCompletion {
  status: 'in_progress' | 'ready_to_close' | 'resolved' | 'ended'
  ready: boolean
  checks: PracticeCompletionCheck[]
  missing: string[]
  summary: string
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
  pins: PracticePin[]
  completion: PracticeCompletion
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
  blocks: WritingSectionBlock[]
}

export interface WritingSectionBlock {
  id: string
  documentId: string
  sectionId: string
  position: number
  content: string
  blockType: 'heading' | 'paragraph' | 'code' | 'quote' | 'list'
  evidenceRefs: string[]
  sourceRefs: string[]
  referenceRoles: Record<string, 'lab' | 'source' | 'inherited'>
  revision: number
  createdAt: string
  updatedAt: string
}

export interface WritingDocumentBlock {
  id: string
  documentId: string
  position: number
  content: string
  blockType: 'heading' | 'paragraph' | 'code' | 'quote' | 'list'
  evidenceRefs: string[]
  sourceRefs: string[]
  referenceRoles: Record<string, 'lab' | 'source' | 'inherited'>
  referenceMarkers: string[]
  revision: number
  createdAt: string
  updatedAt: string
}

export interface WritingEvidenceReference {
  refType: 'artifact' | 'event' | 'source' | 'path_node'
  refId: string
  title: string
  content: string
  kind: string
  verificationStatus: string
  role: 'lab' | 'source' | 'inherited'
  url: string | null
  author: string | null
}

export interface WritingBlockEvidence {
  block: WritingSectionBlock | (WritingDocumentBlock & { sectionId: null })
  references: WritingEvidenceReference[]
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
  evidencePackId: string | null
  format: 'sectioned' | 'narrative'
  contentMarkdown: string
  sections: WritingSection[]
  claims: WritingClaim[]
  blocks: WritingDocumentBlock[]
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
  currentEvidencePackId: string | null
  materials: WritingMaterial[]
  documents: WritingDocument[]
  reviewItems: WritingReviewItem[]
  createdAt: string
  updatedAt: string
}

export interface WritingCluster {
  id: string
  projectId: string
  clusterKey: WritingClusterKey
  position: number
  title: string
  ruleSummary: string
  modelSummary: string | null
  relevance: string
  userNote: string | null
  status: WritingClusterStatus
  summaryStatus: WritingClusterSummaryStatus
  revision: number
  sourceFingerprint: string
  memberCount: number
  duplicateCount: number
  createdAt: string
  updatedAt: string
}

export interface WritingClusterMember {
  id: string
  clusterId: string
  refType: 'artifact' | 'source' | 'path_node'
  refId: string
  role: WritingClusterMemberRole
  displayOrder: number
  title: string
  excerpt: string
  kind: string
  verificationStatus: string
  createdAt: string
}

export interface WritingClusterOverview {
  projectId: string
  practiceRunId: string
  clusters: WritingCluster[]
  acceptedCount: number
  totalCount: number
  requiredAccepted: string[]
  canGenerateOutline: boolean
  capsules: WritingClusterCapsule[]
  curation: { status: 'not_started' | 'queued' | 'running' | 'succeeded' | 'failed'; jobId: string | null; error: string | null }
}

export interface WritingClusterDetail {
  cluster: WritingCluster
  members: WritingClusterMember[]
  nextCursor: string | null
}

export interface WritingClusterCapsule {
  id: string
  projectId: string
  clusterId: string
  inputFingerprint: string
  version: number
  ruleSummary: string
  modelSummary: string | null
  keyFindings: string[]
  turningPoints: string[]
  unresolvedQuestions: string[]
  status: WritingCapsuleStatus
  rawCount: number
  representativeCount: number
  omittedCount: number
  modelFailureCode: string | null
  modelFailureMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface WritingCapsuleMember {
  id: string
  capsuleId: string
  refType: 'artifact' | 'source' | 'path_node'
  refId: string
  role: WritingClusterMemberRole
  displayOrder: number
  title: string
  excerpt: string
  kind: string
  verificationStatus: string
}

export interface WritingEvidencePack {
  id: string
  projectId: string
  inputFingerprint: string
  version: number
  snapshot: Record<string, unknown>
  nodeCount: number
  charCount: number
  status: 'active' | 'superseded'
  createdAt: string
}

export interface WritingEvidenceItem {
  id: string
  projectId: string
  evidencePackId: string
  refType: 'artifact' | 'event' | 'path_node' | 'source'
  refId: string
  kind: string
  title: string
  body: string
  createdAt: string
  metadata: Record<string, unknown>
}

export interface WritingGenerationJob {
  id: string
  projectId: string
  kind: WritingGenerationKind
  inputFingerprint: string
  clientRequestId: string | null
  evidencePackId: string | null
  outlineDocumentId: string | null
  status: WritingGenerationStatus
  attemptCount: number
  provider: string | null
  model: string | null
  failureCode: string | null
  failureMessage: string | null
  resultDocumentId: string | null
  outputContent: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface WritingDraftRun {
  id: string
  projectId: string
  inputFingerprint: string
  status: WritingDraftStatus
  phase: WritingDraftPhase
  evidencePackId: string | null
  outlineJobId: string | null
  articleJobId: string | null
  draftJobId: string | null
  humanizeJobId: string | null
  outlineDocumentId: string | null
  articleDocumentId: string | null
  attemptCount: number
  failureCode: string | null
  failureMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface WritingWorkspace {
  practiceRunId: string
  draftRun: WritingDraftRun | null
  project: WritingProject | null
}
