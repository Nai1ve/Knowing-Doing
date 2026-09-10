import 'dotenv/config'
import { loadConfig } from './config.js'
import { DeepSeekPlanningAgent, AgentPlanningService } from './agent-planning.js'
import { ProductRepository } from './product-repository.js'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const sessionId = argument('--session')
if (!sessionId) throw new Error('用法：npm run product:repair-agent-roadmap -- --session <sessionId>')

const config = loadConfig()
const repository = new ProductRepository(config.productDbPath)
const learner = repository.db.prepare('SELECT learner_id FROM planning_sessions WHERE id = ? AND mode = \'agent\'').get(sessionId) as { learner_id?: string } | undefined
if (!learner?.learner_id) throw new Error('找不到 Agent 规划会话')

const service = new AgentPlanningService(repository, new DeepSeekPlanningAgent(config), { modelName: config.modelName })
const requestId = argument('--client-request-id') ?? `repair:${sessionId}`
const generation = await service.repairCurrentRoadmap(learner.learner_id, sessionId, requestId)
console.log(JSON.stringify(generation))

while (true) {
  const current = service.getRoadmapGeneration(learner.learner_id, generation.id)
  if (['succeeded', 'failed', 'interrupted'].includes(current.status)) {
    console.log(JSON.stringify(current))
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

repository.close()
