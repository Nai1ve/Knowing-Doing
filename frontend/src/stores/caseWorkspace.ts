import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createCaseRequest, endWorkspace, executeWorkspace, getCaseGenerationJob, getLearningCase, getWorkspaceRun, getWorkspaceTutorHistory, resetWorkspace, retryCaseGeneration, recheckWorkspaceCompletion, saveWorkspaceFile, startCasePractice } from '@/api/caseWorkspaceService'
import { createProductPin, retryProductTutor, streamProductTutor } from '@/api/productService'
import { createClientId } from '@/utils/client-id'
import type { ProductCaseInput, ProductCaseGenerationJob, ProductLearningCase, ProductPracticePin, ProductSnapshot, ProductTutorMessage, ProductTutorResponse, ProductTutorSource, ProductTutorStreamEvent, ProductWorkspaceSummary } from '@/types/product'

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

export const useCaseWorkspaceStore = defineStore('caseWorkspace', () => {
  const learningCase = ref<ProductLearningCase | null>(null)
  const job = ref<ProductCaseGenerationJob | null>(null)
  const workspace = ref<ProductWorkspaceSummary | null>(null)
  const selectedPath = ref<string | null>(null)
  const editorContent = ref('')
  const saveState = ref<SaveState>('idle')
  const loading = ref(false)
  const working = ref(false)
  const error = ref<string | null>(null)
  const tutorMessages = ref<ProductTutorMessage[]>([])
  const tutorSources = ref<ProductTutorSource[]>([])
  const tutorLastResponse = ref<ProductTutorResponse | null>(null)
  const tutorFailure = ref<{ invocationId: string; code: string; message: string; retryable: boolean } | null>(null)
  const tutorLoading = ref(false)
  const tutorPins = ref<ProductPracticePin[]>([])
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const selectedFile = computed(() => workspace.value?.files.find((file) => file.path === selectedPath.value) ?? null)
  const isGenerating = computed(() => Boolean(job.value && !['succeeded', 'failed', 'interrupted'].includes(job.value.status)))

  function stopPolling() { if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null } }
  function stopSaving() { if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null } }
  function resetCase() {
    stopPolling(); stopSaving()
    learningCase.value = null; job.value = null; workspace.value = null; selectedPath.value = null; editorContent.value = ''; saveState.value = 'idle'; loading.value = false; working.value = false; error.value = null; tutorMessages.value = []; tutorSources.value = []; tutorLastResponse.value = null; tutorFailure.value = null; tutorPins.value = []
  }
  function hydrateCase(value: ProductLearningCase) { learningCase.value = value }
  function hydrateWorkspace(value: ProductWorkspaceSummary) {
    workspace.value = value
    if (!selectedPath.value || !value.files.some((file) => file.path === selectedPath.value)) selectedPath.value = value.files[0]?.path ?? null
    if (selectedPath.value) editorContent.value = value.files.find((file) => file.path === selectedPath.value)?.content ?? ''
  }

  function hydrateTutor(data: ProductSnapshot) {
    tutorPins.value = data.pins
    const nextMessages: ProductTutorMessage[] = []
    const turnByUser = new Map(data.tutorTurns.map((turn) => [turn.userArtifactId, turn]))
    for (const artifact of data.artifacts.filter((item) => item.kind === 'user_message').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      nextMessages.push({ id: artifact.id, role: 'user', content: artifact.content })
      const turn = turnByUser.get(artifact.id)
      const assistant = turn?.assistantArtifactId ? data.artifacts.find((item) => item.id === turn.assistantArtifactId) : undefined
      if (assistant) nextMessages.push({ id: assistant.id, role: 'assistant', content: assistant.content, source: `知行 AI · ${turn?.sourceStatus ?? 'unknown'}` })
    }
    tutorMessages.value = nextMessages
    const replyEvent = [...data.events].reverse().find((event) => event.type === 'tutor_reply' && typeof event.payload.response === 'string')
    tutorLastResponse.value = replyEvent ? replyEvent.payload as unknown as ProductTutorResponse : null
  }

  function hydrateTutorHistory(data: { messages: ProductTutorMessage[]; pins: ProductPracticePin[]; lastResponse: ProductTutorResponse | null }) {
    tutorMessages.value = data.messages
    tutorPins.value = data.pins
    tutorLastResponse.value = data.lastResponse
  }

  async function loadTutor(workspaceRunId: string) {
    try { hydrateTutorHistory(await getWorkspaceTutorHistory(workspaceRunId)) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Tutor 历史加载失败' }
  }

  async function loadCase(caseId: string) {
    loading.value = true; error.value = null
    try { hydrateCase(await getLearningCase(caseId)) } catch (cause) { error.value = cause instanceof Error ? cause.message : '案例加载失败'; throw cause } finally { loading.value = false }
  }

  async function create(nodeId: string, input: ProductCaseInput, desiredOutcome?: string, difficulty?: 'introductory' | 'applied' | 'advanced') {
    resetCase(); loading.value = true
    try {
      const result = await createCaseRequest(nodeId, input, { desiredOutcome, difficulty, clientRequestId: createClientId() })
      hydrateCase(result.case); job.value = result.job
      if (['failed', 'interrupted'].includes(result.job.status)) error.value = result.job.failureMessage ?? '案例生成失败，请重试。'
      if (!['succeeded', 'failed', 'interrupted'].includes(result.job.status)) schedulePoll(result.job.id)
      return result
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '案例生成请求失败'; throw cause } finally { loading.value = false }
  }

  function schedulePoll(jobId: string) {
    stopPolling()
    pollTimer = setTimeout(async () => {
      try {
        const result = await getCaseGenerationJob(jobId); hydrateCase(result.case); job.value = result.job
        if (['failed', 'interrupted'].includes(result.job.status)) error.value = result.job.failureMessage ?? '案例生成失败，请重试。'
        if (!['succeeded', 'failed', 'interrupted'].includes(result.job.status)) schedulePoll(jobId)
      } catch (cause) { error.value = cause instanceof Error ? cause.message : '案例生成状态获取失败'; pollTimer = setTimeout(() => schedulePoll(jobId), 2000) }
    }, 700)
  }

  async function retry() {
    if (!job.value) return
    loading.value = true; error.value = null
    try { const result = await retryCaseGeneration(job.value.id); hydrateCase(result.case); job.value = result.job; error.value = null; schedulePoll(result.job.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '案例重试失败'; throw cause } finally { loading.value = false }
  }

  async function startPractice() {
    if (!learningCase.value) return null
    working.value = true; error.value = null
    try { const result = await startCasePractice(learningCase.value.id); hydrateWorkspace(result); return result } catch (cause) { error.value = cause instanceof Error ? cause.message : '工作区启动失败'; throw cause } finally { working.value = false }
  }

  async function loadWorkspace(workspaceRunId: string) {
    loading.value = true; error.value = null
    try { const value = await getWorkspaceRun(workspaceRunId); hydrateWorkspace(value); await loadTutor(workspaceRunId) } catch (cause) { error.value = cause instanceof Error ? cause.message : '工作区加载失败'; throw cause } finally { loading.value = false }
  }

  function selectFile(path: string) {
    const file = workspace.value?.files.find((item) => item.path === path)
    if (!file) return
    selectedPath.value = path; editorContent.value = file.content; saveState.value = 'idle'
  }

  function scheduleSave() { stopSaving(); saveTimer = setTimeout(() => { void saveFile() }, 900) }

  async function saveFile() {
    stopSaving()
    const file = selectedFile.value; const currentWorkspace = workspace.value
    if (!file || !currentWorkspace || editorContent.value === file.content) return
    saveState.value = 'saving'; error.value = null
    try { hydrateWorkspace(await saveWorkspaceFile(currentWorkspace.workspace.id, file.path, editorContent.value, file.revision)); saveState.value = 'saved' }
    catch (cause) { saveState.value = cause instanceof Error && 'status' in cause && Number((cause as { status?: unknown }).status) === 409 ? 'conflict' : 'error'; error.value = cause instanceof Error ? cause.message : '文件保存失败' }
  }

  async function execute(command = 'pytest -q') {
    if (!workspace.value) return
    working.value = true; error.value = null
    try { hydrateWorkspace((await executeWorkspace(workspace.value.workspace.id, command)).workspace); if (workspace.value) workspace.value.executions = [...workspace.value.executions] } catch (cause) { error.value = cause instanceof Error ? cause.message : '执行失败' } finally { working.value = false }
  }
  async function recheckCompletion() {
    if (!workspace.value) return
    try { workspace.value.completion = await recheckWorkspaceCompletion(workspace.value.workspace.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '完成状态检查失败' }
  }

  async function reset() { if (!workspace.value) return; working.value = true; error.value = null; try { hydrateWorkspace(await resetWorkspace(workspace.value.workspace.id)); saveState.value = 'saved' } catch (cause) { error.value = cause instanceof Error ? cause.message : '工作区重置失败' } finally { working.value = false } }
  async function end() { if (!workspace.value) return; working.value = true; try { hydrateWorkspace(await endWorkspace(workspace.value.workspace.id)) } catch (cause) { error.value = cause instanceof Error ? cause.message : '工作区结束失败' } finally { working.value = false } }
  function applyTutorEvent(event: ProductTutorStreamEvent) {
    if (event.type === 'sources') { tutorSources.value = event.items; return }
    if (event.type === 'answer_delta') {
      const current = tutorMessages.value.find((message) => message.id === `stream-${event.invocationId}`)
      if (current) current.content += event.delta
      else tutorMessages.value.push({ id: `stream-${event.invocationId}`, role: 'assistant', content: event.delta, source: '知行 AI · 流式回答' })
      return
    }
    if (event.type === 'completed') { tutorLastResponse.value = event.tutor; tutorSources.value = event.sources; tutorFailure.value = null; hydrateTutor(event.snapshot); return }
    if (event.type === 'failed') tutorFailure.value = { invocationId: event.invocationId, code: event.code, message: event.message, retryable: event.retryable }
  }
  async function askTutor(message: string) {
    const practice = workspace.value?.practice
    if (!practice || tutorLoading.value || practice.status === 'resolved') return
    tutorLoading.value = true; tutorFailure.value = null; tutorSources.value = []
    tutorMessages.value.push({ id: `local-${createClientId()}`, role: 'user', content: message })
    try { await streamProductTutor(practice.id, message, createClientId(), applyTutorEvent) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Tutor 暂时不可用' } finally { tutorLoading.value = false }
  }
  async function retryTutor() {
    const practice = workspace.value?.practice
    if (!practice || !tutorFailure.value || tutorLoading.value || practice.status === 'resolved') return
    tutorLoading.value = true; tutorSources.value = []; const failure = tutorFailure.value
    try { await retryProductTutor(practice.id, failure.invocationId, applyTutorEvent) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Tutor 暂时不可用' } finally { tutorLoading.value = false }
  }
  async function pinTutor(targetType: ProductPracticePin['targetType'], targetId: string) {
    const practice = workspace.value?.practice
    if (!practice || !targetId || targetId.startsWith('local-') || targetId.startsWith('stream-')) return
    const created = await createProductPin(practice.id, targetType, targetId)
    tutorPins.value = [created, ...tutorPins.value.filter((item) => item.id !== created.id)]
  }
  function dispose() { stopPolling(); stopSaving() }

  const tutorCurrentGap = computed(() => tutorLastResponse.value?.currentGap ?? '先从当前任务和最近一次真实输出开始。')
  const tutorNextQuestion = computed(() => tutorLastResponse.value?.nextQuestion ?? '请先说明你从代码或测试输出中观察到了什么。')
  const tutorPinnedIds = computed(() => tutorPins.value.map((item) => item.targetId))

  return { learningCase, job, workspace, selectedPath, editorContent, selectedFile, saveState, loading, working, error, isGenerating, tutorMessages, tutorSources, tutorLastResponse, tutorFailure, tutorLoading, tutorCurrentGap, tutorNextQuestion, tutorPinnedIds, resetCase, loadCase, create, retry, startPractice, loadWorkspace, selectFile, scheduleSave, saveFile, execute, recheckCompletion, reset, end, askTutor, retryTutor, pinTutor, dispose }
})
