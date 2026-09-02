import 'dotenv/config'
import { loadConfig } from './config.js'
import { ProductRepository } from './product-repository.js'
import { CurationService } from './curation-service.js'
import { DeepSeekWritingAgent } from './writing-agent.js'
import { WritingService } from './writing-service.js'

const runFlag = process.argv.find((value) => value.startsWith('--run-id='))
const runFlagIndex = process.argv.indexOf('--run-id')
const runId = runFlag?.slice('--run-id='.length) ?? (runFlagIndex >= 0 ? process.argv[runFlagIndex + 1] : undefined)
if (!runId) throw new Error('用法：npm run product:replay-narrative -- --run-id <practiceRunId>')

const config = loadConfig()
const repository = new ProductRepository(config.productDbPath)
const writing = new WritingService(repository, new CurationService(repository), new DeepSeekWritingAgent(config))
const draft = writing.regenerate(runId, `replay:${runId}`)
console.log(`Narrative replay queued: ${draft.id}`)

const poll = setInterval(() => {
  const current = repository.getWritingDraftRun(draft.id)
  console.log(JSON.stringify({ id: current.id, phase: current.phase, status: current.status, failureCode: current.failureCode }))
  if (current.status === 'succeeded' || current.status === 'failed') {
    clearInterval(poll)
    repository.close()
    if (current.status === 'failed') process.exitCode = 1
  }
}, 1000)
