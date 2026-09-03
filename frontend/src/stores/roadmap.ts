import { defineStore } from 'pinia'
import { ref } from 'vue'
import { completeRoadmapNode, confirmRoadmap, getCurrentRoadmap, getRoadmapDraft, getRoadmapNodes } from '@/api/planningService'
import type { CurrentRoadmapResponse, RoadmapDraft, RoadmapNode } from '@/types/product'

export const useRoadmapStore = defineStore('roadmap', () => {
  const current = ref<CurrentRoadmapResponse | null>(null); const draft = ref<RoadmapDraft | null>(null); const children = ref<Record<string, RoadmapNode[]>>({}); const loading = ref(false); const error = ref<string | null>(null)
  async function loadCurrent() { loading.value = true; error.value = null; try { const next = await getCurrentRoadmap(); if (current.value?.roadmap?.id !== next.roadmap?.id) children.value = {}; current.value = next; return current.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线图加载失败'; throw cause } finally { loading.value = false } }
  async function loadDraft(id: string) { loading.value = true; error.value = null; try { draft.value = await getRoadmapDraft(id); return draft.value } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线草案加载失败'; throw cause } finally { loading.value = false } }
  async function loadChildren(roadmapId: string, parentId: string | null) { const key = parentId ?? 'root'; if (children.value[key]) return children.value[key]; try { const page = await getRoadmapNodes(roadmapId, parentId); children.value[key] = page.nodes; return page.nodes } catch (cause) { error.value = cause instanceof Error ? cause.message : '路线分支加载失败'; throw cause } }
  async function confirm(id: string, revision: number) { loading.value = true; try { const result = await confirmRoadmap(id, revision); await loadCurrent(); return result } finally { loading.value = false } }
  async function complete(roadmapId: string, node: RoadmapNode, status: 'completed' | 'self_reported' = 'completed') { const updated = await completeRoadmapNode(roadmapId, node.id, node.progressRevision, status); const list = children.value[node.parentId ?? 'root']; if (list) { const found = list.findIndex((item) => item.id === node.id); if (found >= 0) list[found] = updated } return updated }
  return { current, draft, children, loading, error, loadCurrent, loadDraft, loadChildren, confirm, complete }
})
