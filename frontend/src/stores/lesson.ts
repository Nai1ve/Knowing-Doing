import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { completeLesson, getLesson } from '@/api/learningService'
import { askTutor, getTutorThread } from '@/api/tutorService'
import { createPracticeEvent, getPracticeEvents } from '@/api/notesService'
import type { LessonContext, PinnedReference, PracticeEvent, TutorMessage } from '@/types/domain'

export const useLessonStore = defineStore('lesson', () => {
  const lesson = ref<LessonContext | null>(null)
  const messages = ref<TutorMessage[]>([])
  const pinned = ref<PinnedReference[]>([])
  const events = ref<PracticeEvent[]>([])
  const activeStepId = ref('understand')
  const loading = ref(false)
  const tutorLoading = ref(false)
  const error = ref<string | null>(null)
  const evidence = ref('')
  const completed = ref(false)

  const activeStep = computed(() => lesson.value?.steps.find((step) => step.id === activeStepId.value))

  async function load(lessonId: string, planId: string) {
    if (lesson.value?.id === lessonId) return
    loading.value = true
    error.value = null
    try {
      const [lessonData, thread, practiceEvents] = await Promise.all([getLesson(lessonId), getTutorThread(lessonId), getPracticeEvents(planId)])
      lesson.value = lessonData
      messages.value = thread
      events.value = practiceEvents
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '学习单元加载失败'
    } finally {
      loading.value = false
    }
  }

  function setStep(stepId: string) { activeStepId.value = stepId }

  function pin(reference: PinnedReference) {
    if (!pinned.value.some((item) => item.id === reference.id)) pinned.value.push(reference)
  }

  function unpin(id: string) { pinned.value = pinned.value.filter((item) => item.id !== id) }

  async function addEvent(planId: string, event: Omit<PracticeEvent, 'id' | 'createdAt'>) {
    const created = await createPracticeEvent(planId, event)
    events.value.push(created)
  }

  async function ask(planId: string, question: string) {
    if (!question.trim() || !lesson.value) return
    const userMessage: TutorMessage = { id: `user-${Date.now()}`, role: 'user', content: question }
    messages.value.push(userMessage)
    await addEvent(planId, { type: 'question', title: question, body: '这条追问来自当前学习中的 Tutor Agent 对话。', source: 'Tutor Agent' })
    tutorLoading.value = true
    try {
      const answer = await askTutor(lesson.value.id, question)
      messages.value.push(answer)
    } finally {
      tutorLoading.value = false
    }
  }

  async function finish() {
    if (!lesson.value) return
    await completeLesson(lesson.value.id, evidence.value)
    completed.value = true
  }

  return { lesson, messages, pinned, events, activeStepId, activeStep, loading, tutorLoading, error, evidence, completed, load, setStep, pin, unpin, addEvent, ask, finish }
})
