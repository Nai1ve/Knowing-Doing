export type PageKey = 'overview' | 'route' | 'lesson' | 'notes' | 'review' | 'profile' | 'settings'

export type EventType = 'reference' | 'question' | 'error' | 'observation' | 'evidence'

export interface LearningPlan {
  id: string
  title: string
  technology: string
  goal: string
  week: number
  totalWeeks: number
  progress: number
  completedUnits: number
  totalUnits: number
  weeklyMinutes: number
  currentNodeId: string
  startedAt: string
  dueAt: string
}

export interface Milestone {
  id: string
  index: string
  title: string
  status: 'completed' | 'current' | 'upcoming'
  summary: string
  progress: string
  nodes: LearningNode[]
}

export interface LearningNode {
  id: string
  title: string
  status: 'completed' | 'current' | 'upcoming'
  duration: string
}

export interface LessonStep {
  id: string
  label: string
  title: string
  description: string
}

export interface PinnedReference {
  id: string
  title: string
  body: string
  source: string
}

export interface PracticeEvent {
  id: string
  type: EventType
  title: string
  body: string
  source: string
  createdAt: string
}

export interface TutorMessage {
  id: string
  role: 'user' | 'assistant' | 'source'
  content: string
  source?: string
  pinned?: boolean
}

export interface LessonContext {
  id: string
  title: string
  description: string
  question: string
  code: string
  steps: LessonStep[]
}

export interface OAuthConnection {
  provider: 'zhihu' | 'model'
  status: 'connected' | 'disconnected' | 'pending'
  account?: string
  scopes: string[]
}

export interface UserProfile {
  name: string
  role: string
  background: string
  signals: string[]
}
