import 'dotenv/config'
import { CurationService } from './curation-service.js'
import { loadConfig } from './config.js'
import { ProductRepository } from './product-repository.js'
import { WritingService } from './writing-service.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const runId = argument('--run-id')
const apply = process.argv.includes('--apply')
if (!runId) throw new Error('用法：npm run product:backfill-curation -- --run-id <id> [--apply]')

const config = loadConfig()
const repository = new ProductRepository(config.productDbPath)
try {
  const run = repository.getPracticeRun(runId)
  const existing = repository.getWritingProjectByRun(runId)
  if (!existing && !apply) {
    console.log(JSON.stringify({ runId, status: 'not_ready', message: '该实践还没有写作工程；使用 --apply 才会初始化并回填。' }, null, 2))
  } else {
    const project = existing ?? (apply ? new WritingService(repository).initialize(runId) : null)
    if (!project) throw new Error('写作工程不可用')
    const curation = new CurationService(repository)
    const candidates = curation.buildCandidates(project)
    const preview = candidates.definitions.map((definition) => ({ clusterKey: definition.clusterKey, title: definition.title, members: definition.members.length, duplicates: definition.members.filter((member) => member.role === 'duplicate').length, ruleSummary: definition.ruleSummary }))
    if (!apply) {
      console.log(JSON.stringify({ runId, caseId: run.caseId, status: 'dry_run', clusters: preview }, null, 2))
    } else {
      curation.ensure(project)
      console.log(JSON.stringify({ runId, caseId: run.caseId, status: 'applied', clusters: preview }, null, 2))
    }
  }
} finally {
  repository.close()
}
