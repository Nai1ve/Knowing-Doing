import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { assertProductMigrations, openProductDatabase } from './product-migrate.js'
import { evaluatePracticeCompletion } from './coach.js'
import type {
  Artifact, ArtifactKind, ArtifactSourceKind, CaseStage, DiagnosticSession, DiagnosticSessionStatus, DiagnosticTargetKey, DiagnosticTurn, EventActor, EventType, Intake, LearningPlan,
  LabSegment, Learner, MemoryItem, PathNode, PlanProposal, PlanProposalStatus, PlanProposalUnit, PlanUnit, PracticeEvent, PracticePin, PracticeRun, PracticeSnapshot, ProfileEvidence, SourceItem,
  StageMemory, TutorInvocation, TutorInvocationStatus, VerificationStatus, WritingBlockEvidence, WritingEvidenceReference, WritingCapsuleMember, WritingClusterCapsule, WritingClaim, WritingCluster, WritingClusterDetail, WritingClusterKey, WritingClusterMember, WritingClusterMemberRole, WritingClusterOverview, WritingClusterStatus, WritingClusterSummaryStatus, WritingDocument, WritingDocumentBlock, WritingEvidenceItem, WritingEvidencePack, WritingGenerationJob, WritingGenerationKind, WritingGenerationStatus, WritingMaterial, WritingProject, WritingReviewItem, WritingSection, WritingSectionBlock, WritingDraftRun, WritingDraftPhase, WritingDraftStatus,
} from './product-types.js'

type Row = Record<string, unknown>

export interface WritingClusterDefinition {
  clusterKey: WritingClusterKey
  position: number
  title: string
  ruleSummary: string
  relevance: string
  members: Array<{ refType: 'artifact' | 'source' | 'path_node'; refId: string; role: WritingClusterMemberRole }>
}

export interface WritingCapsuleDefinition {
  clusterId: string
  inputFingerprint: string
  ruleSummary: string
  keyFindings: string[]
  turningPoints: string[]
  unresolvedQuestions: string[]
  rawCount: number
  members: Array<{ refType: 'artifact' | 'source' | 'path_node'; refId: string; role: WritingClusterMemberRole }>
}

function text(row: Row, key: string): string {
  return String(row[key])
}

function nullableText(row: Row, key: string): string | null {
  return row[key] == null ? null : String(row[key])
}

function number(row: Row, key: string): number {
  return Number(row[key])
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function learnerFrom(row: Row): Learner {
  return { id: text(row, 'id'), userId: nullableText(row, 'user_id'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function intakeFrom(row: Row): Intake {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), goal: text(row, 'goal'), technology: text(row, 'technology'),
    outcome: nullableText(row, 'outcome'), weeklyMinutes: row.weekly_minutes == null ? null : number(row, 'weekly_minutes'),
    status: text(row, 'status') as Intake['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function unitFrom(row: Row): PlanUnit {
  return {
    id: text(row, 'id'), planId: text(row, 'plan_id'), position: number(row, 'position'), title: text(row, 'title'),
    objective: text(row, 'objective'), caseId: nullableText(row, 'case_id') as PlanUnit['caseId'],
    status: text(row, 'status') as PlanUnit['status'], availability: text(row, 'availability') as PlanUnit['availability'], completedAt: nullableText(row, 'completed_at'), sourceRefs: json<string[]>(row.source_refs_json, []),
    learningMode: (nullableText(row, 'learning_mode') ?? (row.case_id ? 'lab' : 'unavailable')) as PlanUnit['learningMode'], estimatedMinutes: row.estimated_minutes == null ? 60 : number(row, 'estimated_minutes'), rationale: nullableText(row, 'rationale') ?? '',
  }
}

function planFrom(row: Row, units: PlanUnit[]): LearningPlan {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), intakeId: text(row, 'intake_id'), title: text(row, 'title'),
    goal: text(row, 'goal'), sourceStatus: text(row, 'source_status') as LearningPlan['sourceStatus'],
    status: text(row, 'status') as LearningPlan['status'], templateKey: text(row, 'template_key'), revision: number(row, 'revision'), weeklyMinutes: row.weekly_minutes == null ? null : number(row, 'weekly_minutes'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), units,
    planState: (nullableText(row, 'plan_state') ?? 'active') as LearningPlan['planState'],
  }
}

function diagnosticTurnFrom(row: Row): DiagnosticTurn {
  return { id: text(row, 'id'), sessionId: text(row, 'session_id'), position: number(row, 'position'), questionKey: text(row, 'question_key'), question: text(row, 'question'), answer: text(row, 'answer'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function profileEvidenceFrom(row: Row): ProfileEvidence {
  return { id: text(row, 'id'), learnerId: text(row, 'learner_id'), diagnosticSessionId: text(row, 'diagnostic_session_id'), evidenceKey: text(row, 'evidence_key'), sourceKind: 'user_input', content: text(row, 'content'), status: text(row, 'status') as ProfileEvidence['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function diagnosticSessionFrom(row: Row, turns: DiagnosticTurn[], evidence: ProfileEvidence[]): DiagnosticSession {
  return { id: text(row, 'id'), learnerId: text(row, 'learner_id'), intakeId: text(row, 'intake_id'), goal: text(row, 'goal'), targetKey: text(row, 'target_key') as DiagnosticTargetKey, status: text(row, 'status') as DiagnosticSessionStatus, rulesVersion: text(row, 'rules_version'), revision: number(row, 'revision'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), turns, evidence }
}

function proposalFrom(row: Row): PlanProposal {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), diagnosticSessionId: text(row, 'diagnostic_session_id'), inputFingerprint: text(row, 'input_fingerprint'),
    templateKey: text(row, 'template_key'), targetKey: text(row, 'target_key') as DiagnosticTargetKey, status: text(row, 'status') as PlanProposalStatus,
    rulesVersion: text(row, 'rules_version'), revision: number(row, 'revision'), inputSnapshot: json<Record<string, unknown>>(row.input_snapshot_json, {}),
    planSnapshot: json<PlanProposal['planSnapshot']>(row.plan_snapshot_json, { title: '', goal: '', planState: 'pending_content', units: [] }),
    rationale: json<PlanProposal['rationale']>(row.rationale_json, []), confirmedPlanId: nullableText(row, 'confirmed_plan_id'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function runFrom(row: Row): PracticeRun {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), planUnitId: nullableText(row, 'plan_unit_id'),
    caseId: text(row, 'case_id') as PracticeRun['caseId'], labRunId: nullableText(row, 'lab_run_id'),
    stage: text(row, 'stage') as CaseStage, hintLevel: number(row, 'hint_level'), noProgressCount: number(row, 'no_progress_count'),
    status: text(row, 'status') as PracticeRun['status'], createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function eventFrom(row: Row): PracticeEvent {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), sequence: number(row, 'sequence'),
    actor: text(row, 'actor') as EventActor, type: text(row, 'type') as EventType, stage: text(row, 'stage') as CaseStage,
    payload: json<Record<string, unknown>>(row.payload_json, {}), artifactRefs: json<string[]>(row.artifact_refs_json, []),
    clientRequestId: nullableText(row, 'client_request_id'), createdAt: text(row, 'created_at'),
  }
}

function artifactFrom(row: Row): Artifact {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: nullableText(row, 'practice_run_id'),
    kind: text(row, 'kind') as ArtifactKind, sourceKind: text(row, 'source_kind') as ArtifactSourceKind,
    verificationStatus: text(row, 'verification_status') as VerificationStatus, content: text(row, 'content'),
    metadata: json<Record<string, unknown>>(row.metadata_json, {}), checksum: text(row, 'checksum'), createdAt: text(row, 'created_at'),
  }
}

function pathNodeFrom(row: Row): PathNode {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), stage: text(row, 'stage') as CaseStage,
    title: text(row, 'title'), judgment: text(row, 'judgment'), outcome: text(row, 'outcome'), judgmentChange: nullableText(row, 'judgment_change'),
    nextGap: nullableText(row, 'next_gap'), importance: text(row, 'importance') as PathNode['importance'],
    eventRefs: json<string[]>(row.event_refs_json, []), artifactRefs: json<string[]>(row.artifact_refs_json, []), createdAt: text(row, 'created_at'),
  }
}

function stageMemoryFrom(row: Row): StageMemory {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), stage: text(row, 'stage') as CaseStage,
    memory: json<Record<string, unknown>>(row.memory_json, {}), sourceEventRefs: json<string[]>(row.source_event_refs_json, []),
    version: number(row, 'version'), updatedAt: text(row, 'updated_at'),
  }
}

function memoryFrom(row: Row): MemoryItem {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), category: text(row, 'category') as MemoryItem['category'],
    topic: text(row, 'topic'), status: text(row, 'status') as MemoryItem['status'], statement: text(row, 'statement'), scope: text(row, 'scope'),
    confidence: Number(row.confidence), evidenceRefs: json<string[]>(row.evidence_refs_json, []), userNote: nullableText(row, 'user_note'), updatedAt: text(row, 'updated_at'),
  }
}

function sourceFrom(row: Row): SourceItem {
  return {
    id: text(row, 'id'), provider: text(row, 'provider') as SourceItem['provider'], externalId: nullableText(row, 'external_id'),
    title: text(row, 'title'), author: nullableText(row, 'author'), url: text(row, 'url'), excerpt: text(row, 'excerpt'),
    query: nullableText(row, 'query'), retrievedAt: text(row, 'retrieved_at'), metadata: json<Record<string, unknown>>(row.metadata_json, {}),
  }
}

function labSegmentFrom(row: Row): LabSegment {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), labRunId: text(row, 'lab_run_id'),
    fixtureVersion: text(row, 'fixture_version'), status: text(row, 'status') as LabSegment['status'],
    startedAt: text(row, 'started_at'), endedAt: nullableText(row, 'ended_at'), endedReason: nullableText(row, 'ended_reason'),
  }
}

function tutorInvocationFrom(row: Row): TutorInvocation {
  return {
    id: text(row, 'id'), practiceRunId: text(row, 'practice_run_id'), userArtifactId: text(row, 'user_artifact_id'),
    clientRequestId: text(row, 'client_request_id'), provider: text(row, 'provider'), model: text(row, 'model'),
    status: text(row, 'status') as TutorInvocationStatus, retrievalStatus: text(row, 'retrieval_status'),
    sourceIds: json<string[]>(row.source_ids_json, []), failureCode: nullableText(row, 'failure_code'),
    failureMessage: nullableText(row, 'failure_message'), latencyMs: row.latency_ms == null ? null : number(row, 'latency_ms'),
    createdAt: text(row, 'created_at'), completedAt: nullableText(row, 'completed_at'),
  }
}

function practicePinFrom(row: Row): PracticePin {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'),
    targetType: text(row, 'target_type') as PracticePin['targetType'], targetId: text(row, 'target_id'),
    title: text(row, 'title'), body: text(row, 'body'), source: text(row, 'source'), url: nullableText(row, 'url'), createdAt: text(row, 'created_at'),
  }
}

function writingMaterialFrom(row: Row): WritingMaterial {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), category: text(row, 'category') as WritingMaterial['category'],
    refType: text(row, 'ref_type') as WritingMaterial['refType'], refId: text(row, 'ref_id'), title: text(row, 'title'),
    excerpt: text(row, 'excerpt'), selected: Number(row.selected) === 1,
    verificationStatus: text(row, 'verification_status') as WritingMaterial['verificationStatus'], metadata: json<Record<string, unknown>>(row.metadata_json, {}), createdAt: text(row, 'created_at'),
  }
}

function writingBlockFrom(row: Row): WritingSectionBlock {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), sectionId: text(row, 'section_id'), position: number(row, 'position'),
    content: text(row, 'content'), blockType: text(row, 'block_type') as WritingSectionBlock['blockType'],
    evidenceRefs: json<string[]>(row.evidence_refs_json, []), sourceRefs: json<string[]>(row.source_refs_json, []),
    referenceRoles: json<Record<string, WritingSectionBlock['referenceRoles'][string]>>(row.reference_roles_json, {}),
    revision: number(row, 'revision'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function writingDocumentBlockFrom(row: Row): WritingDocumentBlock {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), position: number(row, 'position'), content: text(row, 'content'),
    blockType: text(row, 'block_type') as WritingDocumentBlock['blockType'], evidenceRefs: json<string[]>(row.evidence_refs_json, []),
    sourceRefs: json<string[]>(row.source_refs_json, []), referenceRoles: json<WritingDocumentBlock['referenceRoles']>(row.reference_roles_json, {}), referenceMarkers: json<string[]>(row.reference_markers_json, []),
    revision: number(row, 'revision'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function writingEvidenceItemFrom(row: Row): WritingEvidenceItem {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), evidencePackId: text(row, 'evidence_pack_id'),
    refType: text(row, 'ref_type') as WritingEvidenceItem['refType'], refId: text(row, 'ref_id'), kind: text(row, 'kind'),
    title: text(row, 'title'), body: text(row, 'body'), createdAt: text(row, 'created_at'), metadata: json<Record<string, unknown>>(row.metadata_json, {}),
  }
}

function writingSectionFrom(row: Row, blocks: WritingSectionBlock[] = []): WritingSection {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), sectionKey: text(row, 'section_key'), position: number(row, 'position'),
    title: text(row, 'title'), content: text(row, 'content'), required: Number(row.required) === 1,
    status: text(row, 'status') as WritingSection['status'], evidenceRefs: json<string[]>(row.evidence_refs_json, []), sourceRefs: json<string[]>(row.source_refs_json, []), updatedAt: text(row, 'updated_at'),
    blocks,
  }
}

function writingClaimFrom(row: Row): WritingClaim {
  return {
    id: text(row, 'id'), documentId: text(row, 'document_id'), sectionId: text(row, 'section_id'), text: text(row, 'text'),
    kind: text(row, 'kind') as WritingClaim['kind'], status: text(row, 'status') as WritingClaim['status'],
    evidenceRefs: json<string[]>(row.evidence_refs_json, []), sourceRefs: json<string[]>(row.source_refs_json, []), createdAt: text(row, 'created_at'),
  }
}

function writingDocumentFrom(row: Row, sections: WritingSection[], claims: WritingClaim[], blocks: WritingDocumentBlock[] = []): WritingDocument {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), kind: text(row, 'kind') as WritingDocument['kind'], revision: number(row, 'revision'), status: text(row, 'status') as WritingDocument['status'], title: text(row, 'title'), summary: text(row, 'summary'), evidencePackId: nullableText(row, 'evidence_pack_id'), format: (nullableText(row, 'format') ?? 'sectioned') as WritingDocument['format'], contentMarkdown: nullableText(row, 'content_markdown') ?? '', sections, claims, blocks, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function writingReviewItemFrom(row: Row): WritingReviewItem {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), code: text(row, 'code'), severity: text(row, 'severity') as WritingReviewItem['severity'],
    status: text(row, 'status') as WritingReviewItem['status'], message: text(row, 'message'), sectionId: nullableText(row, 'section_id'), createdAt: text(row, 'created_at'),
  }
}

function writingClusterFrom(row: Row): WritingCluster {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), clusterKey: text(row, 'cluster_key') as WritingClusterKey,
    position: number(row, 'position'), title: text(row, 'title'), ruleSummary: text(row, 'rule_summary'),
    modelSummary: nullableText(row, 'model_summary'), relevance: text(row, 'relevance'), userNote: nullableText(row, 'user_note'),
    status: text(row, 'status') as WritingClusterStatus, summaryStatus: text(row, 'summary_status') as WritingClusterSummaryStatus,
    revision: number(row, 'revision'), sourceFingerprint: text(row, 'source_fingerprint'),
    memberCount: number(row, 'member_count'), duplicateCount: number(row, 'duplicate_count'),
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function writingClusterMemberFrom(row: Row): WritingClusterMember {
  return {
    id: text(row, 'id'), clusterId: text(row, 'cluster_id'), refType: text(row, 'ref_type') as WritingClusterMember['refType'],
    refId: text(row, 'ref_id'), role: text(row, 'role') as WritingClusterMemberRole, displayOrder: number(row, 'display_order'),
    title: text(row, 'title'), excerpt: text(row, 'excerpt'), kind: text(row, 'kind'), verificationStatus: text(row, 'verification_status'), createdAt: text(row, 'created_at'),
  }
}

function writingCapsuleFrom(row: Row): WritingClusterCapsule {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), clusterId: text(row, 'cluster_id'), inputFingerprint: text(row, 'input_fingerprint'),
    version: number(row, 'version'), ruleSummary: text(row, 'rule_summary'), modelSummary: nullableText(row, 'model_summary'),
    keyFindings: json<string[]>(row.key_findings_json, []), turningPoints: json<string[]>(row.turning_points_json, []), unresolvedQuestions: json<string[]>(row.unresolved_questions_json, []),
    status: text(row, 'status') as WritingClusterCapsule['status'], rawCount: number(row, 'raw_count'), representativeCount: number(row, 'representative_count'), omittedCount: number(row, 'omitted_count'),
    modelFailureCode: nullableText(row, 'model_failure_code'), modelFailureMessage: nullableText(row, 'model_failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function writingCapsuleMemberFrom(row: Row): WritingCapsuleMember {
  return {
    id: text(row, 'id'), capsuleId: text(row, 'capsule_id'), refType: text(row, 'ref_type') as WritingCapsuleMember['refType'], refId: text(row, 'ref_id'), role: text(row, 'role') as WritingCapsuleMember['role'], displayOrder: number(row, 'display_order'),
    title: text(row, 'title'), excerpt: text(row, 'excerpt'), kind: text(row, 'kind'), verificationStatus: text(row, 'verification_status'),
  }
}

function writingEvidencePackFrom(row: Row): WritingEvidencePack {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), inputFingerprint: text(row, 'input_fingerprint'), version: number(row, 'version'), snapshot: json<Record<string, unknown>>(row.snapshot_json, {}), nodeCount: number(row, 'node_count'), charCount: number(row, 'char_count'), status: text(row, 'status') as WritingEvidencePack['status'], createdAt: text(row, 'created_at') }
}

function writingGenerationJobFrom(row: Row): WritingGenerationJob {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), kind: text(row, 'kind') as WritingGenerationKind, inputFingerprint: text(row, 'input_fingerprint'), clientRequestId: nullableText(row, 'client_request_id'), evidencePackId: nullableText(row, 'evidence_pack_id'), outlineDocumentId: nullableText(row, 'outline_document_id'),
    status: text(row, 'status') as WritingGenerationStatus, attemptCount: number(row, 'attempt_count'), provider: nullableText(row, 'provider'), model: nullableText(row, 'model'), failureCode: nullableText(row, 'failure_code'), failureMessage: nullableText(row, 'failure_message'), resultDocumentId: nullableText(row, 'result_document_id'), outputContent: nullableText(row, 'output_content'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), completedAt: nullableText(row, 'completed_at'),
  }
}

function writingDraftRunFrom(row: Row): WritingDraftRun {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), inputFingerprint: text(row, 'input_fingerprint'),
    status: text(row, 'status') as WritingDraftStatus, phase: text(row, 'phase') as WritingDraftPhase,
    evidencePackId: nullableText(row, 'evidence_pack_id'), outlineJobId: nullableText(row, 'outline_job_id'), articleJobId: nullableText(row, 'article_job_id'), draftJobId: nullableText(row, 'draft_job_id'), humanizeJobId: nullableText(row, 'humanize_job_id'),
    outlineDocumentId: nullableText(row, 'outline_document_id'), articleDocumentId: nullableText(row, 'article_document_id'), attemptCount: number(row, 'attempt_count'),
    failureCode: nullableText(row, 'failure_code'), failureMessage: nullableText(row, 'failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), completedAt: nullableText(row, 'completed_at'),
  }
}

export interface CreateArtifactInput {
  learnerId: string
  practiceRunId?: string | null
  kind: ArtifactKind
  sourceKind: ArtifactSourceKind
  verificationStatus: VerificationStatus
  content: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface AppendEventInput {
  learnerId: string
  practiceRunId: string
  actor: EventActor
  type: EventType
  stage: CaseStage
  payload: Record<string, unknown>
  artifactRefs?: string[]
  clientRequestId?: string | null
}

interface WritingBlockDraft {
  content: string
  position: number
  blockType?: WritingSectionBlock['blockType']
  evidenceRefs: string[]
  sourceRefs: string[]
  referenceRoles?: WritingSectionBlock['referenceRoles']
}

interface NarrativeBlockDraft {
  content: string
  position: number
  blockType: WritingDocumentBlock['blockType']
  evidenceRefs: string[]
  sourceRefs: string[]
  referenceRoles?: WritingDocumentBlock['referenceRoles']
  referenceMarkers?: string[]
}

function markdownFromNarrativeBlocks(blocks: WritingDocumentBlock[]): string {
  return blocks.map((block) => {
    const refs = block.referenceMarkers.length > 0 ? block.referenceMarkers : [...block.evidenceRefs.map((id) => `[[ref:artifact:${id}]]`), ...block.sourceRefs.map((id) => `[[ref:source:${id}]]`)]
    return `${block.content}${refs.join('')}`
  }).join('\n\n')
}

function fallbackBlocks(section: { content: string; evidenceRefs: string[]; sourceRefs: string[] }): WritingBlockDraft[] {
  const lines = section.content.split(/\n{2,}|\n/).map((item) => item.trim()).filter(Boolean)
  return (lines.length > 0 ? lines : ['']).map((content, position) => ({ content, position, evidenceRefs: section.evidenceRefs, sourceRefs: section.sourceRefs, referenceRoles: Object.fromEntries([...section.evidenceRefs.map((id) => [id, 'inherited']), ...section.sourceRefs.map((id) => [id, 'inherited'])]) as WritingSectionBlock['referenceRoles'] }))
}

export interface PracticeHistoryRecord {
  run: PracticeRun
  lastActivityAt: string
  lastTutorProvider: string | null
  lastTutorSourceStatus: string | null
}

export class ProductRepository {
  readonly db: Database.Database

  constructor(dbPath: string, database?: Database.Database) {
    this.db = database ?? openProductDatabase(dbPath)
    assertProductMigrations(this.db)
  }

  close(): void { if (this.db.open) this.db.close() }

  ensureLearner(learnerId: string): Learner {
    const now = new Date().toISOString()
    this.db.prepare('INSERT OR IGNORE INTO learners(id, created_at, updated_at) VALUES (?, ?, ?)').run(learnerId, now, now)
    this.db.prepare('UPDATE learners SET updated_at = ? WHERE id = ?').run(now, learnerId)
    return learnerFrom(this.db.prepare('SELECT * FROM learners WHERE id = ?').get(learnerId) as Row)
  }

  createIntake(input: { learnerId: string; goal: string; technology: string; outcome?: string | null; weeklyMinutes?: number | null }): Intake {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(id, input.learnerId, input.goal, input.technology, input.outcome ?? null, input.weeklyMinutes ?? null, now, now)
    return this.getIntake(id)
  }

  getIntake(id: string): Intake {
    const row = this.db.prepare('SELECT * FROM intakes WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Intake not found: ${id}`)
    return intakeFrom(row)
  }

  getIntakeForLearner(id: string, learnerId: string): Intake {
    const row = this.db.prepare('SELECT * FROM intakes WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new Error(`Intake not found: ${id}`)
    return intakeFrom(row)
  }

  createPlan(input: { learnerId: string; intakeId: string; title: string; goal: string; sourceStatus: LearningPlan['sourceStatus']; templateKey?: string; planState?: LearningPlan['planState']; units: Array<Omit<PlanUnit, 'id' | 'planId' | 'availability' | 'completedAt' | 'learningMode' | 'estimatedMinutes' | 'rationale'> & { availability?: PlanUnit['availability']; completedAt?: string | null; learningMode?: PlanUnit['learningMode']; estimatedMinutes?: number; rationale?: string }> }): LearningPlan {
    const planId = randomUUID(); const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, plan_state, template_key, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(planId, input.learnerId, input.intakeId, input.title, input.goal, input.sourceStatus, input.templateKey ? 'active' : 'draft', input.planState ?? 'active', input.templateKey ?? 'legacy', now, now)
      const insert = this.db.prepare(`INSERT INTO plan_units(id, plan_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const unit of input.units) insert.run(randomUUID(), planId, unit.position, unit.title, unit.objective, unit.caseId, unit.status, unit.availability ?? 'available', unit.learningMode ?? (unit.caseId ? 'lab' : 'unavailable'), unit.estimatedMinutes ?? 60, unit.rationale ?? '', unit.completedAt ?? null, JSON.stringify(unit.sourceRefs))
      this.db.prepare("UPDATE intakes SET status = 'planned', updated_at = ? WHERE id = ?").run(now, input.intakeId)
    })
    transaction()
    return this.getPlan(planId)
  }

  getPlan(id: string): LearningPlan {
    const row = this.db.prepare('SELECT * FROM learning_plans WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Plan not found: ${id}`)
    const units = (this.db.prepare('SELECT * FROM plan_units WHERE plan_id = ? ORDER BY position ASC').all(id) as Row[]).map(unitFrom)
    return planFrom(row, units)
  }

  confirmPlan(id: string): LearningPlan {
    const now = new Date().toISOString()
    this.db.prepare("UPDATE learning_plans SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now, id)
    return this.getPlan(id)
  }

  confirmPlanForLearner(id: string, learnerId: string): LearningPlan {
    const now = new Date().toISOString()
    const result = this.db.prepare("UPDATE learning_plans SET status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ?").run(now, id, learnerId)
    if (result.changes === 0) throw new Error(`Plan not found: ${id}`)
    return this.getPlanForLearner(id, learnerId)
  }

  getOrCreateMysqlPerformancePlan(learnerId: string): LearningPlan {
    const existing = this.getActivePlan(learnerId, 'mysql-performance-v1')
    if (existing) return existing
    const planId = randomUUID(); const intakeId = randomUUID(); const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db.prepare('INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(intakeId, learnerId, '通过真实实验掌握 MySQL 性能问题的分析与验证方法', 'MySQL 8', null, 240, 'planned', now, now)
      this.db.prepare(`INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, plan_state, template_key, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'local_catalog', 'active', 'active', 'mysql-performance-v1', 1, ?, ?)`).run(planId, learnerId, intakeId, 'MySQL 性能优化路线', '通过真实实验掌握 MySQL 性能问题的分析与验证方法', now, now)
      const units = [
        ['慢查询与联合索引', '从慢日志和表结构定位问题，用 EXPLAIN、索引和结果验证优化假设。', 'mysql-order-list-index-001', 'current', 'available'],
        ['死锁与锁等待', '区分临时止损和根因修复，并用事务会话复测访问顺序。', 'mysql-deadlock-lock-order-001', 'upcoming', 'coming_soon'],
        ['深分页与产品约束', '比较 OFFSET 和游标分页，说明性能与交互能力的取舍。', 'mysql-deep-pagination-001', 'upcoming', 'coming_soon'],
      ] as const
      const insert = this.db.prepare('INSERT INTO plan_units(id, plan_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      units.forEach(([title, objective, caseId, status, availability], index) => insert.run(randomUUID(), planId, index + 1, title, objective, caseId, status, availability, 'lab', 90, '按固定 MySQL 工程路线推进。', '[]'))
      this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)')
        .run(randomUUID(), learnerId, planId, 'plan_created', JSON.stringify({ templateKey: 'mysql-performance-v1' }), now)
    })
    try { transaction() } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE')) throw error
      const concurrent = this.getActivePlan(learnerId, 'mysql-performance-v1')
      if (concurrent) return concurrent
      throw error
    }
    return this.getPlanForLearner(planId, learnerId)
  }

  getPlanForLearner(id: string, learnerId: string): LearningPlan {
    const row = this.db.prepare('SELECT p.*, i.weekly_minutes FROM learning_plans p INNER JOIN intakes i ON i.id = p.intake_id WHERE p.id = ? AND p.learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new Error(`Plan not found: ${id}`)
    const units = (this.db.prepare('SELECT * FROM plan_units WHERE plan_id = ? ORDER BY position ASC').all(id) as Row[]).map(unitFrom)
    return planFrom(row, units)
  }

  getActivePlan(learnerId: string, templateKey?: string): LearningPlan | null {
      const row = this.db.prepare(`SELECT p.*, i.weekly_minutes FROM learning_plans p INNER JOIN intakes i ON i.id = p.intake_id WHERE p.learner_id = ? AND p.status IN ('confirmed', 'active', 'pending_content') ${templateKey ? 'AND p.template_key = ?' : ''} ORDER BY p.updated_at DESC, p.id DESC LIMIT 1`).get(...(templateKey ? [learnerId, templateKey] : [learnerId])) as Row | undefined
    if (!row) return null
    const units = (this.db.prepare('SELECT * FROM plan_units WHERE plan_id = ? ORDER BY position ASC').all(text(row, 'id')) as Row[]).map(unitFrom)
    return planFrom(row, units)
  }

  getOnboardingState(learnerId: string): { currentPlan: LearningPlan | null; session: DiagnosticSession | null; proposal: PlanProposal | null } {
    const currentPlan = this.getActivePlan(learnerId)
    const sessionRow = this.db.prepare("SELECT * FROM diagnostic_sessions WHERE learner_id = ? AND status IN ('draft', 'ready', 'proposed') ORDER BY updated_at DESC, id DESC LIMIT 1").get(learnerId) as Row | undefined
    const session = sessionRow ? this.getDiagnosticSessionForLearner(text(sessionRow, 'id'), learnerId) : null
    const proposalRow = this.db.prepare("SELECT * FROM plan_proposals WHERE learner_id = ? AND status = 'ready' ORDER BY updated_at DESC, id DESC LIMIT 1").get(learnerId) as Row | undefined
    const proposal = proposalRow ? proposalFrom(proposalRow) : null
    return { currentPlan, session, proposal }
  }

  createDiagnosticSession(input: { learnerId: string; targetKey: DiagnosticTargetKey; goal: string; clientRequestId?: string | null }): DiagnosticSession {
    const existing = input.clientRequestId ? this.db.prepare('SELECT * FROM diagnostic_sessions WHERE learner_id = ? AND client_request_id = ?').get(input.learnerId, input.clientRequestId) as Row | undefined : undefined
    if (existing) return this.getDiagnosticSessionForLearner(text(existing, 'id'), input.learnerId)
    const sessionId = randomUUID(); const intakeId = randomUUID(); const now = new Date().toISOString()
    const technology = input.targetKey === 'mysql_performance' ? 'MySQL 8' : '其他技术'
    const transaction = this.db.transaction(() => {
      this.db.prepare('INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, \'draft\', ?, ?)').run(intakeId, input.learnerId, input.goal, technology, now, now)
      this.db.prepare('INSERT INTO diagnostic_sessions(id, learner_id, intake_id, target_key, status, rules_version, revision, client_request_id, created_at, updated_at) VALUES (?, ?, ?, ?, \'draft\', \'diagnostic-v1\', 1, ?, ?, ?)').run(sessionId, input.learnerId, intakeId, input.targetKey, input.clientRequestId ?? null, now, now)
      this.db.prepare('INSERT INTO profile_evidence(id, learner_id, diagnostic_session_id, evidence_key, source_kind, content, status, created_at, updated_at) VALUES (?, ?, ?, \'goal\', \'user_input\', ?, \'active\', ?, ?)').run(randomUUID(), input.learnerId, sessionId, input.goal, now, now)
    })
    try { transaction() } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE')) throw error
      const concurrent = input.clientRequestId ? this.db.prepare('SELECT * FROM diagnostic_sessions WHERE learner_id = ? AND client_request_id = ?').get(input.learnerId, input.clientRequestId) as Row | undefined : undefined
      if (concurrent) return this.getDiagnosticSessionForLearner(text(concurrent, 'id'), input.learnerId)
      throw error
    }
    return this.getDiagnosticSessionForLearner(sessionId, input.learnerId)
  }

  regenerateDiagnosticSession(input: { learnerId: string; targetKey: DiagnosticTargetKey; goal: string; clientRequestId?: string | null }): DiagnosticSession {
    const existing = input.clientRequestId ? this.db.prepare('SELECT id FROM diagnostic_sessions WHERE learner_id = ? AND client_request_id = ?').get(input.learnerId, input.clientRequestId) as Row | undefined : undefined
    if (existing) return this.getDiagnosticSessionForLearner(text(existing, 'id'), input.learnerId)
    const sessionId = randomUUID(); const intakeId = randomUUID(); const now = new Date().toISOString()
    const technology = input.targetKey === 'mysql_performance' ? 'MySQL 8' : '其他技术'
    const transaction = this.db.transaction(() => {
      const currentPlan = this.db.prepare("SELECT id FROM learning_plans WHERE learner_id = ? AND status IN ('confirmed', 'active', 'pending_content') ORDER BY updated_at DESC, id DESC LIMIT 1").get(input.learnerId) as Row | undefined
      if (!currentPlan) throw new Error('PLAN_NOT_FOUND')
      if (currentPlan) {
        this.db.prepare("UPDATE learning_plans SET status = 'superseded', updated_at = ? WHERE id = ?").run(now, text(currentPlan, 'id'))
        this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, \'plan_superseded\', ?, ?)').run(randomUUID(), input.learnerId, text(currentPlan, 'id'), JSON.stringify({ reason: 'plan_regenerated' }), now)
      }
      this.db.prepare("UPDATE diagnostic_sessions SET status = 'superseded', updated_at = ? WHERE learner_id = ? AND status IN ('draft', 'ready', 'proposed')").run(now, input.learnerId)
      this.db.prepare('INSERT INTO intakes(id, learner_id, goal, technology, outcome, weekly_minutes, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, \'draft\', ?, ?)').run(intakeId, input.learnerId, input.goal, technology, now, now)
      this.db.prepare('INSERT INTO diagnostic_sessions(id, learner_id, intake_id, target_key, status, rules_version, revision, client_request_id, created_at, updated_at) VALUES (?, ?, ?, ?, \'draft\', \'diagnostic-v1\', 1, ?, ?, ?)').run(sessionId, input.learnerId, intakeId, input.targetKey, input.clientRequestId ?? null, now, now)
      this.db.prepare('INSERT INTO profile_evidence(id, learner_id, diagnostic_session_id, evidence_key, source_kind, content, status, created_at, updated_at) VALUES (?, ?, ?, \'goal\', \'user_input\', ?, \'active\', ?, ?)').run(randomUUID(), input.learnerId, sessionId, input.goal, now, now)
    })
    try { transaction() } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE')) throw error
      const concurrent = input.clientRequestId ? this.db.prepare('SELECT id FROM diagnostic_sessions WHERE learner_id = ? AND client_request_id = ?').get(input.learnerId, input.clientRequestId) as Row | undefined : undefined
      if (concurrent) return this.getDiagnosticSessionForLearner(text(concurrent, 'id'), input.learnerId)
      throw error
    }
    return this.getDiagnosticSessionForLearner(sessionId, input.learnerId)
  }

  getDiagnosticSessionByRequestForLearner(learnerId: string, clientRequestId: string): DiagnosticSession | null {
    const row = this.db.prepare('SELECT id FROM diagnostic_sessions WHERE learner_id = ? AND client_request_id = ?').get(learnerId, clientRequestId) as Row | undefined
    return row ? this.getDiagnosticSessionForLearner(text(row, 'id'), learnerId) : null
  }

  getDiagnosticSessionForLearner(id: string, learnerId: string): DiagnosticSession {
    const row = this.db.prepare('SELECT d.*, i.goal FROM diagnostic_sessions d INNER JOIN intakes i ON i.id = d.intake_id WHERE d.id = ? AND d.learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new Error(`Diagnostic session not found: ${id}`)
    const turns = (this.db.prepare('SELECT * FROM diagnostic_turns WHERE session_id = ? ORDER BY position ASC').all(id) as Row[]).map(diagnosticTurnFrom)
    const evidence = (this.db.prepare('SELECT * FROM profile_evidence WHERE diagnostic_session_id = ? AND learner_id = ? ORDER BY created_at ASC, id ASC').all(id, learnerId) as Row[]).map(profileEvidenceFrom)
    return diagnosticSessionFrom(row, turns, evidence)
  }

  listProfileEvidence(learnerId: string): ProfileEvidence[] {
    return (this.db.prepare("SELECT * FROM profile_evidence WHERE learner_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC").all(learnerId) as Row[]).map(profileEvidenceFrom)
  }

  saveDiagnosticAnswers(input: { id: string; learnerId: string; revision: number; goal: string; weeklyMinutes: number; outcome: string; experience: string; selfAssessment: string; contextNote: string }): DiagnosticSession {
    const current = this.db.prepare('SELECT * FROM diagnostic_sessions WHERE id = ? AND learner_id = ?').get(input.id, input.learnerId) as Row | undefined
    if (!current) throw new Error(`Diagnostic session not found: ${input.id}`)
    if (number(current, 'revision') !== input.revision) throw new Error('DIAGNOSTIC_REVISION_CONFLICT')
    const intakeId = text(current, 'intake_id'); const now = new Date().toISOString()
    const answers = [
      ['experience', '你已有多少相关经验？', input.experience],
      ['self_assessment', '你如何评价当前水平？', input.selfAssessment],
      ['weekly_minutes', '每周可以投入多少时间？', String(input.weeklyMinutes)],
      ['outcome', '你希望最终产出什么？', input.outcome],
      ['context_note', '还有哪些背景需要补充？', input.contextNote || '未补充'],
    ] as const
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE intakes SET goal = ?, weekly_minutes = ?, outcome = ?, updated_at = ? WHERE id = ? AND learner_id = ?').run(input.goal, input.weeklyMinutes, input.outcome, now, intakeId, input.learnerId)
      this.db.prepare('UPDATE diagnostic_sessions SET status = \'ready\', revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND revision = ?').run(now, input.id, input.learnerId, input.revision)
      this.db.prepare("UPDATE plan_proposals SET status = 'superseded', revision = revision + 1, updated_at = ? WHERE diagnostic_session_id = ? AND learner_id = ? AND status = 'ready'").run(now, input.id, input.learnerId)
      this.db.prepare("UPDATE profile_evidence SET status = 'superseded', updated_at = ? WHERE diagnostic_session_id = ? AND learner_id = ? AND status = 'active'").run(now, input.id, input.learnerId)
      const upsertTurn = this.db.prepare('INSERT INTO diagnostic_turns(id, session_id, position, question_key, question, answer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, question_key) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at')
      const evidence = this.db.prepare('INSERT INTO profile_evidence(id, learner_id, diagnostic_session_id, evidence_key, source_kind, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'user_input\', ?, \'active\', ?, ?)')
      answers.forEach(([key, question, answer], index) => { upsertTurn.run(randomUUID(), input.id, index + 1, key, question, answer, now, now); evidence.run(randomUUID(), input.learnerId, input.id, key, answer, now, now) })
      evidence.run(randomUUID(), input.learnerId, input.id, 'goal', input.goal, now, now)
    })
    transaction()
    return this.getDiagnosticSessionForLearner(input.id, input.learnerId)
  }

  createPlanProposal(input: { learnerId: string; sessionId: string; inputFingerprint: string; templateKey: string; targetKey: DiagnosticTargetKey; inputSnapshot: Record<string, unknown>; planSnapshot: PlanProposal['planSnapshot']; rationale: PlanProposal['rationale']; rulesVersion: string }): PlanProposal {
    const existing = this.db.prepare('SELECT * FROM plan_proposals WHERE diagnostic_session_id = ? AND input_fingerprint = ?').get(input.sessionId, input.inputFingerprint) as Row | undefined
    if (existing) return proposalFrom(existing)
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare('INSERT INTO plan_proposals(id, learner_id, diagnostic_session_id, input_fingerprint, template_key, target_key, status, rules_version, revision, input_snapshot_json, plan_snapshot_json, rationale_json, confirmed_plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'ready\', ?, 1, ?, ?, ?, NULL, ?, ?)').run(id, input.learnerId, input.sessionId, input.inputFingerprint, input.templateKey, input.targetKey, input.rulesVersion, JSON.stringify(input.inputSnapshot), JSON.stringify(input.planSnapshot), JSON.stringify(input.rationale), now, now)
    this.db.prepare("UPDATE diagnostic_sessions SET status = 'proposed', updated_at = ? WHERE id = ? AND learner_id = ?").run(now, input.sessionId, input.learnerId)
    return proposalFrom(this.db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(id) as Row)
  }

  getPlanProposalForLearner(id: string, learnerId: string): PlanProposal {
    const row = this.db.prepare('SELECT * FROM plan_proposals WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new Error(`Plan proposal not found: ${id}`)
    return proposalFrom(row)
  }

  confirmPlanProposalForLearner(id: string, learnerId: string, revision: number): LearningPlan {
    const proposal = this.getPlanProposalForLearner(id, learnerId)
    if (proposal.confirmedPlanId) return this.getPlanForLearner(proposal.confirmedPlanId, learnerId)
    if (proposal.status !== 'ready') throw new Error('PLAN_PROPOSAL_NOT_READY')
    if (proposal.revision !== revision) throw new Error('PROPOSAL_REVISION_CONFLICT')
    const planId = randomUUID(); const now = new Date().toISOString(); const snapshot = proposal.planSnapshot
    const transaction = this.db.transaction(() => {
      const session = this.db.prepare('SELECT intake_id FROM diagnostic_sessions WHERE id = ? AND learner_id = ?').get(proposal.diagnosticSessionId, learnerId) as Row | undefined
      if (!session) throw new Error('DIAGNOSTIC_SESSION_NOT_FOUND')
      const latestProposal = this.db.prepare('SELECT status, revision, confirmed_plan_id FROM plan_proposals WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
      if (!latestProposal) throw new Error('PLAN_PROPOSAL_NOT_FOUND')
      if (nullableText(latestProposal, 'confirmed_plan_id')) throw new Error('PROPOSAL_ALREADY_CONFIRMED')
      if (text(latestProposal, 'status') !== 'ready') throw new Error('PLAN_PROPOSAL_NOT_READY')
      if (number(latestProposal, 'revision') !== revision) throw new Error('PROPOSAL_REVISION_CONFLICT')
      const existingPlan = this.db.prepare("SELECT id FROM learning_plans WHERE learner_id = ? AND status IN ('confirmed', 'active', 'pending_content') LIMIT 1").get(learnerId) as Row | undefined
      if (existingPlan) throw new Error('PLAN_EXISTS')
      this.db.prepare("INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, plan_state, template_key, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'local_catalog', 'active', ?, ?, 1, ?, ?)").run(planId, learnerId, text(session, 'intake_id'), snapshot.title, snapshot.goal, snapshot.planState, proposal.templateKey, now, now)
      const insert = this.db.prepare('INSERT INTO plan_units(id, plan_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      snapshot.units.forEach((unit) => insert.run(randomUUID(), planId, unit.position, unit.title, unit.objective, unit.caseId, unit.status, unit.availability, unit.learningMode, unit.estimatedMinutes, unit.rationale, JSON.stringify(unit.sourceRefs)))
      this.db.prepare("UPDATE intakes SET status = 'planned', updated_at = ? WHERE id = (SELECT intake_id FROM diagnostic_sessions WHERE id = ?)").run(now, proposal.diagnosticSessionId)
      this.db.prepare("UPDATE diagnostic_sessions SET status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ?").run(now, proposal.diagnosticSessionId, learnerId)
      this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, \'plan_created\', ?, ?)').run(randomUUID(), learnerId, planId, JSON.stringify({ templateKey: proposal.templateKey, proposalId: id, rulesVersion: proposal.rulesVersion }), now)
      const claimed = this.db.prepare("UPDATE plan_proposals SET status = 'confirmed', confirmed_plan_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'ready' AND revision = ?").run(planId, now, id, learnerId, revision)
      if (claimed.changes === 0) throw new Error('PROPOSAL_ALREADY_CONFIRMED')
    })
    try { transaction() } catch (error) {
      if (error instanceof Error && error.message === 'PROPOSAL_ALREADY_CONFIRMED') {
        const latest = this.getPlanProposalForLearner(id, learnerId)
        if (latest.confirmedPlanId) return this.getPlanForLearner(latest.confirmedPlanId, learnerId)
      }
      throw error
    }
    return this.getPlanForLearner(planId, learnerId)
  }

  listPlanUnits(planId: string): PlanUnit[] {
    return (this.db.prepare('SELECT * FROM plan_units WHERE plan_id = ? ORDER BY position ASC').all(planId) as Row[]).map(unitFrom)
  }

  findActivePracticeForUnit(learnerId: string, planUnitId: string): PracticeRun | null {
    const row = this.db.prepare(`SELECT r.* FROM practice_runs r INNER JOIN plan_units u ON u.id = r.plan_unit_id INNER JOIN learning_plans p ON p.id = u.plan_id WHERE r.learner_id = ? AND r.plan_unit_id = ? AND p.learner_id = ? AND r.status IN ('active', 'ready_to_close', 'resolved') ORDER BY r.updated_at DESC, r.id DESC LIMIT 1`).get(learnerId, planUnitId, learnerId) as Row | undefined
    return row ? runFrom(row) : null
  }

  startPlanUnitPractice(input: { learnerId: string; planId: string; planUnitId: string; caseId: PracticeRun['caseId']; labRunId?: string | null }): PracticeRun {
    const existing = this.findActivePracticeForUnit(input.learnerId, input.planUnitId)
    if (existing) return existing
    const unit = this.db.prepare(`SELECT u.* FROM plan_units u INNER JOIN learning_plans p ON p.id = u.plan_id WHERE u.id = ? AND u.plan_id = ? AND p.learner_id = ? AND p.status IN ('confirmed', 'active')`).get(input.planUnitId, input.planId, input.learnerId) as Row | undefined
    if (!unit) throw new Error('PLAN_UNIT_NOT_FOUND')
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO practice_runs(id, learner_id, plan_unit_id, case_id, lab_run_id, stage, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'observe', 'active', ?, ?)`).run(id, input.learnerId, input.planUnitId, input.caseId, input.labRunId ?? null, now, now)
    return this.getPracticeRun(id)
  }

  advancePlanForResolvedRun(run: PracticeRun): LearningPlan {
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare(`SELECT p.*, u.id AS current_unit_id FROM learning_plans p INNER JOIN plan_units u ON u.plan_id = p.id WHERE p.id = (SELECT plan_id FROM plan_units WHERE id = ?) AND p.learner_id = ? AND u.id = ?`).get(run.planUnitId, run.learnerId, run.planUnitId) as Row | undefined
      if (!current) throw new Error('PLAN_NOT_FOUND')
      const planId = text(current, 'id'); const revision = number(current, 'revision')
      const alreadyCompleted = this.db.prepare("SELECT 1 FROM plan_events WHERE plan_id = ? AND plan_unit_id = ? AND type = 'plan_unit_completed' LIMIT 1").get(planId, run.planUnitId)
      if (alreadyCompleted) return
      const now = new Date().toISOString()
      this.db.prepare("UPDATE plan_units SET status = 'completed', completed_at = ?, availability = 'available' WHERE id = ? AND status = 'current'").run(now, run.planUnitId)
      this.db.prepare("UPDATE plan_units SET status = 'current' WHERE id = (SELECT id FROM plan_units WHERE plan_id = ? AND status = 'upcoming' ORDER BY position ASC LIMIT 1)").run(planId)
      const next = this.db.prepare("SELECT id FROM plan_units WHERE plan_id = ? AND status = 'current' ORDER BY position ASC LIMIT 1").get(planId) as Row | undefined
      this.db.prepare("UPDATE learning_plans SET revision = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE 'active' END, updated_at = ? WHERE id = ? AND revision = ?").run(revision + 1, next?.id ?? null, now, planId, revision)
      const event = this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      event.run(randomUUID(), run.learnerId, planId, run.planUnitId, run.id, 'plan_unit_completed', JSON.stringify({ revision: revision + 1 }), now)
      if (next) event.run(randomUUID(), run.learnerId, planId, text(next, 'id'), run.id, 'plan_unit_advanced', JSON.stringify({ fromUnitId: run.planUnitId, revision: revision + 1 }), now)
    })
    transaction()
    return this.getPlanForLearner(text(this.db.prepare('SELECT plan_id FROM plan_units WHERE id = ?').get(run.planUnitId) as Row, 'plan_id'), run.learnerId)
  }

  createPracticeRun(input: { learnerId: string; planUnitId?: string | null; caseId: PracticeRun['caseId']; labRunId?: string | null }): PracticeRun {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO practice_runs(id, learner_id, plan_unit_id, case_id, lab_run_id, stage, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'observe', 'active', ?, ?)`).run(id, input.learnerId, input.planUnitId ?? null, input.caseId, input.labRunId ?? null, now, now)
    return this.getPracticeRun(id)
  }

  getPracticeRun(id: string): PracticeRun {
    const row = this.db.prepare('SELECT * FROM practice_runs WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Practice run not found: ${id}`)
    return runFrom(row)
  }

  listPracticeHistory(learnerId: string, options: { cursor?: { updatedAt: string; id: string }; limit: number }): PracticeHistoryRecord[] {
    const cursorClause = options.cursor ? 'AND (r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))' : ''
    const values = options.cursor ? [learnerId, options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id, options.limit] : [learnerId, options.limit]
    const rows = this.db.prepare(`SELECT r.*,
        COALESCE((SELECT MAX(e.created_at) FROM practice_events e WHERE e.practice_run_id = r.id), r.updated_at) AS last_activity_at,
        (SELECT t.provider FROM tutor_turns t WHERE t.practice_run_id = r.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS last_tutor_provider,
        (SELECT t.source_status FROM tutor_turns t WHERE t.practice_run_id = r.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS last_tutor_source_status
      FROM practice_runs r
      WHERE r.learner_id = ? ${cursorClause}
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ?`).all(...values) as Row[]
    return rows.map((row) => ({ run: runFrom(row), lastActivityAt: text(row, 'last_activity_at'), lastTutorProvider: nullableText(row, 'last_tutor_provider'), lastTutorSourceStatus: nullableText(row, 'last_tutor_source_status') }))
  }

  updatePracticeRun(id: string, update: Partial<Pick<PracticeRun, 'stage' | 'hintLevel' | 'noProgressCount' | 'status' | 'labRunId'>>): PracticeRun {
    const fields: string[] = []; const values: unknown[] = []
    for (const [key, value] of Object.entries(update)) {
      const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      fields.push(`${column} = ?`); values.push(value)
    }
    if (fields.length === 0) return this.getPracticeRun(id)
    fields.push('updated_at = ?'); values.push(new Date().toISOString(), id)
    this.db.prepare(`UPDATE practice_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getPracticeRun(id)
  }

  createLabSegment(input: { practiceRunId: string; labRunId: string; fixtureVersion: string }): LabSegment {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO practice_lab_segments(id, practice_run_id, lab_run_id, fixture_version, status, started_at)
      VALUES (?, ?, ?, ?, 'active', ?)`).run(id, input.practiceRunId, input.labRunId, input.fixtureVersion, now)
    return labSegmentFrom(this.db.prepare('SELECT * FROM practice_lab_segments WHERE id = ?').get(id) as Row)
  }

  finishLabSegment(labRunId: string, reason: string): void {
    this.db.prepare("UPDATE practice_lab_segments SET status = 'ended', ended_at = ?, ended_reason = ? WHERE lab_run_id = ? AND status = 'active'").run(new Date().toISOString(), reason, labRunId)
  }

  listLabSegments(practiceRunId: string): LabSegment[] {
    return (this.db.prepare('SELECT * FROM practice_lab_segments WHERE practice_run_id = ? ORDER BY started_at ASC').all(practiceRunId) as Row[]).map(labSegmentFrom)
  }

  appendEvent(input: AppendEventInput): PracticeEvent {
    const transaction = this.db.transaction(() => {
      if (input.clientRequestId) {
        const existing = this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?').get(input.practiceRunId, input.clientRequestId) as Row | undefined
        if (existing) return eventFrom(existing)
      }
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM practice_events WHERE practice_run_id = ?').get(input.practiceRunId) as Row
      const id = randomUUID(); const now = new Date().toISOString()
      this.db.prepare(`INSERT INTO practice_events(id, learner_id, practice_run_id, sequence, actor, type, stage, payload_json, artifact_refs_json, client_request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId, number(next, 'sequence'), input.actor, input.type, input.stage, JSON.stringify(input.payload), JSON.stringify(input.artifactRefs ?? []), input.clientRequestId ?? null, now)
      return eventFrom(this.db.prepare('SELECT * FROM practice_events WHERE id = ?').get(id) as Row)
    })
    return transaction() as PracticeEvent
  }

  listEvents(practiceRunId: string): PracticeEvent[] {
    return (this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? ORDER BY sequence ASC').all(practiceRunId) as Row[]).map(eventFrom)
  }

  findEventByClientRequestId(practiceRunId: string, clientRequestId: string): PracticeEvent | null {
    const row = this.db.prepare('SELECT * FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?').get(practiceRunId, clientRequestId) as Row | undefined
    return row ? eventFrom(row) : null
  }

  createArtifact(input: CreateArtifactInput): Artifact {
    const id = randomUUID(); const now = input.createdAt ?? new Date().toISOString()
    const checksum = createHash('sha256').update(input.content).digest('hex')
    this.db.prepare(`INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId ?? null, input.kind, input.sourceKind, input.verificationStatus, input.content, JSON.stringify(input.metadata ?? {}), checksum, now)
    return artifactFrom(this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row)
  }

  replayMissingPracticeArtifacts(practiceRunId: string): { created: number; unresolved: number } {
    const run = this.getPracticeRun(practiceRunId)
    const events = this.listEvents(practiceRunId)
    const artifacts = new Map(this.listArtifacts(practiceRunId).map((artifact) => [artifact.id, artifact]))
    const replayedByEvent = new Map<string, string>()
    for (const artifact of artifacts.values()) {
      const replayedFrom = artifact.metadata.replayedFromEventId
      if (typeof replayedFrom === 'string' && replayedFrom) replayedByEvent.set(`${artifact.kind}:${replayedFrom}`, artifact.id)
    }
    const insertArtifact = this.db.prepare(`INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const updateEvent = this.db.prepare('UPDATE practice_events SET artifact_refs_json = ? WHERE id = ?')
    let created = 0
    let unresolved = 0
    const replayableEventIds = new Set<string>()
    const resolvedEventIds = new Set<string>()
    const transaction = this.db.transaction(() => {
      for (const event of events) {
        let kind: ArtifactKind | null = null
        let sourceKind: ArtifactSourceKind | null = null
        let verificationStatus: VerificationStatus = 'not_applicable'
        let content: string | null = null
        if (event.type === 'case_presented' && typeof event.payload.caseId === 'string') {
          kind = 'external_text'; sourceKind = 'system'; content = `案例上下文：${event.payload.caseId}${typeof event.payload.fixtureVersion === 'string' ? `\nFixture 版本：${event.payload.fixtureVersion}` : ''}`
        } else if (event.type === 'user_message' && typeof event.payload.message === 'string') {
          kind = 'user_message'; sourceKind = 'user'; content = event.payload.message
        } else if (event.type === 'tutor_reply' && typeof event.payload.response === 'string') {
          kind = 'tutor_reply'; sourceKind = 'tutor'; verificationStatus = 'model_generated'; content = event.payload.response
        } else if (event.type === 'attempt_submitted' && typeof event.payload.statement === 'string') {
          kind = 'sql'; sourceKind = 'lab'; content = event.payload.statement
        }
        if (!kind || !sourceKind || !content) continue
        replayableEventIds.add(event.id)
        const hasExpectedArtifact = event.artifactRefs.some((refId) => artifacts.get(refId)?.kind === kind)
        if (hasExpectedArtifact) { resolvedEventIds.add(event.id); continue }
        const existingId = replayedByEvent.get(`${kind}:${event.id}`)
        const artifactId = existingId ?? randomUUID()
        if (!existingId) {
          const metadata: Record<string, unknown> = { replayedFromEventId: event.id }
          if (event.clientRequestId) metadata.clientRequestId = event.clientRequestId
          if (event.type === 'tutor_reply') {
            metadata.sourceRefs = event.payload.sourceRefs ?? []
            metadata.evidenceRefs = event.payload.evidenceRefs ?? []
          }
          insertArtifact.run(artifactId, run.learnerId, practiceRunId, kind, sourceKind, verificationStatus, content, JSON.stringify(metadata), createHash('sha256').update(content).digest('hex'), event.createdAt)
          artifacts.set(artifactId, { id: artifactId, learnerId: run.learnerId, practiceRunId, kind, sourceKind, verificationStatus, content, metadata, checksum: createHash('sha256').update(content).digest('hex'), createdAt: event.createdAt })
          replayedByEvent.set(`${kind}:${event.id}`, artifactId)
          created += 1
        }
        resolvedEventIds.add(event.id)
        if (!event.artifactRefs.includes(artifactId)) updateEvent.run(JSON.stringify([...event.artifactRefs, artifactId]), event.id)
      }
    })()
    unresolved = [...replayableEventIds].filter((eventId) => !resolvedEventIds.has(eventId)).length
    return { created, unresolved }
  }

  listArtifacts(practiceRunId: string): Artifact[] {
    return (this.db.prepare('SELECT * FROM artifacts WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map(artifactFrom)
  }

  getPracticePin(id: string): PracticePin {
    const row = this.db.prepare('SELECT * FROM practice_pins WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Practice pin not found: ${id}`)
    return practicePinFrom(row)
  }

  findPracticePin(input: { practiceRunId: string; targetType: PracticePin['targetType']; targetId: string }): PracticePin | null {
    const row = this.db.prepare('SELECT * FROM practice_pins WHERE practice_run_id = ? AND target_type = ? AND target_id = ?').get(input.practiceRunId, input.targetType, input.targetId) as Row | undefined
    return row ? practicePinFrom(row) : null
  }

  createPracticePin(input: Omit<PracticePin, 'id' | 'createdAt'>): PracticePin {
    const existing = this.findPracticePin(input)
    if (existing) return existing
    const id = randomUUID()
    const current = this.db.prepare('SELECT MAX(created_at) AS created_at FROM practice_pins WHERE practice_run_id = ?').get(input.practiceRunId) as Row | undefined
    const currentCreatedAt = nullableText(current ?? {}, 'created_at')
    const currentMs = currentCreatedAt ? Date.parse(currentCreatedAt) : 0
    const nowMs = Math.max(Date.now(), currentMs + 1)
    const now = new Date(nowMs).toISOString()
    this.db.prepare(`INSERT INTO practice_pins(id, learner_id, practice_run_id, target_type, target_id, title, body, source, url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId, input.targetType, input.targetId, input.title, input.body, input.source, input.url, now)
    return this.getPracticePin(id)
  }

  deletePracticePin(id: string, learnerId: string, practiceRunId: string): boolean {
    const result = this.db.prepare('DELETE FROM practice_pins WHERE id = ? AND learner_id = ? AND practice_run_id = ?').run(id, learnerId, practiceRunId)
    return result.changes > 0
  }

  listPracticePins(practiceRunId: string): PracticePin[] {
    return (this.db.prepare('SELECT * FROM practice_pins WHERE practice_run_id = ? ORDER BY created_at DESC, id DESC').all(practiceRunId) as Row[]).map(practicePinFrom)
  }

  getArtifact(id: string): Artifact {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Artifact not found: ${id}`)
    return artifactFrom(row)
  }

  createPathNode(input: Omit<PathNode, 'id' | 'createdAt'>): PathNode {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO path_nodes(id, practice_run_id, stage, title, judgment, outcome, judgment_change, next_gap, importance, event_refs_json, artifact_refs_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.practiceRunId, input.stage, input.title, input.judgment, input.outcome, input.judgmentChange, input.nextGap, input.importance, JSON.stringify(input.eventRefs), JSON.stringify(input.artifactRefs), now)
    return pathNodeFrom(this.db.prepare('SELECT * FROM path_nodes WHERE id = ?').get(id) as Row)
  }

  listPathNodes(practiceRunId: string): PathNode[] {
    return (this.db.prepare('SELECT * FROM path_nodes WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map(pathNodeFrom)
  }

  upsertStageMemory(input: { practiceRunId: string; stage: CaseStage; memory: Record<string, unknown>; sourceEventRefs: string[] }): StageMemory {
    const current = this.db.prepare('SELECT * FROM stage_memories WHERE practice_run_id = ? AND stage = ?').get(input.practiceRunId, input.stage) as Row | undefined
    const id = current ? text(current, 'id') : randomUUID(); const version = current ? number(current, 'version') + 1 : 1; const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO stage_memories(id, practice_run_id, stage, memory_json, source_event_refs_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(practice_run_id, stage) DO UPDATE SET memory_json = excluded.memory_json, source_event_refs_json = excluded.source_event_refs_json, version = excluded.version, updated_at = excluded.updated_at`).run(id, input.practiceRunId, input.stage, JSON.stringify(input.memory), JSON.stringify(input.sourceEventRefs), version, now)
    return stageMemoryFrom(this.db.prepare('SELECT * FROM stage_memories WHERE id = ?').get(id) as Row)
  }

  listStageMemories(practiceRunId: string): StageMemory[] {
    return (this.db.prepare('SELECT * FROM stage_memories WHERE practice_run_id = ? ORDER BY updated_at ASC').all(practiceRunId) as Row[]).map(stageMemoryFrom)
  }

  upsertMemory(input: Omit<MemoryItem, 'id' | 'updatedAt'>): MemoryItem {
    const existing = this.db.prepare('SELECT * FROM memory_items WHERE learner_id = ? AND category = ? AND topic = ? AND status != \'deleted\' ORDER BY updated_at DESC LIMIT 1').get(input.learnerId, input.category, input.topic) as Row | undefined
    const id = existing ? text(existing, 'id') : randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO memory_items(id, learner_id, category, topic, status, statement, scope, confidence, evidence_refs_json, user_note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, statement = excluded.statement, scope = excluded.scope, confidence = excluded.confidence, evidence_refs_json = excluded.evidence_refs_json, user_note = excluded.user_note, updated_at = excluded.updated_at`).run(id, input.learnerId, input.category, input.topic, input.status, input.statement, input.scope, input.confidence, JSON.stringify(input.evidenceRefs), input.userNote, now)
    return memoryFrom(this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as Row)
  }

  listMemories(learnerId: string): MemoryItem[] {
    return (this.db.prepare("SELECT * FROM memory_items WHERE learner_id = ? AND status != 'deleted' ORDER BY updated_at DESC").all(learnerId) as Row[]).map(memoryFrom)
  }

  updateMemory(id: string, update: { statement?: string; userNote?: string | null; status?: MemoryItem['status'] }): MemoryItem {
    const fields: string[] = []; const values: unknown[] = []
    for (const [key, value] of Object.entries(update)) { fields.push(`${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)} = ?`); values.push(value) }
    fields.push('updated_at = ?'); values.push(new Date().toISOString(), id)
    this.db.prepare(`UPDATE memory_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return memoryFrom(this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as Row)
  }

  saveSource(input: Omit<SourceItem, 'id'> & { id?: string }): SourceItem {
    const id = input.id ?? randomUUID(); const externalId = input.externalId ?? null
    this.db.prepare(`INSERT INTO source_items(id, provider, external_id, title, author, url, excerpt, query, retrieved_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET title = excluded.title, author = excluded.author, url = excluded.url, excerpt = excluded.excerpt, query = excluded.query, retrieved_at = excluded.retrieved_at, metadata_json = excluded.metadata_json`).run(id, input.provider, externalId, input.title, input.author, input.url, input.excerpt, input.query, input.retrievedAt, JSON.stringify(input.metadata))
    const row = this.db.prepare(externalId ? 'SELECT * FROM source_items WHERE provider = ? AND external_id = ?' : 'SELECT * FROM source_items WHERE id = ?').get(...(externalId ? [input.provider, externalId] : [id])) as Row
    return sourceFrom(row)
  }

  listSources(ids?: string[]): SourceItem[] {
    if (!ids || ids.length === 0) return (this.db.prepare('SELECT * FROM source_items ORDER BY retrieved_at DESC LIMIT 50').all() as Row[]).map(sourceFrom)
    const placeholders = ids.map(() => '?').join(', ')
    return (this.db.prepare(`SELECT * FROM source_items WHERE id IN (${placeholders}) ORDER BY retrieved_at DESC`).all(...ids) as Row[]).map(sourceFrom)
  }

  listSourcesForQuery(provider: SourceItem['provider'], query: string, since: string, limit: number): SourceItem[] {
    return (this.db.prepare('SELECT * FROM source_items WHERE provider = ? AND query = ? AND retrieved_at >= ? ORDER BY retrieved_at DESC LIMIT ?').all(provider, query, since, limit) as Row[]).map(sourceFrom)
  }

  saveTutorTurn(input: { practiceRunId: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string }): void {
    this.db.prepare(`INSERT INTO tutor_turns(id, practice_run_id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.practiceRunId, input.userArtifactId, input.assistantArtifactId, input.mode, input.provider, input.sourceStatus, new Date().toISOString())
  }

  listTutorTurns(practiceRunId: string) {
    return (this.db.prepare('SELECT id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at FROM tutor_turns WHERE practice_run_id = ? ORDER BY created_at ASC').all(practiceRunId) as Row[]).map((row) => ({ id: text(row, 'id'), userArtifactId: nullableText(row, 'user_artifact_id'), assistantArtifactId: nullableText(row, 'assistant_artifact_id'), mode: text(row, 'mode'), provider: text(row, 'provider'), sourceStatus: text(row, 'source_status'), createdAt: text(row, 'created_at') }))
  }

  createTutorInvocation(input: { practiceRunId: string; userArtifactId: string; clientRequestId: string; provider: string; model: string }): TutorInvocation {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO tutor_invocations(id, practice_run_id, user_artifact_id, client_request_id, provider, model, status, retrieval_status, source_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', 'not_requested', '[]', ?)`).run(id, input.practiceRunId, input.userArtifactId, input.clientRequestId, input.provider, input.model, now)
    return tutorInvocationFrom(this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row)
  }

  getTutorInvocationByRequest(practiceRunId: string, clientRequestId: string): TutorInvocation | null {
    const row = this.db.prepare('SELECT * FROM tutor_invocations WHERE practice_run_id = ? AND client_request_id = ?').get(practiceRunId, clientRequestId) as Row | undefined
    return row ? tutorInvocationFrom(row) : null
  }

  getTutorInvocation(id: string): TutorInvocation {
    const row = this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error(`Tutor invocation not found: ${id}`)
    return tutorInvocationFrom(row)
  }

  markRunningTutorInvocationsInterrupted(): number {
    const result = this.db.prepare("UPDATE tutor_invocations SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '服务在本次调用完成前重启', completed_at = ? WHERE status = 'running'").run(new Date().toISOString())
    return result.changes
  }

  updateTutorInvocation(id: string, update: { status: TutorInvocationStatus; retrievalStatus?: string; sourceIds?: string[]; failureCode?: string | null; failureMessage?: string | null; latencyMs?: number | null }): TutorInvocation {
    const now = new Date().toISOString()
    const terminal = update.status === 'succeeded' || update.status === 'failed' || update.status === 'interrupted'
    this.db.prepare(`UPDATE tutor_invocations SET status = ?, retrieval_status = COALESCE(?, retrieval_status), source_ids_json = COALESCE(?, source_ids_json), failure_code = ?, failure_message = ?, latency_ms = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END WHERE id = ?`)
      .run(update.status, update.retrievalStatus ?? null, update.sourceIds ? JSON.stringify(update.sourceIds) : null, update.failureCode ?? null, update.failureMessage ?? null, update.latencyMs ?? null, terminal ? 1 : 0, now, id)
    return tutorInvocationFrom(this.db.prepare('SELECT * FROM tutor_invocations WHERE id = ?').get(id) as Row)
  }

  findTutorTurnByUserArtifact(userArtifactId: string): { id: string; userArtifactId: string | null; assistantArtifactId: string | null; mode: string; provider: string; sourceStatus: string; createdAt: string } | null {
    const row = this.db.prepare('SELECT id, user_artifact_id, assistant_artifact_id, mode, provider, source_status, created_at FROM tutor_turns WHERE user_artifact_id = ? ORDER BY created_at DESC LIMIT 1').get(userArtifactId) as Row | undefined
    return row ? { id: text(row, 'id'), userArtifactId: nullableText(row, 'user_artifact_id'), assistantArtifactId: nullableText(row, 'assistant_artifact_id'), mode: text(row, 'mode'), provider: text(row, 'provider'), sourceStatus: text(row, 'source_status'), createdAt: text(row, 'created_at') } : null
  }

  createWritingProject(input: { learnerId: string; practiceRunId: string }): WritingProject {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT OR IGNORE INTO writing_projects(id, learner_id, practice_run_id, article_type, status, evidence_snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, 'engineering_practice_review', 'materials_ready', ?, ?, ?)`).run(id, input.learnerId, input.practiceRunId, JSON.stringify({ capturedAt: null, materialIds: [] }), now, now)
    const row = this.db.prepare('SELECT id FROM writing_projects WHERE practice_run_id = ?').get(input.practiceRunId) as Row
    return this.getWritingProject(text(row, 'id'))
  }

  getWritingProjectByRun(practiceRunId: string): WritingProject | null {
    const row = this.db.prepare('SELECT id FROM writing_projects WHERE practice_run_id = ?').get(practiceRunId) as Row | undefined
    return row ? this.getWritingProject(text(row, 'id')) : null
  }

  getWritingProjectIdByRun(practiceRunId: string): string | null {
    const row = this.db.prepare('SELECT id FROM writing_projects WHERE practice_run_id = ?').get(practiceRunId) as Row | undefined
    return row ? text(row, 'id') : null
  }

  replaceWritingClusters(projectId: string, fingerprint: string, definitions: WritingClusterDefinition[]): void {
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      for (const definition of definitions) {
        const existing = this.db.prepare('SELECT id, status, revision, model_summary, source_fingerprint FROM writing_clusters WHERE project_id = ? AND cluster_key = ?').get(projectId, definition.clusterKey) as Row | undefined
        const clusterId = existing ? text(existing, 'id') : randomUUID()
        const status = existing ? text(existing, 'status') : 'pending'
        const revision = existing ? number(existing, 'revision') : 1
        const sameFingerprint = existing && text(existing, 'source_fingerprint') === fingerprint
        if (existing) {
          this.db.prepare(`UPDATE writing_clusters SET position = ?, title = ?, rule_summary = ?, relevance = ?, source_fingerprint = ?,
            model_summary = CASE WHEN ? = 1 THEN model_summary ELSE NULL END,
            summary_status = CASE WHEN ? = 1 THEN summary_status ELSE 'rule_ready' END, updated_at = ? WHERE id = ?`).run(
            definition.position, definition.title, definition.ruleSummary, definition.relevance, fingerprint, sameFingerprint ? 1 : 0, sameFingerprint ? 1 : 0, now, clusterId,
          )
        } else {
          this.db.prepare(`INSERT INTO writing_clusters(id, project_id, cluster_key, position, title, rule_summary, model_summary, relevance, user_note, status, summary_status, revision, source_fingerprint, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'pending', 'rule_ready', ?, ?, ?, ?)`).run(
            clusterId, projectId, definition.clusterKey, definition.position, definition.title, definition.ruleSummary, definition.relevance, revision, fingerprint, now, now,
          )
        }
        this.db.prepare('DELETE FROM writing_cluster_members WHERE cluster_id = ?').run(clusterId)
        const insert = this.db.prepare(`INSERT INTO writing_cluster_members(id, cluster_id, ref_type, ref_id, role, display_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
        definition.members.forEach((member, index) => insert.run(randomUUID(), clusterId, member.refType, member.refId, member.role, index + 1, now))
      }
    })
    transaction.immediate()
  }

  listWritingClusterDefinitions(projectId: string): Array<{ clusterKey: WritingClusterKey; sourceFingerprint: string; members: Array<{ refType: string; refId: string; role: string }> }> {
    const rows = this.db.prepare(`SELECT c.cluster_key, c.source_fingerprint, m.ref_type, m.ref_id, m.role
      FROM writing_clusters c LEFT JOIN writing_cluster_members m ON m.cluster_id = c.id
      WHERE c.project_id = ? ORDER BY c.position ASC, m.display_order ASC, m.id ASC`).all(projectId) as Row[]
    const definitions = new Map<WritingClusterKey, { sourceFingerprint: string; members: Array<{ refType: string; refId: string; role: string }> }>()
    for (const row of rows) {
      const clusterKey = text(row, 'cluster_key') as WritingClusterKey
      const definition = definitions.get(clusterKey) ?? { sourceFingerprint: text(row, 'source_fingerprint'), members: [] }
      if (row.ref_id != null) definition.members.push({ refType: text(row, 'ref_type'), refId: text(row, 'ref_id'), role: text(row, 'role') })
      definitions.set(clusterKey, definition)
    }
    return [...definitions.entries()].map(([clusterKey, definition]) => ({ clusterKey, ...definition }))
  }

  listWritingClusterModelInputs(projectId: string): Array<{ clusterKey: WritingClusterKey; ruleSummary: string; evidence: string[] }> {
    const rows = this.db.prepare(`SELECT c.cluster_key, c.rule_summary, m.role,
      CASE WHEN m.ref_type = 'artifact' THEN substr(a.content, 1, 700)
           WHEN m.ref_type = 'source' THEN substr(s.excerpt, 1, 700)
           ELSE substr(p.judgment, 1, 700) END AS excerpt
      FROM writing_clusters c
      LEFT JOIN writing_cluster_members m ON m.cluster_id = c.id AND m.role != 'duplicate'
      LEFT JOIN artifacts a ON m.ref_type = 'artifact' AND a.id = m.ref_id
      LEFT JOIN source_items s ON m.ref_type = 'source' AND s.id = m.ref_id
      LEFT JOIN path_nodes p ON m.ref_type = 'path_node' AND p.id = m.ref_id
      WHERE c.project_id = ? ORDER BY c.position ASC, m.display_order ASC`).all(projectId) as Row[]
    const grouped = new Map<WritingClusterKey, { ruleSummary: string; evidence: string[] }>()
    for (const row of rows) {
      const key = text(row, 'cluster_key') as WritingClusterKey
      const current = grouped.get(key) ?? { ruleSummary: text(row, 'rule_summary'), evidence: [] }
      const value = nullableText(row, 'excerpt')
      if (value && current.evidence.length < 3) current.evidence.push(value)
      grouped.set(key, current)
    }
    return [...grouped.entries()].map(([clusterKey, value]) => ({ clusterKey, ...value }))
  }

  replaceWritingCapsules(projectId: string, definitions: WritingCapsuleDefinition[]): void {
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      const insertCapsule = this.db.prepare(`INSERT INTO writing_cluster_capsules(id, project_id, cluster_id, input_fingerprint, version, rule_summary, model_summary, key_findings_json, turning_points_json, unresolved_questions_json, status, raw_count, representative_count, omitted_count, model_failure_code, model_failure_message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'rule_ready', ?, ?, ?, NULL, NULL, ?, ?)`)
      const insertMember = this.db.prepare(`INSERT INTO writing_capsule_members(id, capsule_id, ref_type, ref_id, role, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      for (const definition of definitions) {
        const existing = this.db.prepare('SELECT id FROM writing_cluster_capsules WHERE project_id = ? AND cluster_id = ? AND input_fingerprint = ?').get(projectId, definition.clusterId, definition.inputFingerprint) as Row | undefined
        if (existing) continue
        const latest = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM writing_cluster_capsules WHERE project_id = ? AND cluster_id = ?').get(projectId, definition.clusterId) as Row
        const capsuleId = randomUUID(); const representativeCount = definition.members.filter((member) => member.role !== 'duplicate').length
        insertCapsule.run(capsuleId, projectId, definition.clusterId, definition.inputFingerprint, number(latest, 'version') + 1, definition.ruleSummary, JSON.stringify(definition.keyFindings), JSON.stringify(definition.turningPoints), JSON.stringify(definition.unresolvedQuestions), definition.rawCount, representativeCount, Math.max(definition.rawCount - representativeCount, 0), now, now)
        for (const [index, member] of definition.members.entries()) insertMember.run(randomUUID(), capsuleId, member.refType, member.refId, member.role, index + 1, now)
      }
    })
    transaction.immediate()
  }

  listCurrentWritingCapsules(projectId: string): WritingClusterCapsule[] {
    return (this.db.prepare(`SELECT cap.* FROM writing_cluster_capsules cap INNER JOIN writing_clusters c ON c.id = cap.cluster_id AND c.source_fingerprint = cap.input_fingerprint
      WHERE cap.project_id = ? ORDER BY c.position ASC`).all(projectId) as Row[]).map(writingCapsuleFrom)
  }

  getWritingCapsule(capsuleId: string, projectId: string): WritingClusterCapsule {
    const row = this.db.prepare('SELECT * FROM writing_cluster_capsules WHERE id = ? AND project_id = ?').get(capsuleId, projectId) as Row | undefined
    if (!row) throw new Error('WRITING_CAPSULE_NOT_FOUND')
    return writingCapsuleFrom(row)
  }

  getWritingClusterCapsuleByCluster(clusterId: string, projectId: string): WritingClusterCapsule | null {
    const row = this.db.prepare(`SELECT cap.* FROM writing_cluster_capsules cap INNER JOIN writing_clusters c ON c.id = cap.cluster_id AND c.source_fingerprint = cap.input_fingerprint
      WHERE cap.cluster_id = ? AND cap.project_id = ? ORDER BY cap.version DESC LIMIT 1`).get(clusterId, projectId) as Row | undefined
    return row ? writingCapsuleFrom(row) : null
  }

  updateWritingCapsuleModel(capsuleId: string, input: { modelSummary: string; keyFindings: string[]; turningPoints: string[]; unresolvedQuestions: string[] }): WritingClusterCapsule {
    const updated = this.db.prepare(`UPDATE writing_cluster_capsules SET model_summary = ?, key_findings_json = ?, turning_points_json = ?, unresolved_questions_json = ?, status = 'model_ready', model_failure_code = NULL, model_failure_message = NULL, updated_at = ? WHERE id = ?`).run(input.modelSummary, JSON.stringify(input.keyFindings), JSON.stringify(input.turningPoints), JSON.stringify(input.unresolvedQuestions), new Date().toISOString(), capsuleId)
    if (updated.changes === 0) throw new Error('WRITING_CAPSULE_NOT_FOUND')
    const row = this.db.prepare('SELECT * FROM writing_cluster_capsules WHERE id = ?').get(capsuleId) as Row
    return writingCapsuleFrom(row)
  }

  failWritingCapsule(capsuleId: string, failureCode: string, failureMessage: string): void {
    this.db.prepare("UPDATE writing_cluster_capsules SET status = 'model_failed', model_failure_code = ?, model_failure_message = ?, updated_at = ? WHERE id = ?").run(failureCode, failureMessage, new Date().toISOString(), capsuleId)
  }

  markWritingCapsuleSummaryFailed(projectId: string, fingerprint: string, failureCode: string, failureMessage: string): void {
    this.db.prepare(`UPDATE writing_cluster_capsules SET status = 'model_failed', model_failure_code = ?, model_failure_message = ?, updated_at = ?
      WHERE project_id = ? AND input_fingerprint = ?`).run(failureCode, failureMessage, new Date().toISOString(), projectId, fingerprint)
  }

  applyWritingCapsuleSummaries(projectId: string, fingerprint: string, summaries: Array<{ clusterKey: WritingClusterKey; title: string; summary: string; relevance: string }>): void {
    const capsules = this.listCurrentWritingCapsules(projectId)
    const clusters = (this.db.prepare('SELECT id, cluster_key FROM writing_clusters WHERE project_id = ? AND source_fingerprint = ?').all(projectId, fingerprint) as Row[])
    const clusterKeys = new Map(clusters.map((row) => [text(row, 'id'), text(row, 'cluster_key') as WritingClusterKey]))
    const summaryMap = new Map(summaries.map((summary) => [summary.clusterKey, summary]))
    for (const capsule of capsules) {
      const summary = summaryMap.get(clusterKeys.get(capsule.clusterId) as WritingClusterKey)
      if (!summary || capsule.inputFingerprint !== fingerprint) continue
      this.updateWritingCapsuleModel(capsule.id, { modelSummary: summary.summary, keyFindings: [summary.summary], turningPoints: [], unresolvedQuestions: [summary.relevance] })
    }
  }

  confirmWritingDocument(projectId: string, documentId: string): WritingDocument {
    const updated = this.db.prepare("UPDATE writing_documents SET status = 'confirmed', updated_at = ? WHERE id = ? AND project_id = ? AND kind = 'outline' AND status IN ('generated', 'draft')").run(new Date().toISOString(), documentId, projectId)
    if (updated.changes === 0) throw new Error('WRITING_DOCUMENT_CONFIRM_CONFLICT')
    return this.getWritingDocument(documentId)
  }

  listWritingCapsuleMembers(capsuleId: string): WritingCapsuleMember[] {
    return (this.db.prepare(`SELECT m.*, CASE WHEN m.ref_type = 'artifact' THEN CASE a.kind WHEN 'user_message' THEN '用户判断' WHEN 'tutor_reply' THEN 'Tutor 回复' WHEN 'sql' THEN 'SQL 尝试' WHEN 'explain' THEN 'EXPLAIN 证据' WHEN 'error' THEN '错误证据' ELSE a.kind END
      WHEN m.ref_type = 'source' THEN '知乎来源' ELSE p.title END AS title,
      CASE WHEN m.ref_type = 'artifact' THEN substr(a.content, 1, 1600) WHEN m.ref_type = 'source' THEN substr(s.excerpt, 1, 1600) ELSE p.judgment END AS excerpt,
      CASE WHEN m.ref_type = 'artifact' THEN a.kind WHEN m.ref_type = 'source' THEN s.provider ELSE p.stage END AS kind,
      CASE WHEN m.ref_type = 'artifact' THEN a.verification_status WHEN m.ref_type = 'source' THEN 'source_verified' ELSE 'path_record' END AS verification_status
      FROM writing_capsule_members m LEFT JOIN artifacts a ON m.ref_type = 'artifact' AND a.id = m.ref_id LEFT JOIN source_items s ON m.ref_type = 'source' AND s.id = m.ref_id LEFT JOIN path_nodes p ON m.ref_type = 'path_node' AND p.id = m.ref_id
      WHERE m.capsule_id = ? ORDER BY m.display_order ASC, m.id ASC`).all(capsuleId) as Row[]).map(writingCapsuleMemberFrom)
  }

  listCurrentWritingCapsuleMembers(projectId: string): WritingCapsuleMember[] {
    return (this.db.prepare(`SELECT m.*, CASE WHEN m.ref_type = 'artifact' THEN CASE a.kind WHEN 'user_message' THEN '用户判断' WHEN 'tutor_reply' THEN 'Tutor 回复' WHEN 'sql' THEN 'SQL 尝试' WHEN 'explain' THEN 'EXPLAIN 证据' WHEN 'error' THEN '错误证据' ELSE a.kind END
      WHEN m.ref_type = 'source' THEN '知乎来源' ELSE p.title END AS title,
      CASE WHEN m.ref_type = 'artifact' THEN substr(a.content, 1, 1600) WHEN m.ref_type = 'source' THEN substr(s.excerpt, 1, 1600) ELSE p.judgment END AS excerpt,
      CASE WHEN m.ref_type = 'artifact' THEN a.kind WHEN m.ref_type = 'source' THEN s.provider ELSE p.stage END AS kind,
      CASE WHEN m.ref_type = 'artifact' THEN a.verification_status WHEN m.ref_type = 'source' THEN 'source_verified' ELSE 'path_record' END AS verification_status
      FROM writing_capsule_members m INNER JOIN writing_cluster_capsules cap ON cap.id = m.capsule_id
      INNER JOIN writing_clusters c ON c.id = cap.cluster_id AND c.source_fingerprint = cap.input_fingerprint
      LEFT JOIN artifacts a ON m.ref_type = 'artifact' AND a.id = m.ref_id LEFT JOIN source_items s ON m.ref_type = 'source' AND s.id = m.ref_id LEFT JOIN path_nodes p ON m.ref_type = 'path_node' AND p.id = m.ref_id
      WHERE cap.project_id = ? ORDER BY c.position ASC, m.display_order ASC, m.id ASC`).all(projectId) as Row[]).map(writingCapsuleMemberFrom)
  }

  createWritingEvidencePack(projectId: string, inputFingerprint: string, snapshot: Record<string, unknown>, nodeCount: number, charCount: number): WritingEvidencePack {
    const existing = this.db.prepare('SELECT * FROM writing_evidence_packs WHERE project_id = ? AND input_fingerprint = ?').get(projectId, inputFingerprint) as Row | undefined
    if (existing) return writingEvidencePackFrom(existing)
    const now = new Date().toISOString(); const packId = randomUUID()
    const create = this.db.transaction(() => {
      const latest = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM writing_evidence_packs WHERE project_id = ?').get(projectId) as Row
      this.db.prepare("UPDATE writing_evidence_packs SET status = 'superseded' WHERE project_id = ? AND status = 'active'").run(projectId)
      this.db.prepare(`INSERT INTO writing_evidence_packs(id, project_id, input_fingerprint, version, snapshot_json, node_count, char_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
        .run(packId, projectId, inputFingerprint, number(latest, 'version') + 1, JSON.stringify(snapshot), nodeCount, charCount, now)
      this.db.prepare('UPDATE writing_projects SET current_evidence_pack_id = ?, updated_at = ? WHERE id = ?').run(packId, now, projectId)
    })
    create.immediate()
    return this.getWritingEvidencePack(packId, projectId)
  }

  replaceWritingEvidenceItems(packId: string, projectId: string, items: Array<Omit<WritingEvidenceItem, 'id' | 'projectId' | 'evidencePackId'>>): WritingEvidenceItem[] {
    const write = this.db.transaction(() => {
      const insert = this.db.prepare(`INSERT OR IGNORE INTO writing_evidence_items(id, project_id, evidence_pack_id, ref_type, ref_id, kind, title, body, created_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const fts = this.db.prepare('INSERT INTO writing_evidence_items_fts(item_id, project_id, evidence_pack_id, title, body) VALUES (?, ?, ?, ?, ?)')
      for (const item of items) {
        const id = randomUUID()
        const result = insert.run(id, projectId, packId, item.refType, item.refId, item.kind, item.title, item.body, item.createdAt, JSON.stringify(item.metadata))
        if (result.changes > 0) {
          fts.run(id, projectId, packId, item.title, item.body)
        }
      }
    })
    write.immediate()
    return this.listWritingEvidenceItems(packId)
  }

  listWritingEvidenceItems(packId: string, query?: string, limit = 100): WritingEvidenceItem[] {
    const normalized = query?.trim()
    if (!normalized) return (this.db.prepare('SELECT * FROM writing_evidence_items WHERE evidence_pack_id = ? ORDER BY created_at ASC, id ASC LIMIT ?').all(packId, limit) as Row[]).map(writingEvidenceItemFrom)
    const terms = normalized.split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, ' ')}"`).join(' OR ')
    return (this.db.prepare(`SELECT item.* FROM writing_evidence_items_fts fts INNER JOIN writing_evidence_items item ON item.id = fts.item_id
      WHERE fts.evidence_pack_id = ? AND writing_evidence_items_fts MATCH ? ORDER BY fts.rank LIMIT ?`).all(packId, terms, limit) as Row[]).map(writingEvidenceItemFrom)
  }

  getWritingEvidencePack(packId: string, projectId: string): WritingEvidencePack {
    const row = this.db.prepare('SELECT * FROM writing_evidence_packs WHERE id = ? AND project_id = ?').get(packId, projectId) as Row | undefined
    if (!row) throw new Error('WRITING_EVIDENCE_PACK_NOT_FOUND')
    return writingEvidencePackFrom(row)
  }

  getCurrentWritingEvidencePack(projectId: string): WritingEvidencePack | null {
    const row = this.db.prepare("SELECT * FROM writing_evidence_packs WHERE project_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(projectId) as Row | undefined
    return row ? writingEvidencePackFrom(row) : null
  }

  queueWritingGenerationJob(input: { projectId: string; kind: WritingGenerationKind; inputFingerprint: string; clientRequestId?: string | null; evidencePackId?: string | null; outlineDocumentId?: string | null; provider?: string | null; model?: string | null; retryFailed?: boolean }): WritingGenerationJob {
    const now = new Date().toISOString(); const jobId = randomUUID()
    const existingByRequest = input.clientRequestId ? this.db.prepare('SELECT * FROM writing_generation_jobs WHERE project_id = ? AND kind = ? AND client_request_id = ?').get(input.projectId, input.kind, input.clientRequestId) as Row | undefined : undefined
    if (!existingByRequest) this.db.prepare(`INSERT INTO writing_generation_jobs(id, project_id, kind, input_fingerprint, client_request_id, evidence_pack_id, outline_document_id, status, provider, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?) ON CONFLICT(project_id, kind, input_fingerprint) DO NOTHING`).run(jobId, input.projectId, input.kind, input.inputFingerprint, input.clientRequestId ?? null, input.evidencePackId ?? null, input.outlineDocumentId ?? null, input.provider ?? null, input.model ?? null, now, now)
    const row = existingByRequest ?? this.db.prepare('SELECT * FROM writing_generation_jobs WHERE project_id = ? AND kind = ? AND input_fingerprint = ?').get(input.projectId, input.kind, input.inputFingerprint) as Row
    if (input.retryFailed && text(row, 'status') === 'failed') this.db.prepare("UPDATE writing_generation_jobs SET status = 'queued', attempt_count = 0, failure_code = NULL, failure_message = NULL, updated_at = ?, completed_at = NULL WHERE id = ? AND status = 'failed'").run(now, text(row, 'id'))
    return writingGenerationJobFrom(this.db.prepare('SELECT * FROM writing_generation_jobs WHERE id = ?').get(text(row, 'id')) as Row)
  }

  getWritingGenerationJob(jobId: string, projectId?: string): WritingGenerationJob {
    const row = this.db.prepare(projectId ? 'SELECT * FROM writing_generation_jobs WHERE id = ? AND project_id = ?' : 'SELECT * FROM writing_generation_jobs WHERE id = ?').get(...(projectId ? [jobId, projectId] : [jobId])) as Row | undefined
    if (!row) throw new Error('WRITING_GENERATION_JOB_NOT_FOUND')
    return writingGenerationJobFrom(row)
  }

  listPendingWritingGenerationJobs(): WritingGenerationJob[] {
    return (this.db.prepare("SELECT * FROM writing_generation_jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC").all() as Row[]).map(writingGenerationJobFrom)
  }

  claimWritingDraftRun(id: string): boolean {
    const result = this.db.prepare("UPDATE writing_draft_runs SET status = 'running', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), id)
    return result.changes > 0
  }

  recoverWritingDraftRuns(leaseMs: number): void {
    const threshold = new Date(Date.now() - leaseMs).toISOString()
    this.db.prepare("UPDATE writing_draft_runs SET status = 'queued', phase = 'indexing', failure_code = 'worker_recovered', failure_message = NULL, updated_at = ? WHERE status = 'running' AND updated_at < ?").run(new Date().toISOString(), threshold)
  }

  recoverWritingGenerationJobs(leaseMs: number): void {
    const threshold = new Date(Date.now() - leaseMs).toISOString()
    this.db.prepare("UPDATE writing_generation_jobs SET status = 'queued', updated_at = ?, failure_code = 'worker_recovered' WHERE status = 'running' AND updated_at < ?").run(new Date().toISOString(), threshold)
  }

  claimWritingGenerationJob(jobId: string): boolean {
    const result = this.db.prepare("UPDATE writing_generation_jobs SET status = 'running', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), jobId)
    return result.changes > 0
  }

  requeueWritingGenerationJob(jobId: string): boolean {
    const result = this.db.prepare("UPDATE writing_generation_jobs SET status = 'queued', failure_code = NULL, failure_message = NULL, completed_at = NULL, updated_at = ? WHERE id = ? AND status IN ('running', 'failed', 'interrupted')").run(new Date().toISOString(), jobId)
    return result.changes > 0
  }

  finishWritingGenerationJob(jobId: string, status: 'succeeded' | 'failed' | 'interrupted', resultDocumentId?: string | null, failureCode?: string | null, failureMessage?: string | null, expectedAttemptCount?: number, outputContent?: string | null): void {
    const now = new Date().toISOString()
    const where = expectedAttemptCount === undefined ? 'id = ?' : 'id = ? AND status = \'running\' AND attempt_count = ?'
    const values = expectedAttemptCount === undefined ? [status, resultDocumentId ?? null, outputContent ?? null, failureCode ?? null, failureMessage ?? null, now, now, jobId] : [status, resultDocumentId ?? null, outputContent ?? null, failureCode ?? null, failureMessage ?? null, now, now, jobId, expectedAttemptCount]
    this.db.prepare(`UPDATE writing_generation_jobs SET status = ?, result_document_id = ?, output_content = ?, failure_code = ?, failure_message = ?, updated_at = ?, completed_at = ? WHERE ${where}`).run(...values)
  }

  getWritingClusterOverview(projectId: string, practiceRunId: string): WritingClusterOverview {
    const clusters = (this.db.prepare(`SELECT c.*, COUNT(m.id) AS member_count,
      COALESCE(SUM(CASE WHEN m.role = 'duplicate' THEN 1 ELSE 0 END), 0) AS duplicate_count
      FROM writing_clusters c LEFT JOIN writing_cluster_members m ON m.cluster_id = c.id
      WHERE c.project_id = ? GROUP BY c.id ORDER BY c.position ASC`).all(projectId) as Row[]).map(writingClusterFrom)
    const job = this.db.prepare(`SELECT id, status, failure_message FROM writing_curation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).get(projectId) as Row | undefined
    const status = job ? text(job, 'status') : 'not_started'
    const accepted = clusters.filter((cluster) => cluster.status === 'accepted').map((cluster) => cluster.clusterKey)
    const required = ['problem', 'evidence', 'solution']
    const capsules = this.listCurrentWritingCapsules(projectId)
    return {
      projectId, practiceRunId, clusters, acceptedCount: accepted.length, totalCount: clusters.length,
      requiredAccepted: required.filter((key) => accepted.includes(key as WritingClusterKey)), canGenerateOutline: required.every((key) => accepted.includes(key as WritingClusterKey)),
      capsules,
      curation: { status: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'running' ? 'running' : status === 'queued' ? 'queued' : 'not_started', jobId: job ? text(job, 'id') : null, error: job ? nullableText(job, 'failure_message') : null },
    }
  }

  getWritingCluster(clusterId: string, projectId: string): WritingCluster {
    const row = this.db.prepare(`SELECT c.*, COUNT(m.id) AS member_count,
      COALESCE(SUM(CASE WHEN m.role = 'duplicate' THEN 1 ELSE 0 END), 0) AS duplicate_count
      FROM writing_clusters c LEFT JOIN writing_cluster_members m ON m.cluster_id = c.id
      WHERE c.id = ? AND c.project_id = ? GROUP BY c.id`).get(clusterId, projectId) as Row | undefined
    if (!row) throw new Error('WRITING_CLUSTER_NOT_FOUND')
    return writingClusterFrom(row)
  }

  listWritingClusterMembers(clusterId: string, filter: string | undefined, cursor: string | undefined, limit: number): WritingClusterDetail {
    const params: unknown[] = [clusterId]
    const clauses = ['m.cluster_id = ?', "m.role != 'duplicate'"]
    if (cursor) {
      const [order, id] = cursor.split('|')
      if (order && id) { clauses.push('(m.display_order > ? OR (m.display_order = ? AND m.id > ?))'); params.push(Number(order), Number(order), id) }
    }
    if (filter === 'zhihu') clauses.push("m.ref_type = 'source'")
    if (filter === 'user') clauses.push("m.ref_type = 'artifact' AND a.kind = 'user_message'")
    if (filter === 'tutor') clauses.push("m.ref_type = 'artifact' AND a.kind = 'tutor_reply'")
    if (filter === 'error') clauses.push("m.ref_type = 'artifact' AND a.kind = 'error'")
    if (filter === 'evidence') clauses.push("m.ref_type = 'artifact' AND a.kind IN ('sql', 'explain', 'benchmark', 'result_set')")
    const rows = this.db.prepare(`SELECT m.id, m.cluster_id, m.ref_type, m.ref_id, m.role, m.display_order, m.created_at,
      CASE WHEN m.ref_type = 'artifact' THEN CASE a.kind WHEN 'user_message' THEN '用户判断' WHEN 'tutor_reply' THEN 'Tutor 回复' WHEN 'sql' THEN 'SQL 尝试' WHEN 'explain' THEN 'EXPLAIN 证据' WHEN 'error' THEN '错误证据' ELSE a.kind END
           WHEN m.ref_type = 'source' THEN '知乎来源' ELSE p.title END AS title,
      CASE WHEN m.ref_type = 'artifact' THEN substr(a.content, 1, 1600) WHEN m.ref_type = 'source' THEN substr(s.excerpt, 1, 1600) ELSE p.judgment END AS excerpt,
      CASE WHEN m.ref_type = 'artifact' THEN a.kind WHEN m.ref_type = 'source' THEN s.provider ELSE p.stage END AS kind,
      CASE WHEN m.ref_type = 'artifact' THEN a.verification_status WHEN m.ref_type = 'source' THEN 'source_verified' ELSE 'path_record' END AS verification_status
      FROM writing_cluster_members m
      LEFT JOIN artifacts a ON m.ref_type = 'artifact' AND a.id = m.ref_id
      LEFT JOIN source_items s ON m.ref_type = 'source' AND s.id = m.ref_id
      LEFT JOIN path_nodes p ON m.ref_type = 'path_node' AND p.id = m.ref_id
      WHERE ${clauses.join(' AND ')} ORDER BY m.display_order ASC, m.id ASC LIMIT ?`).all(...params, limit + 1) as Row[]
    const hasNext = rows.length > limit; const page = rows.slice(0, limit).map(writingClusterMemberFrom)
    const next = hasNext && page.length > 0 ? `${page[page.length - 1]!.displayOrder}|${page[page.length - 1]!.id}` : null
    return { cluster: this.getWritingCluster(clusterId, text((this.db.prepare('SELECT project_id FROM writing_clusters WHERE id = ?').get(clusterId) as Row), 'project_id')), members: page, nextCursor: next }
  }

  listAcceptedWritingRefs(projectId: string): Array<{ refType: string; refId: string }> {
    return (this.db.prepare(`SELECT m.ref_type, m.ref_id FROM writing_cluster_members m
      INNER JOIN writing_clusters c ON c.id = m.cluster_id WHERE c.project_id = ? AND c.status = 'accepted' AND m.role != 'duplicate'`).all(projectId) as Row[]).map((row) => ({ refType: text(row, 'ref_type'), refId: text(row, 'ref_id') }))
  }

  updateWritingCluster(clusterId: string, projectId: string, expectedRevision: number, status: WritingClusterStatus, userNote?: string | null): WritingCluster {
    const hasNote = userNote !== undefined
    const result = this.db.prepare(`UPDATE writing_clusters SET status = ?, user_note = ${hasNote ? '?' : 'user_note'}, revision = revision + 1, updated_at = ?
      WHERE id = ? AND project_id = ? AND revision = ?`).run(...(hasNote ? [status, userNote] : [status]), new Date().toISOString(), clusterId, projectId, expectedRevision)
    if (result.changes === 0) throw new Error('WRITING_CLUSTER_REVISION_CONFLICT')
    return this.getWritingCluster(clusterId, projectId)
  }

  queueWritingCurationJob(projectId: string, fingerprint: string, provider: string, model: string, retryFailed = false): { id: string; status: string } {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO writing_curation_jobs(id, project_id, input_fingerprint, status, provider, model, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?) ON CONFLICT(project_id, input_fingerprint) DO NOTHING`).run(id, projectId, fingerprint, provider, model, now, now)
    const row = this.db.prepare('SELECT id, status FROM writing_curation_jobs WHERE project_id = ? AND input_fingerprint = ?').get(projectId, fingerprint) as Row
    if (retryFailed && text(row, 'status') === 'failed') {
      this.db.prepare(`UPDATE writing_curation_jobs SET status = 'queued', attempt_count = 0, provider = ?, model = ?, failure_code = NULL,
        failure_message = NULL, updated_at = ?, completed_at = NULL WHERE id = ? AND status = 'failed'`).run(provider, model, now, text(row, 'id'))
    }
    this.db.prepare("UPDATE writing_clusters SET summary_status = 'queued', updated_at = ? WHERE project_id = ? AND source_fingerprint = ? AND summary_status IN ('rule_ready', 'model_failed')").run(now, projectId, fingerprint)
    const current = this.db.prepare('SELECT id, status FROM writing_curation_jobs WHERE project_id = ? AND input_fingerprint = ?').get(projectId, fingerprint) as Row
    return { id: text(current, 'id'), status: text(current, 'status') }
  }

  getWritingCurationJob(id: string): { id: string; projectId: string; inputFingerprint: string; status: string; attemptCount: number; failureCode: string | null; failureMessage: string | null } {
    const row = this.db.prepare('SELECT * FROM writing_curation_jobs WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('WRITING_CURATION_JOB_NOT_FOUND')
    return { id: text(row, 'id'), projectId: text(row, 'project_id'), inputFingerprint: text(row, 'input_fingerprint'), status: text(row, 'status'), attemptCount: number(row, 'attempt_count'), failureCode: nullableText(row, 'failure_code'), failureMessage: nullableText(row, 'failure_message') }
  }

  listPendingWritingCurationJobs(): Array<{ id: string; projectId: string; inputFingerprint: string }> {
    return (this.db.prepare("SELECT id, project_id, input_fingerprint FROM writing_curation_jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC").all() as Row[]).map((row) => ({ id: text(row, 'id'), projectId: text(row, 'project_id'), inputFingerprint: text(row, 'input_fingerprint') }))
  }

  markWritingCurationJobRunning(id: string): boolean {
    const result = this.db.prepare("UPDATE writing_curation_jobs SET status = 'running', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), id)
    return result.changes > 0
  }

  finishWritingCurationJob(id: string, status: 'succeeded' | 'failed', failureCode?: string, failureMessage?: string, expectedAttemptCount?: number): void {
    const now = new Date().toISOString()
    const where = expectedAttemptCount === undefined ? 'id = ?' : 'id = ? AND status = \'running\' AND attempt_count = ?'
    const values = expectedAttemptCount === undefined ? [status, failureCode ?? null, failureMessage ?? null, now, now, id] : [status, failureCode ?? null, failureMessage ?? null, now, now, id, expectedAttemptCount]
    this.db.prepare(`UPDATE writing_curation_jobs SET status = ?, failure_code = ?, failure_message = ?, updated_at = ?, completed_at = ? WHERE ${where}`).run(...values)
  }

  applyWritingClusterSummaries(projectId: string, fingerprint: string, summaries: Array<{ clusterKey: WritingClusterKey; title: string; summary: string; relevance: string }>): void {
    const update = this.db.prepare(`UPDATE writing_clusters SET title = ?, model_summary = ?, relevance = ?, summary_status = 'model_ready', updated_at = ?
      WHERE project_id = ? AND cluster_key = ? AND source_fingerprint = ?`)
    const now = new Date().toISOString()
    this.db.transaction(() => { for (const summary of summaries) update.run(summary.title, summary.summary.slice(0, 120), summary.relevance.slice(0, 180), now, projectId, summary.clusterKey, fingerprint) })()
  }

  markWritingClusterSummaryFailed(projectId: string, fingerprint: string): void {
    this.db.prepare("UPDATE writing_clusters SET summary_status = 'model_failed', updated_at = ? WHERE project_id = ? AND source_fingerprint = ?").run(new Date().toISOString(), projectId, fingerprint)
  }

  getWritingProject(projectId: string): WritingProject {
    const row = this.db.prepare('SELECT * FROM writing_projects WHERE id = ?').get(projectId) as Row | undefined
    if (!row) throw new Error(`Writing project not found: ${projectId}`)
    const materials = (this.db.prepare('SELECT * FROM writing_materials WHERE project_id = ? ORDER BY selected DESC, created_at ASC').all(projectId) as Row[]).map(writingMaterialFrom)
    const documents = this.listWritingDocuments(projectId)
    const reviewItems = (this.db.prepare('SELECT * FROM writing_review_items WHERE project_id = ? ORDER BY severity DESC, created_at ASC').all(projectId) as Row[]).map(writingReviewItemFrom)
    return {
      id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), articleType: 'engineering_practice_review',
      status: text(row, 'status') as WritingProject['status'], evidenceSnapshot: json<WritingProject['evidenceSnapshot']>(row.evidence_snapshot_json, { capturedAt: null, materialIds: [] }), currentEvidencePackId: nullableText(row, 'current_evidence_pack_id'),
      materials, documents, reviewItems, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  getWritingWorkspaceProject(projectId: string): WritingProject {
    const row = this.db.prepare('SELECT * FROM writing_projects WHERE id = ?').get(projectId) as Row | undefined
    if (!row) throw new Error(`Writing project not found: ${projectId}`)
    const documents = this.listWritingDocuments(projectId).filter((document) => document.kind === 'article')
    const reviewItems = (this.db.prepare('SELECT * FROM writing_review_items WHERE project_id = ? ORDER BY severity DESC, created_at ASC').all(projectId) as Row[]).map(writingReviewItemFrom)
    return {
      id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), articleType: 'engineering_practice_review',
      status: text(row, 'status') as WritingProject['status'], evidenceSnapshot: json<WritingProject['evidenceSnapshot']>(row.evidence_snapshot_json, { capturedAt: null, materialIds: [] }), currentEvidencePackId: nullableText(row, 'current_evidence_pack_id'),
      materials: [], documents, reviewItems, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  upsertWritingMaterial(input: Omit<WritingMaterial, 'id' | 'createdAt' | 'projectId'> & { projectId: string }): WritingMaterial {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO writing_materials(id, project_id, category, ref_type, ref_id, title, excerpt, selected, verification_status, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, ref_type, ref_id) DO UPDATE SET category = excluded.category, title = excluded.title, excerpt = excluded.excerpt, verification_status = excluded.verification_status, metadata_json = excluded.metadata_json`).run(
      id, input.projectId, input.category, input.refType, input.refId, input.title, input.excerpt, input.selected ? 1 : 0, input.verificationStatus, JSON.stringify(input.metadata), now,
    )
    return writingMaterialFrom(this.db.prepare('SELECT * FROM writing_materials WHERE project_id = ? AND ref_type = ? AND ref_id = ?').get(input.projectId, input.refType, input.refId) as Row)
  }

  updateWritingMaterial(projectId: string, materialId: string, update: { selected?: boolean; editorialNote?: string | null }): WritingMaterial {
    const fields: string[] = []; const values: unknown[] = []
    if (update.selected !== undefined) { fields.push('selected = ?'); values.push(update.selected ? 1 : 0) }
    if (update.editorialNote !== undefined) {
      const row = this.db.prepare('SELECT metadata_json FROM writing_materials WHERE id = ? AND project_id = ?').get(materialId, projectId) as Row | undefined
      if (!row) throw new Error(`Writing material not found: ${materialId}`)
      const metadata = json<Record<string, unknown>>(row.metadata_json, {}); metadata.editorialNote = update.editorialNote
      fields.push('metadata_json = ?'); values.push(JSON.stringify(metadata))
    }
    if (fields.length > 0) this.db.prepare(`UPDATE writing_materials SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`).run(...values, materialId, projectId)
    const row = this.db.prepare('SELECT * FROM writing_materials WHERE id = ? AND project_id = ?').get(materialId, projectId) as Row | undefined
    if (!row) throw new Error(`Writing material not found: ${materialId}`)
    return writingMaterialFrom(row)
  }

  updateWritingSnapshot(projectId: string, materialIds: string[], status: WritingProject['status']): void {
    this.db.prepare('UPDATE writing_projects SET evidence_snapshot_json = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ capturedAt: new Date().toISOString(), materialIds }), status, new Date().toISOString(), projectId)
  }

  createWritingDocument(input: {
    projectId: string
    kind: WritingDocument['kind']
    status: WritingDocument['status']
    title: string
    summary: string
    evidencePackId?: string | null
    sections: Array<Pick<WritingSection, 'sectionKey' | 'position' | 'title' | 'content' | 'required' | 'status' | 'evidenceRefs' | 'sourceRefs'> & { blocks?: WritingBlockDraft[] }>
    claims: Array<{ sectionKey: string; text: string; kind: WritingClaim['kind']; status: WritingClaim['status']; evidenceRefs: string[]; sourceRefs: string[] }>
  }): WritingDocument {
    const documentId = randomUUID(); const now = new Date().toISOString()
    const sectionIds = new Map<string, string>()
    const create = this.db.transaction(() => {
      const current = this.db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM writing_documents WHERE project_id = ? AND kind = ?').get(input.projectId, input.kind) as Row
      const revision = number(current, 'revision') + 1
      this.db.prepare(`INSERT INTO writing_documents(id, project_id, kind, revision, status, title, summary, evidence_pack_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(documentId, input.projectId, input.kind, revision, input.status, input.title, input.summary, input.evidencePackId ?? null, now, now)
      const insertSection = this.db.prepare(`INSERT INTO writing_sections(id, document_id, section_key, position, title, content, required, status, evidence_refs_json, source_refs_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const section of input.sections) {
        const sectionId = randomUUID(); sectionIds.set(section.sectionKey, sectionId)
        insertSection.run(sectionId, documentId, section.sectionKey, section.position, section.title, section.content, section.required ? 1 : 0, section.status, JSON.stringify(section.evidenceRefs), JSON.stringify(section.sourceRefs), now)
        const blocks = section.blocks?.length ? section.blocks : fallbackBlocks(section)
        const insertBlock = this.db.prepare(`INSERT INTO writing_section_blocks(id, document_id, section_id, position, content, block_type, evidence_refs_json, source_refs_json, reference_roles_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        for (const block of blocks) insertBlock.run(randomUUID(), documentId, sectionId, block.position, block.content, block.blockType ?? 'paragraph', JSON.stringify(block.evidenceRefs), JSON.stringify(block.sourceRefs), JSON.stringify(block.referenceRoles ?? {}), now, now)
      }
      const insertClaim = this.db.prepare(`INSERT INTO writing_claims(id, document_id, section_id, text, kind, status, evidence_refs_json, source_refs_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const claim of input.claims) {
        const sectionId = sectionIds.get(claim.sectionKey)
        if (!sectionId) continue
        insertClaim.run(randomUUID(), documentId, sectionId, claim.text, claim.kind, claim.status, JSON.stringify(claim.evidenceRefs), JSON.stringify(claim.sourceRefs), now)
      }
    })
    create.immediate()
    return this.getWritingDocument(documentId)
  }

  persistWritingGeneration(input: {
    jobId: string
    attemptCount: number
    projectId: string
    learnerId: string
    practiceRunId: string
    kind: WritingDocument['kind']
    evidencePackId: string
    title: string
    summary: string
    sections: Array<Pick<WritingSection, 'sectionKey' | 'position' | 'title' | 'content' | 'required' | 'status' | 'evidenceRefs' | 'sourceRefs'> & { blocks?: WritingBlockDraft[] }>
    claims: Array<{ sectionKey: string; text: string; kind: WritingClaim['kind']; status: WritingClaim['status']; evidenceRefs: string[]; sourceRefs: string[] }>
    artifactKind: ArtifactKind
    eventType: EventType
    stage: CaseStage
    artifactContent: string
    projectStatus: WritingProject['status']
  }): WritingDocument {
    const documentId = randomUUID(); const artifactId = randomUUID(); const eventId = randomUUID(); const now = new Date().toISOString(); const checksum = createHash('sha256').update(input.artifactContent).digest('hex')
    const persist = this.db.transaction(() => {
      const running = this.db.prepare("SELECT id FROM writing_generation_jobs WHERE id = ? AND status = 'running' AND attempt_count = ?").get(input.jobId, input.attemptCount) as Row | undefined
      if (!running) throw new Error('WRITING_GENERATION_JOB_NOT_RUNNING')
      const current = this.db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM writing_documents WHERE project_id = ? AND kind = ?').get(input.projectId, input.kind) as Row
      const revision = number(current, 'revision') + 1
      this.db.prepare(`INSERT INTO writing_documents(id, project_id, kind, revision, status, title, summary, evidence_pack_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(documentId, input.projectId, input.kind, revision, input.kind === 'outline' ? 'generated' : 'needs_review', input.title, input.summary, input.evidencePackId, now, now)
      const sectionIds = new Map<string, string>(); const insertSection = this.db.prepare(`INSERT INTO writing_sections(id, document_id, section_key, position, title, content, required, status, evidence_refs_json, source_refs_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const section of input.sections) {
        const sectionId = randomUUID(); sectionIds.set(section.sectionKey, sectionId); insertSection.run(sectionId, documentId, section.sectionKey, section.position, section.title, section.content, section.required ? 1 : 0, section.status, JSON.stringify(section.evidenceRefs), JSON.stringify(section.sourceRefs), now)
        const blocks = section.blocks?.length ? section.blocks : fallbackBlocks(section)
        const insertBlock = this.db.prepare(`INSERT INTO writing_section_blocks(id, document_id, section_id, position, content, block_type, evidence_refs_json, source_refs_json, reference_roles_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        for (const block of blocks) insertBlock.run(randomUUID(), documentId, sectionId, block.position, block.content, block.blockType ?? 'paragraph', JSON.stringify(block.evidenceRefs), JSON.stringify(block.sourceRefs), JSON.stringify(block.referenceRoles ?? {}), now, now)
      }
      const insertClaim = this.db.prepare(`INSERT INTO writing_claims(id, document_id, section_id, text, kind, status, evidence_refs_json, source_refs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const claim of input.claims) { const sectionId = sectionIds.get(claim.sectionKey); if (sectionId) insertClaim.run(randomUUID(), documentId, sectionId, claim.text, claim.kind, claim.status, JSON.stringify(claim.evidenceRefs), JSON.stringify(claim.sourceRefs), now) }
      this.db.prepare(`INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at) VALUES (?, ?, ?, ?, 'system', 'model_generated', ?, ?, ?, ?)`)
        .run(artifactId, input.learnerId, input.practiceRunId, input.artifactKind, input.artifactContent, JSON.stringify({ documentId, evidencePackId: input.evidencePackId, generationJobId: input.jobId }), checksum, now)
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM practice_events WHERE practice_run_id = ?').get(input.practiceRunId) as Row
      this.db.prepare(`INSERT INTO practice_events(id, learner_id, practice_run_id, sequence, actor, type, stage, payload_json, artifact_refs_json, client_request_id, created_at) VALUES (?, ?, ?, ?, 'system', ?, ?, ?, ?, NULL, ?)`)
        .run(eventId, input.learnerId, input.practiceRunId, number(next, 'sequence'), input.eventType, input.stage, JSON.stringify({ documentId, artifactId, evidencePackId: input.evidencePackId, generationJobId: input.jobId }), JSON.stringify([artifactId]), now)
      this.db.prepare('UPDATE writing_projects SET status = ?, evidence_snapshot_json = ?, current_evidence_pack_id = ?, updated_at = ? WHERE id = ?').run(input.projectStatus, JSON.stringify({ capturedAt: now, materialIds: [], evidencePackId: input.evidencePackId }), input.evidencePackId, now, input.projectId)
      const claimed = this.db.prepare("UPDATE writing_generation_jobs SET status = 'succeeded', result_document_id = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(documentId, now, now, input.jobId, input.attemptCount)
      if (claimed.changes === 0) throw new Error('WRITING_GENERATION_JOB_NOT_RUNNING')
    })
    persist.immediate()
    return this.getWritingDocument(documentId)
  }

  getWritingDocument(documentId: string): WritingDocument {
    const row = this.db.prepare('SELECT * FROM writing_documents WHERE id = ?').get(documentId) as Row | undefined
    if (!row) throw new Error(`Writing document not found: ${documentId}`)
    const sections = (this.db.prepare('SELECT * FROM writing_sections WHERE document_id = ? ORDER BY position ASC').all(documentId) as Row[]).map((section) => writingSectionFrom(section))
    const claims = (this.db.prepare('SELECT * FROM writing_claims WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as Row[]).map(writingClaimFrom)
    const blocks = (this.db.prepare('SELECT * FROM writing_section_blocks WHERE document_id = ? ORDER BY section_id ASC, position ASC').all(documentId) as Row[]).map(writingBlockFrom)
    const narrativeBlocks = (this.db.prepare('SELECT * FROM writing_document_blocks WHERE document_id = ? ORDER BY position ASC').all(documentId) as Row[]).map(writingDocumentBlockFrom)
    return writingDocumentFrom(row, sections.map((section) => ({ ...section, blocks: blocks.filter((block) => block.sectionId === section.id) })), claims, narrativeBlocks)
  }

  listWritingDocuments(projectId: string): WritingDocument[] {
    const rows = this.db.prepare(`SELECT document.* FROM writing_documents document
      INNER JOIN (SELECT kind, MAX(revision) AS revision FROM writing_documents WHERE project_id = ? GROUP BY kind) latest
      ON latest.kind = document.kind AND latest.revision = document.revision
      WHERE document.project_id = ? ORDER BY document.kind ASC`).all(projectId, projectId) as Row[]
    if (rows.length === 0) return []
    const ids = rows.map((row) => text(row, 'id')); const placeholders = ids.map(() => '?').join(', ')
    const sectionRows = this.db.prepare(`SELECT * FROM writing_sections WHERE document_id IN (${placeholders}) ORDER BY position ASC`).all(...ids) as Row[]
    const claimRows = this.db.prepare(`SELECT * FROM writing_claims WHERE document_id IN (${placeholders}) ORDER BY created_at ASC`).all(...ids) as Row[]
    const blockRows = this.db.prepare(`SELECT * FROM writing_section_blocks WHERE document_id IN (${placeholders}) ORDER BY document_id ASC, section_id ASC, position ASC`).all(...ids) as Row[]
    const narrativeBlockRows = this.db.prepare(`SELECT * FROM writing_document_blocks WHERE document_id IN (${placeholders}) ORDER BY document_id ASC, position ASC`).all(...ids) as Row[]
    return rows.map((row) => {
      const documentId = text(row, 'id')
      const sections = sectionRows.filter((section) => text(section, 'document_id') === documentId).map((section) => {
        const parsed = writingSectionFrom(section)
        return { ...parsed, blocks: blockRows.filter((block) => text(block, 'document_id') === documentId && text(block, 'section_id') === parsed.id).map(writingBlockFrom) }
      })
      const claims = claimRows.filter((claim) => text(claim, 'document_id') === documentId).map(writingClaimFrom)
      const narrativeBlocks = narrativeBlockRows.filter((block) => text(block, 'document_id') === documentId).map(writingDocumentBlockFrom)
      return writingDocumentFrom(row, sections, claims, narrativeBlocks)
    })
  }

  updateWritingSection(projectId: string, documentId: string, sectionId: string, expectedRevision: number, content: string): WritingDocument {
    const result = this.db.transaction(() => {
      const document = this.db.prepare('SELECT id FROM writing_documents WHERE id = ? AND project_id = ?').get(documentId, projectId) as Row | undefined
      if (!document) throw new Error('WRITING_DOCUMENT_NOT_FOUND')
      const updated = this.db.prepare('UPDATE writing_documents SET revision = revision + 1, status = CASE WHEN kind = \'article\' THEN \'needs_review\' ELSE status END, updated_at = ? WHERE id = ? AND project_id = ? AND revision = ?').run(new Date().toISOString(), documentId, projectId, expectedRevision)
      if (updated.changes === 0) throw new Error('WRITING_REVISION_CONFLICT')
      const section = this.db.prepare('UPDATE writing_sections SET content = ?, status = \'confirmed\', updated_at = ? WHERE id = ? AND document_id = ?').run(content, new Date().toISOString(), sectionId, documentId)
      if (section.changes === 0) throw new Error('WRITING_SECTION_NOT_FOUND')
      this.db.prepare('DELETE FROM writing_section_blocks WHERE document_id = ? AND section_id = ?').run(documentId, sectionId)
      const source = this.db.prepare('SELECT evidence_refs_json, source_refs_json FROM writing_sections WHERE id = ? AND document_id = ?').get(sectionId, documentId) as Row
      const blocks = fallbackBlocks({ content, evidenceRefs: json<string[]>(source.evidence_refs_json, []), sourceRefs: json<string[]>(source.source_refs_json, []) })
      const insertBlock = this.db.prepare(`INSERT INTO writing_section_blocks(id, document_id, section_id, position, content, block_type, evidence_refs_json, source_refs_json, reference_roles_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      for (const block of blocks) insertBlock.run(randomUUID(), documentId, sectionId, block.position, block.content, block.blockType ?? 'paragraph', JSON.stringify(block.evidenceRefs), JSON.stringify(block.sourceRefs), JSON.stringify(block.referenceRoles ?? {}), new Date().toISOString(), new Date().toISOString())
      this.db.prepare("UPDATE writing_claims SET status = 'needs_review' WHERE document_id = ? AND section_id = ?").run(documentId, sectionId)
    })
    result()
    return this.getWritingDocument(documentId)
  }

  updateWritingBlock(projectId: string, documentId: string, blockId: string, expectedRevision: number, content: string): WritingDocument {
    const now = new Date().toISOString()
    const update = this.db.transaction(() => {
      const document = this.db.prepare('SELECT id, format FROM writing_documents WHERE id = ? AND project_id = ?').get(documentId, projectId) as Row | undefined
      if (!document) throw new Error('WRITING_DOCUMENT_NOT_FOUND')
      if (text(document, 'format') === 'narrative') {
        const block = this.db.prepare('SELECT * FROM writing_document_blocks WHERE id = ? AND document_id = ?').get(blockId, documentId) as Row | undefined
        if (!block) throw new Error('WRITING_BLOCK_NOT_FOUND')
        const changed = this.db.prepare('UPDATE writing_document_blocks SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(content, now, blockId, expectedRevision)
        if (changed.changes === 0) throw new Error('WRITING_BLOCK_REVISION_CONFLICT')
        const rows = (this.db.prepare('SELECT * FROM writing_document_blocks WHERE document_id = ? ORDER BY position ASC').all(documentId) as Row[]).map(writingDocumentBlockFrom)
        this.db.prepare("UPDATE writing_documents SET content_markdown = ?, revision = revision + 1, status = 'needs_review', updated_at = ? WHERE id = ? AND project_id = ?").run(markdownFromNarrativeBlocks(rows), now, documentId, projectId)
        return
      }
      const block = this.db.prepare(`SELECT b.id, b.section_id FROM writing_section_blocks b INNER JOIN writing_documents d ON d.id = b.document_id WHERE b.id = ? AND b.document_id = ? AND d.project_id = ?`).get(blockId, documentId, projectId) as Row | undefined
      if (!block) throw new Error('WRITING_BLOCK_NOT_FOUND')
      const changed = this.db.prepare('UPDATE writing_section_blocks SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(content, now, blockId, expectedRevision)
      if (changed.changes === 0) throw new Error('WRITING_BLOCK_REVISION_CONFLICT')
      const rows = this.db.prepare('SELECT content FROM writing_section_blocks WHERE section_id = ? ORDER BY position ASC').all(text(block, 'section_id')) as Row[]
      this.db.prepare('UPDATE writing_sections SET content = ?, status = \'confirmed\', updated_at = ? WHERE id = ? AND document_id = ?').run(rows.map((row) => text(row, 'content')).join('\n\n'), now, text(block, 'section_id'), documentId)
      const sectionDocument = this.db.prepare('SELECT kind FROM writing_documents WHERE id = ? AND project_id = ?').get(documentId, projectId) as Row | undefined
      if (!sectionDocument) throw new Error('WRITING_DOCUMENT_NOT_FOUND')
      this.db.prepare('UPDATE writing_documents SET revision = revision + 1, status = CASE WHEN kind = \'article\' THEN \'needs_review\' ELSE status END, updated_at = ? WHERE id = ? AND project_id = ?').run(now, documentId, projectId)
      this.db.prepare("UPDATE writing_claims SET status = 'needs_review' WHERE document_id = ? AND section_id = ?").run(documentId, text(block, 'section_id'))
    })
    update()
    return this.getWritingDocument(documentId)
  }

  persistNarrativeWritingGeneration(input: {
    jobId: string
    attemptCount: number
    projectId: string
    learnerId: string
    practiceRunId: string
    evidencePackId: string
    title: string
    summary: string
    markdown: string
    blocks: NarrativeBlockDraft[]
  }): WritingDocument {
    const documentId = randomUUID(); const artifactId = randomUUID(); const eventId = randomUUID(); const now = new Date().toISOString(); const checksum = createHash('sha256').update(input.markdown).digest('hex')
    const persist = this.db.transaction(() => {
      const running = this.db.prepare("SELECT id FROM writing_generation_jobs WHERE id = ? AND status = 'running' AND attempt_count = ?").get(input.jobId, input.attemptCount) as Row | undefined
      if (!running) throw new Error('WRITING_GENERATION_JOB_NOT_RUNNING')
      const current = this.db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM writing_documents WHERE project_id = ? AND kind = 'article'").get(input.projectId) as Row
      const revision = number(current, 'revision') + 1
      this.db.prepare(`INSERT INTO writing_documents(id, project_id, kind, revision, status, title, summary, evidence_pack_id, format, content_markdown, created_at, updated_at)
        VALUES (?, ?, 'article', ?, 'needs_review', ?, ?, ?, 'narrative', ?, ?, ?)`).run(documentId, input.projectId, revision, input.title, input.summary, input.evidencePackId, input.markdown, now, now)
      const insertBlock = this.db.prepare(`INSERT INTO writing_document_blocks(id, document_id, position, content, block_type, evidence_refs_json, source_refs_json, reference_roles_json, reference_markers_json, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      for (const block of input.blocks) insertBlock.run(randomUUID(), documentId, block.position, block.content, block.blockType, JSON.stringify(block.evidenceRefs), JSON.stringify(block.sourceRefs), JSON.stringify(block.referenceRoles ?? {}), JSON.stringify(block.referenceMarkers ?? []), now, now)
      this.db.prepare(`INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at)
        VALUES (?, ?, ?, 'article_draft', 'system', 'model_generated', ?, ?, ?, ?)`).run(artifactId, input.learnerId, input.practiceRunId, input.markdown, JSON.stringify({ documentId, evidencePackId: input.evidencePackId, generationJobId: input.jobId, format: 'narrative' }), checksum, now)
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM practice_events WHERE practice_run_id = ?').get(input.practiceRunId) as Row
      this.db.prepare(`INSERT INTO practice_events(id, learner_id, practice_run_id, sequence, actor, type, stage, payload_json, artifact_refs_json, client_request_id, created_at)
        VALUES (?, ?, ?, ?, 'system', 'article_draft_generated', ?, ?, ?, NULL, ?)`).run(eventId, input.learnerId, input.practiceRunId, number(next, 'sequence'), 'resolved', JSON.stringify({ documentId, artifactId, evidencePackId: input.evidencePackId, generationJobId: input.jobId, format: 'narrative' }), JSON.stringify([artifactId]), now)
      this.db.prepare("UPDATE writing_projects SET status = 'ready_for_preview', evidence_snapshot_json = ?, current_evidence_pack_id = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ capturedAt: now, materialIds: [], evidencePackId: input.evidencePackId }), input.evidencePackId, now, input.projectId)
      const claimed = this.db.prepare("UPDATE writing_generation_jobs SET status = 'succeeded', result_document_id = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(documentId, now, now, input.jobId, input.attemptCount)
      if (claimed.changes === 0) throw new Error('WRITING_GENERATION_JOB_NOT_RUNNING')
    })
    persist.immediate()
    return this.getWritingDocument(documentId)
  }

  createWritingDraftRun(projectId: string, inputFingerprint: string): WritingDraftRun {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO writing_draft_runs(id, project_id, input_fingerprint, status, phase, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'indexing', ?, ?) ON CONFLICT(project_id, input_fingerprint) DO NOTHING`).run(id, projectId, inputFingerprint, now, now)
    return this.getWritingDraftRunByFingerprint(projectId, inputFingerprint)
  }

  getWritingDraftRunByFingerprint(projectId: string, inputFingerprint: string): WritingDraftRun {
    const row = this.db.prepare('SELECT * FROM writing_draft_runs WHERE project_id = ? AND input_fingerprint = ?').get(projectId, inputFingerprint) as Row | undefined
    if (!row) throw new Error('WRITING_DRAFT_RUN_NOT_FOUND')
    return writingDraftRunFrom(row)
  }

  getWritingDraftRun(id: string, projectId?: string): WritingDraftRun {
    const row = this.db.prepare(projectId ? 'SELECT * FROM writing_draft_runs WHERE id = ? AND project_id = ?' : 'SELECT * FROM writing_draft_runs WHERE id = ?').get(...(projectId ? [id, projectId] : [id])) as Row | undefined
    if (!row) throw new Error('WRITING_DRAFT_RUN_NOT_FOUND')
    return writingDraftRunFrom(row)
  }

  getLatestWritingDraftRun(projectId: string): WritingDraftRun | null {
    const row = this.db.prepare('SELECT * FROM writing_draft_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId) as Row | undefined
    return row ? writingDraftRunFrom(row) : null
  }

  updateWritingDraftRun(id: string, update: Partial<Pick<WritingDraftRun, 'status' | 'phase' | 'evidencePackId' | 'outlineJobId' | 'articleJobId' | 'draftJobId' | 'humanizeJobId' | 'outlineDocumentId' | 'articleDocumentId' | 'attemptCount' | 'failureCode' | 'failureMessage' | 'completedAt'>>): WritingDraftRun {
    const fields: string[] = []; const values: unknown[] = []
    const map: Record<string, string> = { status: 'status', phase: 'phase', evidencePackId: 'evidence_pack_id', outlineJobId: 'outline_job_id', articleJobId: 'article_job_id', draftJobId: 'draft_job_id', humanizeJobId: 'humanize_job_id', outlineDocumentId: 'outline_document_id', articleDocumentId: 'article_document_id', attemptCount: 'attempt_count', failureCode: 'failure_code', failureMessage: 'failure_message', completedAt: 'completed_at' }
    for (const [key, column] of Object.entries(map)) if (key in update) { fields.push(`${column} = ?`); values.push(update[key as keyof typeof update] ?? null) }
    if (fields.length === 0) return this.getWritingDraftRun(id)
    fields.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(id)
    this.db.prepare(`UPDATE writing_draft_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getWritingDraftRun(id)
  }

  listPendingWritingDraftRuns(): WritingDraftRun[] {
    return (this.db.prepare("SELECT * FROM writing_draft_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC").all() as Row[]).map(writingDraftRunFrom)
  }

  getWritingBlockEvidence(projectId: string, documentId: string, blockId: string): WritingBlockEvidence {
    const narrativeRow = this.db.prepare(`SELECT b.* FROM writing_document_blocks b INNER JOIN writing_documents d ON d.id = b.document_id WHERE b.id = ? AND b.document_id = ? AND d.project_id = ?`).get(blockId, documentId, projectId) as Row | undefined
    const sectionRow = narrativeRow ? undefined : this.db.prepare(`SELECT b.* FROM writing_section_blocks b INNER JOIN writing_documents d ON d.id = b.document_id WHERE b.id = ? AND b.document_id = ? AND d.project_id = ?`).get(blockId, documentId, projectId) as Row | undefined
    if (!narrativeRow && !sectionRow) throw new Error('WRITING_BLOCK_NOT_FOUND')
    const block = narrativeRow ? { ...writingDocumentBlockFrom(narrativeRow), sectionId: null as null } : writingBlockFrom(sectionRow!)
    const refs: WritingEvidenceReference[] = []
    const typedRefs = new Map<string, Set<string>>()
    const addRef = (type: string, id: string) => { if (!['artifact', 'event', 'path_node', 'source'].includes(type) || !id) return; const ids = typedRefs.get(type) ?? new Set<string>(); ids.add(id); typedRefs.set(type, ids) }
    for (const id of block.evidenceRefs) addRef('artifact', id)
    for (const id of block.sourceRefs) addRef('source', id)
    for (const marker of 'referenceMarkers' in block ? block.referenceMarkers : []) {
      const match = /^\[\[ref:([^:\]]+):([^\]]+)\]\]$/.exec(marker)
      if (match) addRef(match[1]!, match[2]!)
    }
    const practiceRunId = text(this.db.prepare('SELECT practice_run_id FROM writing_projects WHERE id = ?').get(projectId) as Row, 'practice_run_id')
    const artifactIds = [...(typedRefs.get('artifact') ?? [])]
    if (artifactIds.length > 0) {
      const placeholders = artifactIds.map(() => '?').join(', ')
      const artifacts = this.db.prepare(`SELECT id, kind, verification_status, content FROM artifacts WHERE id IN (${placeholders}) AND practice_run_id = ?`).all(...artifactIds, practiceRunId) as Row[]
      for (const artifact of artifacts) refs.push({ refType: 'artifact', refId: text(artifact, 'id'), title: text(artifact, 'kind'), content: text(artifact, 'content'), kind: text(artifact, 'kind'), verificationStatus: text(artifact, 'verification_status'), role: block.referenceRoles[text(artifact, 'id')] ?? 'lab', url: null, author: null })
    }
    const pathIds = [...(typedRefs.get('path_node') ?? [])]
    if (pathIds.length > 0) {
      const placeholders = pathIds.map(() => '?').join(', ')
      const paths = this.db.prepare(`SELECT id, title, judgment, outcome FROM path_nodes WHERE id IN (${placeholders}) AND practice_run_id = ?`).all(...pathIds, practiceRunId) as Row[]
      for (const path of paths) refs.push({ refType: 'path_node', refId: text(path, 'id'), title: text(path, 'title'), content: `${text(path, 'judgment')}\n结果：${text(path, 'outcome')}`, kind: 'path_node', verificationStatus: 'path_record', role: block.referenceRoles[text(path, 'id')] ?? 'inherited', url: null, author: null })
    }
    const eventIds = [...(typedRefs.get('event') ?? [])]
    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => '?').join(', ')
      const events = this.db.prepare(`SELECT id, type, payload_json FROM practice_events WHERE id IN (${placeholders}) AND practice_run_id = ?`).all(...eventIds, practiceRunId) as Row[]
      for (const event of events) refs.push({ refType: 'event', refId: text(event, 'id'), title: `实践事件 · ${text(event, 'type')}`, content: text(event, 'payload_json'), kind: text(event, 'type'), verificationStatus: 'event_record', role: block.referenceRoles[text(event, 'id')] ?? 'inherited', url: null, author: null })
    }
    const sourceIds = [...(typedRefs.get('source') ?? [])]
    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => '?').join(', ')
      const sources = this.db.prepare(`SELECT id, title, author, url, excerpt, provider FROM source_items WHERE id IN (${placeholders})`).all(...sourceIds) as Row[]
      for (const source of sources) refs.push({ refType: 'source', refId: text(source, 'id'), title: text(source, 'title'), content: text(source, 'excerpt'), kind: text(source, 'provider'), verificationStatus: 'source_verified', role: 'source', url: text(source, 'url'), author: nullableText(source, 'author') })
    }
    return { block, references: refs }
  }

  replaceWritingReviewItems(projectId: string, items: Array<Omit<WritingReviewItem, 'id' | 'projectId' | 'createdAt'>>): WritingReviewItem[] {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM writing_review_items WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(`INSERT INTO writing_review_items(id, project_id, code, severity, status, message, section_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const item of items) insert.run(randomUUID(), projectId, item.code, item.severity, item.status, item.message, item.sectionId, now)
    })()
    return (this.db.prepare('SELECT * FROM writing_review_items WHERE project_id = ? ORDER BY severity DESC, created_at ASC').all(projectId) as Row[]).map(writingReviewItemFrom)
  }

  updateWritingStatus(projectId: string, status: WritingProject['status']): void {
    this.db.prepare('UPDATE writing_projects SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), projectId)
  }

  snapshot(practiceRunId: string): PracticeSnapshot {
    const run = this.getPracticeRun(practiceRunId)
    const snapshot = { run, events: this.listEvents(practiceRunId), artifacts: this.listArtifacts(practiceRunId), pathNodes: this.listPathNodes(practiceRunId), stageMemories: this.listStageMemories(practiceRunId), memories: this.listMemories(run.learnerId), tutorTurns: this.listTutorTurns(practiceRunId), pins: this.listPracticePins(practiceRunId) }
    return { ...snapshot, completion: evaluatePracticeCompletion(run, snapshot) }
  }
}
