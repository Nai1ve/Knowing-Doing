export type PracticeCardMode = 'knowledge_only' | 'mixed'
export type PracticeActivityType = 'concept' | 'knowledge_check' | 'scenario_reasoning' | 'runtime_practice' | 'reflection'
export type GymStage = 'orienting' | 'checking' | 'preparing_runtime' | 'practicing' | 'reflecting' | 'completed'
export type GymOutcome = 'verified' | 'completed_with_gaps' | 'incomplete'

/** Public activity data intentionally excludes answer keys and rubrics. */
export interface PracticeActivity {
  id: string
  type: PracticeActivityType
  title: string
  prompt: string
  context?: string
  options?: Array<{ value: string; label: string }>
  required?: boolean
}

export interface PracticeCard {
  id: string
  planUnitId: string
  mode: PracticeCardMode
  title: string
  objective: string
  summary: string
  activities: PracticeActivity[]
  sourceReferences: PublicSourceReference[]
  completionPolicy: { requiredActivityTypes: PracticeActivityType[]; maxAttemptsPerActivity: number }
  status: 'generating' | 'ready' | 'failed' | 'superseded'
  version: number
  createdAt: string
  updatedAt: string
  isFixture?: boolean
}

export interface PublicSourceReference { id: string; title: string; author: string | null; canonicalUrl: string; sourceType?: string | null; summary?: string | null; sourceAnchor?: string | null; selectedReason?: string | null; fetchedAt?: string | null }

export interface PracticeCardEvent {
  id: string
  sequence: number
  type: 'created' | 'updated' | 'retry_started' | 'ready' | 'failed'
  summary: string
  createdAt: string
}

export interface PracticeCardEventsPage { events: PracticeCardEvent[]; nextSequence: number }

export interface GymActivityState {
  activityId: string
  answer: string | string[] | null
  status: 'unanswered' | 'saved' | 'correct' | 'incorrect' | 'completed'
  attempts: number
  feedback?: string
}

export interface GymSession {
  id: string
  practiceCardId: string
  stage: GymStage
  outcome: GymOutcome | null
  activities: PracticeActivity[]
  activityStates: GymActivityState[]
  currentActivityId: string | null
  attemptsRemaining: number
  runtime: {
    status: 'not_started' | 'starting' | 'ready' | 'active' | 'completed'
    label?: string
    kind?: 'mysql_lab' | 'docker_workspace'
    practiceRunId?: string
    workspaceRunId?: string | null
  } | null
  reflection: string | null
  progress: { completed: number; total: number }
  createdAt: string
  updatedAt: string
}

export interface GymEvent {
  id: string
  sequence: number
  type: 'stage' | 'answer_saved' | 'answer_submitted' | 'runtime' | 'reflection' | 'completed'
  summary: string
  createdAt: string
}

export interface GymEventsPage { events: GymEvent[]; nextSequence: number }

export interface AnswerSubmission {
  session: GymSession
  activityId: string
  result: 'correct' | 'incorrect' | 'incomplete'
  feedback: string
  attemptsRemaining: number
  nextActivityId: string | null
}

export interface CompleteGymResponse { session: GymSession; outcome: GymOutcome }

export interface SourceSync {
  id: string
  provider: 'zhihu'
  status: 'queued' | 'running' | 'completed' | 'failed'
  importedCount: number
  updatedCount: number
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface SourceCollection { id: string; name: string; itemCount: number; updatedAt: string }
export interface SourceItem {
  id: string
  collectionId: string | null
  title: string
  excerpt: string
  author: string | null
  url: string
  saved: boolean
  publishedAt?: string | null
  tags: string[]
}
export interface SourceSearchResult { items: SourceItem[]; nextCursor: string | null }
