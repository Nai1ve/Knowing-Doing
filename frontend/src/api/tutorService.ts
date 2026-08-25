import { mockTutorMessages } from '@/data/mock'
import type { TutorMessage } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getTutorThread(lessonId: string): Promise<TutorMessage[]> {
  if (useMockApi) return structuredClone(mockTutorMessages)
  return apiClient.request<TutorMessage[]>(`/learning/lessons/${lessonId}/tutor-thread`)
}

export async function askTutor(lessonId: string, question: string): Promise<TutorMessage> {
  if (useMockApi) return { id: `assistant-${Date.now()}`, role: 'assistant', content: question.includes('replicas') ? '先把问题拆成三层：期望副本数、当前副本数、Ready 状态；之后再用 Events 判断哪个环节没有达到期望。' : '继续围绕当前 YAML 追问，我会把你的问题连接到本节点的概念和知乎摘要。' }
  return apiClient.request<TutorMessage>(`/learning/lessons/${lessonId}/tutor`, { method: 'POST', body: JSON.stringify({ question }) })
}
