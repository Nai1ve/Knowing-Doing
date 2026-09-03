export type PlanningTemplateKey = 'senior-backend-ai-v1'
export type PlanningSessionStatus = 'draft' | 'ready' | 'proposed' | 'confirmed' | 'superseded'
export type RoadmapStatus = 'draft' | 'active' | 'archived' | 'superseded'
export type RoadmapNodeStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'verified' | 'self_reported'
export type RoadmapNodeType = 'domain' | 'capability' | 'concept' | 'lab' | 'project'
export type RoadmapLearningMode = 'lab' | 'knowledge' | 'unavailable'

export interface PlanningTurn {
  id: string
  sequence: number
  stepKey: string
  prompt: string
  answer: string
  structuredValue: unknown
  createdAt: string
}

export interface PlanningSession {
  id: string
  learnerId: string
  templateKey: PlanningTemplateKey
  goal: string
  status: PlanningSessionStatus
  currentStep: number
  revision: number
  answers: Record<string, unknown>
  turns: PlanningTurn[]
  nextQuestion: { key: string; prompt: string; options: string[] } | null
  draftRoadmapId: string | null
  createdAt: string
  updatedAt: string
}

export interface RoadmapNode {
  id: string
  roadmapId: string
  parentId: string | null
  nodeKey: string
  nodeType: RoadmapNodeType
  title: string
  summary: string
  knowledgeCard: { keyPoints?: string[]; examples?: string[]; prerequisites?: string[] }
  completionStandard: string
  estimatedMinutes: number
  priority: number
  position: number
  learningMode: RoadmapLearningMode
  caseId: string | null
  status: RoadmapNodeStatus
  progressSource: string
  completedAt: string | null
  verifiedAt: string | null
  progressRevision: number
  childCount: number
}

export interface Roadmap {
  id: string
  learnerId: string
  templateKey: PlanningTemplateKey
  goal: string
  status: RoadmapStatus
  revision: number
  inputSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt: string
  progress: { total: number; completed: number; verified: number; available: number }
}

export interface RoadmapDraft extends Roadmap {
  planningSessionId: string
  planningSessionRevision: number
  diff: Array<{ key: string; label: string; before: string | null; after: string }>
  nodes: RoadmapNode[]
}

export interface RoadmapNodePage {
  roadmapId: string
  parentId: string | null
  depth: number
  nodes: RoadmapNode[]
}
