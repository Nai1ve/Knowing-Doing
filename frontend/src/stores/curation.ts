import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getWritingCurationCluster, getWritingCurationOverview, replayWritingCuration, updateWritingCuration } from '@/api/productService'
import type { ProductWritingCluster, ProductWritingClusterDetail, ProductWritingClusterOverview } from '@/types/product'

export const useCurationStore = defineStore('writingCuration', () => {
  const runId = ref<string | null>(null)
  const overview = ref<ProductWritingClusterOverview | null>(null)
  const detail = ref<ProductWritingClusterDetail | null>(null)
  const activeClusterId = ref<string | null>(null)
  const filter = ref('key')
  const loading = ref(false)
  const detailLoading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const acceptedCount = computed(() => overview.value?.acceptedCount ?? 0)

  async function initialize(id: string) {
    if (runId.value === id && overview.value) return
    runId.value = id; loading.value = true; error.value = null; overview.value = null; detail.value = null; activeClusterId.value = null; filter.value = 'key'
    try { overview.value = await getWritingCurationOverview(id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '证据地图加载失败' } finally { loading.value = false }
  }

  async function selectCluster(clusterId: string, nextFilter = 'key') {
    if (!runId.value) return
    activeClusterId.value = clusterId; filter.value = nextFilter; detailLoading.value = true; error.value = null
    try { detail.value = await getWritingCurationCluster(runId.value, clusterId, nextFilter) } catch (cause) { error.value = cause instanceof Error ? cause.message : '证据详情加载失败' } finally { detailLoading.value = false }
  }

  async function setFilter(nextFilter: string) {
    filter.value = nextFilter
    if (activeClusterId.value) await selectCluster(activeClusterId.value, nextFilter)
  }

  async function loadMore() {
    if (!runId.value || !activeClusterId.value || !detail.value?.nextCursor || detailLoading.value) return
    detailLoading.value = true
    try {
      const next = await getWritingCurationCluster(runId.value, activeClusterId.value, filter.value, detail.value.nextCursor)
      detail.value = { ...next, members: [...detail.value.members, ...next.members] }
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '更多证据加载失败' } finally { detailLoading.value = false }
  }

  async function setStatus(cluster: ProductWritingCluster, status: ProductWritingCluster['status']) {
    if (!runId.value || saving.value) return
    saving.value = true; error.value = null
    try {
      const updated = await updateWritingCuration(runId.value, cluster.id, cluster.revision, status)
      if (overview.value) {
        overview.value.clusters = overview.value.clusters.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
        overview.value.acceptedCount = overview.value.clusters.filter((item) => item.status === 'accepted').length
        overview.value.requiredAccepted = overview.value.clusters.filter((item) => item.status === 'accepted' && ['problem', 'evidence', 'solution'].includes(item.clusterKey)).map((item) => item.clusterKey)
        overview.value.canGenerateOutline = ['problem', 'evidence', 'solution'].every((key) => overview.value!.requiredAccepted.includes(key))
      }
      if (detail.value?.cluster.id === updated.id) detail.value.cluster = { ...detail.value.cluster, ...updated }
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '聚类状态保存失败' } finally { saving.value = false }
  }

  async function replay() {
    if (!runId.value || loading.value) return
    loading.value = true; error.value = null
    try { overview.value = await replayWritingCuration(runId.value); detail.value = null; activeClusterId.value = null; filter.value = 'key' } catch (cause) { error.value = cause instanceof Error ? cause.message : '实践记录整理失败' } finally { loading.value = false }
  }

  const refresh = replay

  return { runId, overview, detail, activeClusterId, filter, loading, detailLoading, saving, error, acceptedCount, initialize, selectCluster, setFilter, loadMore, setStatus, replay, refresh }
})
