import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const includeMysql = args.has('--include-mysql')
const backendDir = path.resolve(process.cwd())
const dataDir = path.resolve(backendDir, 'data')
const configuredDb = path.resolve(process.env.ZHIXING_PRODUCT_DB_PATH ?? path.join(dataDir, 'zhixing-product.db'))
const apiPort = Number(process.env.LAB_API_PORT ?? 3001)
const localCompose = path.resolve(backendDir, 'docker-compose.local.yml')
const volumeName = 'zhixing-lab-mysql-data'

function fail(message: string): never { throw new Error(`reset-local refused: ${message}`) }
function command(command: string, commandArgs: string[]): string { return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function portIsListening(port: number): boolean {
  try { return Boolean(command('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])) } catch { return false }
}

if (process.env.NODE_ENV === 'production') fail('NODE_ENV=production')
if (!configuredDb.startsWith(`${dataDir}${path.sep}`)) fail(`SQLite path must remain below ${dataDir}`)
if (!fs.existsSync(localCompose)) fail('local compose file is missing')
if (apply && !includeMysql) fail('--apply requires --include-mysql so the local Lab volume is reset deliberately')
if (apply && portIsListening(apiPort)) fail(`API port ${apiPort} is still listening`)
if (apply && includeMysql) {
  let context: string
  try { context = command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']) } catch { fail('Docker local context is unavailable') }
  if (!context.startsWith('unix://')) fail(`Docker context is not local: ${context}`)
}

const sqliteTargets = fs.existsSync(dataDir)
  ? fs.readdirSync(dataDir).filter((name) => /^(?:zhixing-product(?:\.snapshot-[a-z0-9-]+)?|route-smoke)\.db(?:-(?:wal|shm))?$/i.test(name)).map((name) => path.join(dataDir, name))
  : []
const resumeDir = path.resolve(process.env.ZHIXING_RESUME_STORAGE_PATH ?? path.join(dataDir, 'resumes'))
if (!resumeDir.startsWith(`${dataDir}${path.sep}`)) fail(`resume path must remain below ${dataDir}`)

const counts = { learners: 0, plans: 0, practiceRuns: 0, artifacts: 0 }
if (fs.existsSync(configuredDb)) {
  const db = new Database(configuredDb, { readonly: true })
  try {
    counts.learners = Number((db.prepare('SELECT COUNT(*) AS count FROM learners').get() as { count: number }).count)
    counts.plans = Number((db.prepare('SELECT COUNT(*) AS count FROM learning_plans').get() as { count: number }).count)
    counts.practiceRuns = Number((db.prepare('SELECT COUNT(*) AS count FROM practice_runs').get() as { count: number }).count)
    counts.artifacts = Number((db.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number }).count)
  } finally { db.close() }
}

const report = {
  mode: apply ? 'apply' : 'dry-run',
  sqliteTargets,
  resumeDirectory: fs.existsSync(resumeDir) ? resumeDir : null,
  mysqlVolume: includeMysql ? volumeName : null,
  counts,
}
console.log(JSON.stringify(report, null, 2))

if (!apply) process.exit(0)

for (const target of sqliteTargets) fs.rmSync(target, { force: true })
fs.rmSync(resumeDir, { recursive: true, force: true })
try { command('docker', ['volume', 'rm', volumeName]) } catch (error) {
  const message = String((error as { stderr?: Buffer }).stderr ?? error)
  if (!message.includes('No such volume')) fail(`Docker volume removal failed: ${message}`)
}
console.log('Local product data reset completed. Run npm run db:migrate, then initialize the local MySQL Lab fixture before starting the API.')
