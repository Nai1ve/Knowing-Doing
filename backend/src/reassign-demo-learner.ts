import { openProductDatabase, assertProductMigrations } from './product-migrate.js'

const args = new Set(process.argv.slice(2))
const sourceIndex = process.argv.indexOf('--source-learner-id')
const sourceId = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined
const apply = args.has('--apply')
const targetId = process.env.ZHIXING_DEMO_LEARNER_ID ?? 'demo-learner'
const dbPath = process.env.ZHIXING_PRODUCT_DB_PATH ?? './data/zhixing-product.db'

if (!sourceId || sourceId === targetId) throw new Error('用法：npm run product:adopt-demo-history -- --source-learner-id <id> [--apply]')

const database = openProductDatabase(dbPath)
try {
  assertProductMigrations(database)
  if (!database.prepare('SELECT 1 FROM learners WHERE id = ?').get(targetId)) throw new Error(`目标 Demo learner 不存在：${targetId}`)
  if (!database.prepare('SELECT 1 FROM learners WHERE id = ?').get(sourceId)) throw new Error(`来源 learner 不存在：${sourceId}`)

  const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").all() as Array<{ name: string }>).map((row) => row.name)
  const movable: string[] = []
  for (const table of tables) {
    const columns = database.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>
    if (columns.some((column) => column.name === 'learner_id')) movable.push(table)
  }
  const counts = movable.map((table) => ({ table, source: Number((database.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE learner_id = ?`).get(sourceId) as { count: number }).count), target: Number((database.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE learner_id = ?`).get(targetId) as { count: number }).count) }))
  console.table(counts.filter((row) => row.source > 0 || row.target > 0))
  if (!apply) console.log('dry-run：未修改数据。确认来源 learner 唯一且目标数据可接受后，再追加 --apply。')
  else {
    if (counts.some((row) => row.source > 0 && row.target > 0)) throw new Error('目标 Demo learner 已存在数据，拒绝自动合并；请先人工处理冲突')
    database.transaction(() => {
      for (const table of movable) database.prepare(`UPDATE "${table}" SET learner_id = ? WHERE learner_id = ?`).run(targetId, sourceId)
    })()
    console.log(`已将 ${sourceId} 的 learner 数据移动到 ${targetId}。原 learners 行保留，便于审计。`)
  }
} finally { database.close() }
