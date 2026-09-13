import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { completeGymSession, createGymSession, ensurePracticeCard, getGymEvents, getGymSession, getPracticeCardForPlanUnit, retryPracticeCard, saveGymActivityAnswer, startGymRuntime, submitGymActivityAnswer } from '@/api/learningExperienceService'
import type { AnswerSubmission, GymEvent, GymSession, PracticeCard, PracticeCardMode } from '@/types/learningExperience'
import { createClientId } from '@/utils/client-id'

export const useLearningGymStore = defineStore('learning-gym', () => {
  const card = ref<PracticeCard | null>(null)
  const session = ref<GymSession | null>(null)
  const events = ref<GymEvent[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const submitting = ref(false)
  const completing = ref(false)
  const error = ref<string | null>(null)
  const cardError = ref<string | null>(null)
  const activeSessionKey = 'zhixing.unified-gym.sessions'
  const progress = computed(() => session.value?.progress ?? { completed: 0, total: card.value?.activities.length ?? 0 })
  const currentActivity = computed(() => session.value?.activities.find((activity) => activity.id === session.value?.currentActivityId) ?? session.value?.activities[0] ?? null)
  const stateFor = (activityId: string) => session.value?.activityStates.find((state) => state.activityId === activityId)
  const actionKeys = new Map<string, string>()
  const keyFor = (action: string) => { const existing = actionKeys.get(action); if (existing) return existing; const key = createClientId(); actionKeys.set(action, key); return key }
  const releaseKey = (action: string) => actionKeys.delete(action)

  async function ensureCard(planUnitId: string, mode: PracticeCardMode = 'mixed') {
    loading.value = true; cardError.value = null; error.value = null
    try { card.value = await ensurePracticeCard(planUnitId, mode); return card.value }
    catch (cause) { cardError.value = cause instanceof Error ? cause.message : 'Practice Card 加载失败'; return null }
    finally { loading.value = false }
  }

  async function open(planUnitId: string, mode: PracticeCardMode = 'mixed') {
    let nextCard: PracticeCard | null = null
    try { nextCard = await getPracticeCardForPlanUnit(planUnitId) } catch { nextCard = await ensureCard(planUnitId, mode) }
    if (!nextCard) return
    const storedSessions = typeof window !== 'undefined' ? JSON.parse(window.localStorage.getItem(activeSessionKey) ?? '{}') as Record<string, string> : {}
    const stored = storedSessions[nextCard.id]
    if (card.value?.id !== nextCard.id) events.value = []
    card.value = nextCard
    loading.value = true
    try {
      if (stored) {
        const restored = await getGymSession(stored)
        if (restored.practiceCardId === nextCard.id && restored.stage !== 'completed') session.value = restored
      }
      if (session.value?.practiceCardId !== nextCard.id) session.value = null
      if (!session.value) {
        session.value = await createGymSession(nextCard.id, keyFor(`session:${nextCard.id}`))
        if (typeof window !== 'undefined') window.localStorage.setItem(activeSessionKey, JSON.stringify({ ...storedSessions, [nextCard.id]: session.value.id }))
      }
      await refreshEvents()
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym Session 加载失败' }
    finally { loading.value = false }
  }

  async function refreshEvents() {
    if (!session.value) return
    try { const page = await getGymEvents(session.value.id, events.value.at(-1)?.sequence ?? 0); const known = new Set(events.value.map((event) => event.sequence)); events.value = [...events.value, ...page.events.filter((event) => !known.has(event.sequence))].sort((a, b) => a.sequence - b.sequence) } catch { /* Events are optional for fixture mode. */ }
  }
  async function retryCard() { if (!card.value) return; loading.value = true; try { card.value = await retryPracticeCard(card.value.id, keyFor(`retry:${card.value.id}`)) } catch (cause) { cardError.value = cause instanceof Error ? cause.message : 'Practice Card 重试失败' } finally { loading.value = false } }
  async function saveAnswer(activityId: string, answer: string | string[]) {
    if (!session.value) return
    saving.value = true; error.value = null
    try { const action=`save:${session.value.id}:${activityId}`; session.value = await saveGymActivityAnswer(session.value.id, activityId, answer, keyFor(action)); releaseKey(action) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '答案保存失败' }
    finally { saving.value = false }
  }
  async function submitAnswer(activityId: string): Promise<AnswerSubmission | null> {
    if (!session.value) return null
    submitting.value = true; error.value = null
    try { const action=`submit:${session.value.id}:${activityId}`; const result = await submitGymActivityAnswer(session.value.id, activityId, keyFor(action)); session.value = result.session; releaseKey(action); return result }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '答案提交失败'; return null }
    finally { submitting.value = false }
  }
  async function startRuntime() { if (!session.value) return; saving.value = true; try { const action=`runtime-start:${session.value.id}`; session.value = await startGymRuntime(session.value.id, keyFor(action)); releaseKey(action) } catch (cause) { error.value = cause instanceof Error ? cause.message : '运行时启动失败' } finally { saving.value = false } }
  async function refreshSession() { if (!session.value) return; try { session.value = await getGymSession(session.value.id); await refreshEvents() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 状态刷新失败' } }
  async function complete(reflection: string) { if (!session.value) return; completing.value = true; error.value = null; try { const cardId = session.value.practiceCardId; const result = await completeGymSession(session.value.id, reflection, keyFor(`complete:${session.value.id}`)); session.value = result.session; if (typeof window !== 'undefined') { const stored = JSON.parse(window.localStorage.getItem(activeSessionKey) ?? '{}') as Record<string, string>; delete stored[cardId]; window.localStorage.setItem(activeSessionKey, JSON.stringify(stored)) } } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Gym 完成失败' } finally { completing.value = false } }
  function reset() { card.value = null; session.value = null; events.value = []; error.value = null; cardError.value = null }

  return { card, session, events, loading, saving, submitting, completing, error, cardError, progress, currentActivity, stateFor, ensureCard, open, refreshEvents, refreshSession, retryCard, saveAnswer, submitAnswer, startRuntime, complete, reset }
})
