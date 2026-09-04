import { defineStore } from 'pinia'
import { ref } from 'vue'
import { addPlanningTurn, adjustPlanning, createPlanningSession, getPlanningSession, uploadPlanningResume } from '@/api/planningService'
import type { PlanningSession, RoadmapDraft } from '@/types/product'

export const usePlanningConversationStore = defineStore('planningConversation', () => {
  const session = ref<PlanningSession | null>(null); const draft = ref<RoadmapDraft | null>(null); const loading = ref(false); const error = ref<string | null>(null)
  async function start(goal?: string, resume?: File) { loading.value = true; error.value = null; try { session.value = await createPlanningSession(goal); if (resume) session.value.resume = await uploadPlanningResume(session.value.id, resume); return session.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '规划对话创建失败'; throw cause } finally { loading.value = false } }
  async function load(id: string) { loading.value = true; error.value = null; try { session.value = await getPlanningSession(id); return session.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '规划对话加载失败'; throw cause } finally { loading.value = false } }
  async function answer(input: { stepKey: string; answer: string; structuredValue?: unknown }) { if (!session.value) throw new Error('规划对话尚未加载'); loading.value = true; error.value = null; try { session.value = await addPlanningTurn(session.value.id, { revision: session.value.revision, ...input }); return session.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '回答保存失败'; throw cause } finally { loading.value = false } }
  async function adjust(input: { weeklyMinutes?: number; priorityDomain?: string; masteredNodeKeys?: string[] }) { if (!session.value) throw new Error('规划对话尚未加载'); loading.value = true; error.value = null; try { draft.value = await adjustPlanning(session.value.id, { revision: session.value.revision, ...input }); session.value = await getPlanningSession(session.value.id); return draft.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线调整失败'; throw cause } finally { loading.value = false } }
  async function uploadResume(file: File) { if (!session.value) throw new Error('规划对话尚未加载'); loading.value = true; error.value = null; try { const resume = await uploadPlanningResume(session.value.id, file); session.value.resume = resume; return resume } catch (cause) { error.value = cause instanceof Error ? cause.message : '简历上传失败'; throw cause } finally { loading.value = false } }
  return { session, draft, loading, error, start, load, answer, adjust, uploadResume }
})
