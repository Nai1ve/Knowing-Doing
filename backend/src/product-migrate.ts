import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

function migrationDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/product')
}

function migrationFiles(): string[] {
  return fs.readdirSync(migrationDir()).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
}

export function openProductDatabase(dbPath: string): Database.Database {
  const database = new Database(dbPath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  return database
}

export function applyProductMigrations(dbPath: string): void {
  const database = openProductDatabase(dbPath)
  try {
    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>
    const versions = new Set(applied.map((row) => row.version))
    for (const file of migrationFiles()) {
      if (versions.has(file)) continue
      const sql = fs.readFileSync(path.join(migrationDir(), file), 'utf8')
      database.transaction(() => {
        database.exec(sql)
        database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
      })()
    }
  } finally {
    database.close()
  }
}

export function assertProductMigrations(database: Database.Database): void {
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as { name: string } | undefined
  if (!table) throw new Error('Product database is not migrated; run npm run db:migrate')
  const applied = new Set((database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map((row) => row.version))
  const missing = migrationFiles().filter((file) => !applied.has(file))
  if (missing.length > 0) throw new Error(`Product database migrations missing: ${missing.join(', ')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.ZHIXING_PRODUCT_DB_PATH ?? './data/zhixing-product.db'
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })
  applyProductMigrations(dbPath)
  console.log(`Product database migrated: ${path.resolve(dbPath)}`)
}
