import type { LearningPlan, LearningNode, LessonContext, Milestone, OAuthConnection, PracticeEvent, PinnedReference, TutorMessage, UserProfile } from '@/types/domain'

export const mockPlan: LearningPlan = {
  id: 'k8s-2026', title: 'Kubernetes 系统学习', technology: 'Kubernetes',
  goal: '在四周内建立可部署、可解释、可排障的 Kubernetes 能力。',
  week: 2, totalWeeks: 4, progress: 42, completedUnits: 8, totalUnits: 19,
  weeklyMinutes: 150, currentNodeId: 'replicaset', startedAt: '2026.08.10', dueAt: '2026.09.06',
}

const node = (id: string, title: string, status: LearningNode['status'], duration = '35 分钟'): LearningNode => ({ id, title, status, duration })

export const mockMilestones: Milestone[] = [
  { id: 'foundation', index: '01', title: '建立心智模型', status: 'completed', summary: '控制面、Node、Pod 与期望状态', progress: '5 / 5', nodes: [node('desired', '期望状态', 'completed'), node('pod', 'Pod / Node', 'completed'), node('scheduler', '调度过程', 'completed')] },
  { id: 'deploy', index: '02', title: '部署应用', status: 'current', summary: '工作负载、Service 与配置', progress: '3 / 5', nodes: [node('workload', '工作负载', 'completed'), node('replicaset', 'Deployment / ReplicaSet', 'current'), node('service', 'Service / 配置', 'upcoming')] },
  { id: 'runtime', index: '03', title: '稳定运行', status: 'upcoming', summary: '资源、发布与健康检查', progress: '0 / 5', nodes: [node('resource', '资源限制', 'upcoming'), node('release', '发布与回滚', 'upcoming'), node('probe', '健康检查', 'upcoming')] },
  { id: 'transfer', index: '04', title: '排障与迁移', status: 'upcoming', summary: '综合实践与能力迁移', progress: '0 / 4', nodes: [node('pending', 'Pod Pending', 'upcoming'), node('crash', 'CrashLoopBackOff', 'upcoming'), node('practice', '综合实践', 'upcoming')] },
]

export const mockLesson: LessonContext = {
  id: 'lesson-02-03', title: '读懂一份最小 YAML',
  description: '完成后，你应该能够说明 Deployment 与 ReplicaSet 的关系；期望副本数由谁维护；当实际副本数不符合预期时，首先查看哪些证据。',
  question: '如果 replicas 设置为 3，但只有 2 个 Pod Ready，你先看什么？',
  code: 'spec:\n  replicas: 3\n  template:\n    spec:\n      containers:\n      - name: api\n        image: demo/api:v1',
  steps: [
    { id: 'understand', label: '01', title: '学习目标', description: '说明 Deployment 与 ReplicaSet 的关系，以及异常时要观察的证据。' },
    { id: 'build', label: '02', title: '构建理解', description: '把目标副本数、模板和控制器关系标记在 YAML 上。' },
    { id: 'run', label: '03', title: '运行观察', description: '区分期望值、当前值和 Ready 状态。' },
    { id: 'prove', label: '04', title: '证明掌握', description: '完成相似配置题，解释为什么不能只修改镜像标签。' },
    { id: 'continue', label: '05', title: '继续迁移', description: '进入 Service 与配置，把概念连接到可运行的服务。' },
  ],
}

export const mockPinned: PinnedReference[] = [
  { id: 'yaml-example', title: '最小 Deployment YAML', body: 'replicas: 3；template 中声明实际运行的 api 容器。', source: '工作台示例' },
  { id: 'common-evidence', title: '常用排查顺序', body: '先比较期望副本、当前副本和 Ready 状态，再看 Events。', source: 'Tutor Agent' },
  { id: 'judgement-template', title: '判断句式', body: '先描述现象，再列证据，最后说明哪个控制器负责把状态拉回期望值。', source: '学习方法' },
]

export const mockPracticeEvents: PracticeEvent[] = [
  { id: 'event-reference-1', type: 'reference', title: 'Deployment、ReplicaSet 与 Pod 的关系', body: 'Deployment 管理发布和期望状态，ReplicaSet 负责维持副本数。', source: '知乎摘要', createdAt: '刚刚' },
  { id: 'event-reference-2', type: 'reference', title: '最小 Deployment YAML', body: 'replicas: 3；template 中声明实际运行的 api 容器。', source: '工作台固定', createdAt: '刚刚' },
  { id: 'event-question-1', type: 'question', title: '为什么 replicas 是 3，却只有 2 个 Pod Ready？', body: '需要区分期望状态、当前状态和就绪状态。', source: '检查点', createdAt: '刚刚' },
  { id: 'event-question-2', type: 'question', title: '为什么不能只修改 image 标签？', body: '先确认是哪一个控制器和哪一层状态没有达到期望。', source: 'Tutor Agent', createdAt: '刚刚' },
  { id: 'event-error-1', type: 'error', title: 'deployment.yaml 缩进错误', body: 'kubectl apply 报错，配置文件还没有成为可验证的部署对象。', source: '终端观察 · 示例', createdAt: '刚刚' },
  { id: 'event-observation-1', type: 'observation', title: 'kubectl get deployment 显示 3 个期望副本', body: '控制器已接收到配置，但还要继续核对 Ready 状态。', source: '运行数据 · 示例', createdAt: '刚刚' },
]

export const mockTutorMessages: TutorMessage[] = [
  { id: 'tutor-source', role: 'source', source: '知乎知识 · Tutor Agent 已整理', content: 'Deployment 管理发布和期望状态，ReplicaSet 负责维持副本数；排查时先对照期望、当前和 Ready，再看 Events。' },
]

export const mockProfile: UserProfile = { name: '林', role: '后端开发者', background: '有 Java 服务开发经验，正在补齐 Kubernetes 的部署与排障能力。', signals: ['关注过云原生内容', '近期需要部署服务', '偏好先理解原理再实践'] }

export const mockConnections: OAuthConnection[] = [
  { provider: 'zhihu', status: 'disconnected', scopes: ['检索回答', '读取授权收藏'] },
  { provider: 'model', status: 'disconnected', scopes: ['Tutor Agent 对话', '生成学习大纲'] },
]
