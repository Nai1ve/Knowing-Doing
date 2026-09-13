import { ApiError, apiClient } from './client'
import { createClientId } from '@/utils/client-id'
import type { PracticeCard, PracticeCardEventsPage, GymSession, GymEventsPage, AnswerSubmission, CompleteGymResponse, SourceSync, SourceCollection, SourceSearchResult, PracticeActivityType } from '@/types/learningExperience'

function encode(value: string) { return encodeURIComponent(value) }
function fixtureAllowed(error: unknown) { return import.meta.env.VITE_ENABLE_LEARNING_FIXTURES === 'true' && error instanceof ApiError && [404, 501, 503].includes(error.status) }
function request<T>(path: string, init: RequestInit = {}) { return apiClient.request<T>(path, init) }
function write(method: string, key: string, body?: unknown): RequestInit { return { method, headers: { 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) } }

const now = () => new Date().toISOString()
const fixtureCards = new Map<string, PracticeCard>()
const fixtureSessions = new Map<string, GymSession>()
function fixtureCard(planUnitId: string, mode: 'knowledge_only' | 'mixed' = 'mixed'): PracticeCard {
  const id = `fixture-card-${planUnitId}`
  const activities = [
    { id: `${id}-concept`, type: 'concept' as const, title: '先建立判断框架', prompt: '用自己的话说明：这项能力解决什么问题？它和你已经熟悉的做法有什么不同？', required: true },
    { id: `${id}-check`, type: 'knowledge_check' as const, title: '知识检查', prompt: '选择最符合当前场景的判断。', options: [{ value: 'observe', label: '先观察证据，再决定下一步' }, { value: 'guess', label: '先凭经验直接改动生产配置' }], required: true },
    ...(mode === 'mixed' ? [{ id: `${id}-scenario`, type: 'scenario_reasoning' as const, title: '场景推理', prompt: '面对一个异常现象，你会收集哪两条证据来验证假设？', context: '请把证据、判断和下一步动作连成一条链。', required: true }, { id: `${id}-runtime`, type: 'runtime_practice' as const, title: '进入运行时实践', prompt: '准备好后启动受限实践环境，完成一次可验证操作。', required: true }] : []),
    { id: `${id}-reflection`, type: 'reflection' as const, title: '回看与迁移', prompt: '这次练习改变了你哪一个判断？下一次遇到相似问题，你会先做什么？', required: true },
  ]
  const requiredActivityTypes: PracticeActivityType[] = ['concept', 'knowledge_check', ...(mode === 'mixed' ? ['runtime_practice' as const] : []), 'reflection']
  const card = { id, planUnitId, mode, title: 'Practice Card · 从知识到判断', objective: '把知识点变成可复述、可检查、可迁移的行动判断。', summary: '本卡只展示练习材料，不把答案或评分规则暴露给客户端。', activities, sourceReferences: [], completionPolicy: { requiredActivityTypes, maxAttemptsPerActivity: 2 }, status: 'ready' as const, version: 1, createdAt: now(), updatedAt: now(), isFixture: true }
  fixtureCards.set(id, card)
  return card
}
function fixtureSession(card: PracticeCard): GymSession { return { id: `fixture-session-${card.id}`, practiceCardId: card.id, stage: 'orienting', outcome: null, activities: card.activities, activityStates: card.activities.map((activity) => ({ activityId: activity.id, answer: null, status: 'unanswered', attempts: 0 })), currentActivityId: card.activities[0]?.id ?? null, attemptsRemaining: 2, runtime: card.activities.some((activity) => activity.type === 'runtime_practice') ? { status: 'not_started' } : null, reflection: null, progress: { completed: 0, total: card.activities.length }, createdAt: now(), updatedAt: now() } }

export async function ensurePracticeCard(planUnitId: string, mode: PracticeCard['mode'], idempotencyKey = createClientId()): Promise<PracticeCard> {
  try { return await request(`/product/plan-units/${encode(planUnitId)}/practice-card`, write('POST', idempotencyKey, {})) }
  catch (error) { if (fixtureAllowed(error)) return fixtureCard(planUnitId, mode); throw error }
}
export async function getPracticeCardForPlanUnit(planUnitId: string): Promise<PracticeCard> {
  try { return await request(`/product/plan-units/${encode(planUnitId)}/practice-card`) }
  catch (error) { if (fixtureAllowed(error)) { const card = fixtureCards.get(`fixture-card-${planUnitId}`); if (card) return card }; throw error }
}
export async function getPracticeCard(id: string): Promise<PracticeCard> {
  try { return await request(`/product/practice-cards/${encode(id)}`) }
  catch (error) { if (fixtureAllowed(error)) { const card = fixtureCards.get(id); if (card) return card; throw error }; throw error }
}
export async function retryPracticeCard(id: string, idempotencyKey = createClientId()): Promise<PracticeCard> {
  try { return await request(`/product/practice-cards/${encode(id)}/retry`, write('POST', idempotencyKey)) }
  catch (error) { if (fixtureAllowed(error)) return getPracticeCard(id); throw error }
}
export async function getPracticeCardEvents(id: string, afterSequence = 0): Promise<PracticeCardEventsPage> {
  try { return await request(`/product/practice-cards/${encode(id)}/events?afterSequence=${afterSequence}`) }
  catch (error) { if (fixtureAllowed(error)) return { events: [], nextSequence: afterSequence }; throw error }
}
export async function createGymSession(cardId: string, idempotencyKey = createClientId()): Promise<GymSession> {
  try { return await request(`/product/practice-cards/${encode(cardId)}/gym-sessions`, write('POST', idempotencyKey)) }
  catch (error) { if (fixtureAllowed(error)) { const session = fixtureSession(await getPracticeCard(cardId)); persistFixtureSession(session); return session }; throw error }
}
export async function getGymSession(id: string): Promise<GymSession> {
  try { return await request(`/product/gym-sessions/${encode(id)}`) }
  catch (error) { if (fixtureAllowed(error)) { const session = fixtureSessions.get(id) ?? readFixtureSession(id); if (session) return session; throw error }; throw error }
}
export async function getGymEvents(id: string, afterSequence = 0): Promise<GymEventsPage> {
  try { return await request(`/product/gym-sessions/${encode(id)}/events?afterSequence=${afterSequence}`) }
  catch (error) { if (fixtureAllowed(error)) return { events: [], nextSequence: afterSequence }; throw error }
}
export async function saveGymActivityAnswer(id: string, activityId: string, answer: string | string[], idempotencyKey = createClientId()): Promise<GymSession> {
  try { return await request(`/product/gym-sessions/${encode(id)}/activities/${encode(activityId)}/answer`, write('PUT', idempotencyKey, { answer })) }
  catch (error) { if (fixtureAllowed(error)) return localAnswer(id, activityId, answer); throw error }
}
export async function submitGymActivityAnswer(id: string, activityId: string, idempotencyKey = createClientId()): Promise<AnswerSubmission> {
  try { return await request(`/product/gym-sessions/${encode(id)}/activities/${encode(activityId)}/submit`, write('POST', idempotencyKey)) }
  catch (error) { if (fixtureAllowed(error)) return localSubmit(id, activityId); throw error }
}
export async function startGymRuntime(id: string, idempotencyKey = createClientId()): Promise<GymSession> {
  try { return await request(`/product/gym-sessions/${encode(id)}/runtime/start`, write('POST', idempotencyKey)) }
  catch (error) { if (fixtureAllowed(error)) return localRuntime(id, 'active'); throw error }
}
export async function completeGymSession(id: string, reflection: string, idempotencyKey = createClientId()): Promise<CompleteGymResponse> {
  try { return await request(`/product/gym-sessions/${encode(id)}/complete`, write('POST', idempotencyKey, { reflection })) }
  catch (error) { if (fixtureAllowed(error)) { const session = fixtureSessionFromId(id); session.stage = 'completed'; session.outcome = reflection.trim() ? 'completed_with_gaps' : 'incomplete'; session.reflection = reflection; persistFixtureSession(session); return { session, outcome: session.outcome } } throw error }
}

// Fixture helpers keep local development usable without adding backend-only knowledge.
function persistFixtureSession(session: GymSession) { fixtureSessions.set(session.id, session); if (typeof window !== 'undefined') window.localStorage.setItem(`zhixing.fixture.gym.${session.id}`, JSON.stringify(session)); return session }
function readFixtureSession(id: string) { if (typeof window === 'undefined') return undefined; const raw = window.localStorage.getItem(`zhixing.fixture.gym.${id}`); if (!raw) return undefined; try { const session = JSON.parse(raw) as GymSession; fixtureSessions.set(id, session); return session } catch { return undefined } }
function localAnswer(id: string, activityId: string, answer: string | string[]) { const session = fixtureSessionFromId(id); const state = session.activityStates.find((item) => item.activityId === activityId); if (state) { state.answer = answer; state.status = 'saved' } return persistFixtureSession(session) }
function localSubmit(id: string, activityId: string): AnswerSubmission { const session = fixtureSessionFromId(id); const state = session.activityStates.find((item) => item.activityId === activityId); const activity = session.activities.find((item) => item.id === activityId); const answer = state?.answer; const nonEmpty = Array.isArray(answer) ? answer.length > 0 : Boolean(answer?.trim()); const correct = activity?.type === 'knowledge_check' ? answer === 'observe' : nonEmpty; if (state) { state.attempts += 1; state.status = correct ? 'correct' : 'incorrect'; state.feedback = correct ? '判断记录完成，可以继续。' : '这次回答还不足以支撑判断，请补充证据后继续。' } if (correct) session.progress.completed = session.activityStates.filter((item) => ['correct', 'completed'].includes(item.status)).length; session.currentActivityId = session.activities.find((activityItem) => !['correct', 'completed'].includes(session.activityStates.find((stateItem) => stateItem.activityId === activityItem.id)?.status ?? 'unanswered'))?.id ?? null; persistFixtureSession(session); return { session, activityId, result: correct ? 'correct' : 'incorrect', feedback: state?.feedback ?? '', attemptsRemaining: Math.max(0, 2 - (state?.attempts ?? 0)), nextActivityId: session.currentActivityId } }
function localRuntime(id: string, status: 'active') { const session = fixtureSessionFromId(id); session.stage = 'practicing'; session.runtime = { status }; return persistFixtureSession(session) }
function fixtureSessionFromId(id: string) { const existing = fixtureSessions.get(id) ?? readFixtureSession(id); if (existing) return existing; const card = [...fixtureCards.values()].find((item) => `fixture-session-${item.id}` === id); if (!card) throw new ApiError(404, 'fixture Gym Session 不存在'); const session = fixtureSession(card); session.id = id; return persistFixtureSession(session) }

export async function startSourceSync(idempotencyKey = createClientId()): Promise<SourceSync> { return request('/product/source-syncs', write('POST', idempotencyKey, { provider: 'zhihu' })) }
export async function getSourceSyncs(): Promise<SourceSync[]> { return request('/product/source-syncs') }
export async function getSourceSync(id: string): Promise<SourceSync> { return request(`/product/source-syncs/${encode(id)}`) }
export async function getSourceCollections(): Promise<SourceCollection[]> { return request('/product/source-collections') }
export async function getSourceItems(collectionId?: string): Promise<SourceSearchResult> { return request(`/product/source-items${collectionId ? `?collectionId=${encode(collectionId)}` : ''}`) }
export async function searchSourceItems(query: string): Promise<SourceSearchResult> { return request(`/product/source-search?q=${encode(query)}`) }
export async function saveSourceItem(id: string, idempotencyKey = createClientId()): Promise<SourceItemResponse> { return request(`/product/source-items/${encode(id)}/save`, write('POST', idempotencyKey)) }
export interface SourceItemResponse { id: string; saved: boolean }
