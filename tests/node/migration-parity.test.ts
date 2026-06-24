import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Парити-гейт против «забыли миграцию»: каждая таблица из supabase.from('…') и
 * каждая функция из supabase.rpc('…') в рантайм-коде обязана иметь create-stmt в
 * supabase/migrations/*.sql или supabase/schema.sql. Не заменяет runtime schema-guard
 * (тот ловит «миграция не накатана на прод»), а ловит более раннюю ошибку — отсутствие
 * самого файла миграции. См. docs/task_telegram_bot_reliability_2026-06-24.md.
 */

const ROOT = process.cwd()
const CODE_DIRS = ['bot', 'pipeline', 'lib']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function collectIdentifiers(): { tables: Set<string>; rpcs: Set<string> } {
  const tables = new Set<string>()
  const rpcs = new Set<string>()
  for (const dir of CODE_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\.from\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) tables.add(m[1])
      for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) rpcs.add(m[1])
    }
  }
  return { tables, rpcs }
}

function loadMigrationSql(): string {
  const dir = join(ROOT, 'supabase', 'migrations')
  let sql = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
  try {
    sql += '\n' + readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')
  } catch {
    /* schema.sql опционален */
  }
  return sql.toLowerCase()
}

function hasTable(sql: string, name: string): boolean {
  return new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${name}\\b`).test(sql)
}

function hasFunction(sql: string, name: string): boolean {
  return new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${name}\\s*\\(`).test(sql)
}

test('каждая supabase.from(table) имеет create table в миграциях', () => {
  const { tables } = collectIdentifiers()
  const sql = loadMigrationSql()
  const missing = [...tables].filter((name) => !hasTable(sql, name))
  assert.deepEqual(
    missing,
    [],
    `Нет create table для: ${missing.join(', ')}. Добавьте миграцию в supabase/migrations/ или удалите ссылку.`,
  )
})

test('каждая supabase.rpc(fn) имеет create function в миграциях', () => {
  const { rpcs } = collectIdentifiers()
  const sql = loadMigrationSql()
  const missing = [...rpcs].filter((name) => !hasFunction(sql, name))
  assert.deepEqual(
    missing,
    [],
    `Нет create function для: ${missing.join(', ')}. Добавьте миграцию в supabase/migrations/.`,
  )
})
