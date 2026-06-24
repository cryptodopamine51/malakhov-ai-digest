/**
 * pipeline/schema-guard.ts
 *
 * Runtime-предохранитель против schema drift: код ссылается на DB-объект (таблицу/
 * функцию), которого нет в прод-Supabase, потому что миграцию закоммитили, но не
 * накатили. Без guard'а это даёт криптовый PostgREST-краш (`Could not find the
 * function … in the schema cache`); с guard'ом — внятную ошибку с указанием, какую
 * миграцию применить.
 *
 * Контекст: 2026-06-22 weekly report падал каждый понедельник, потому что миграция
 * 20260622073323_weekly_telegram_report.sql не была применена к проду (таблицы
 * weekly_report_runs не существовало). См. docs/task_telegram_bot_reliability_2026-06-24.md.
 *
 * Проверка таблиц сделана через head-select (`limit 0`) — это безопасно (нет
 * сайд-эффектов) в отличие от вызова RPC. Так как таблица и функция приезжают одной
 * миграцией, наличия таблицы достаточно как прокси готовности всей миграции.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Признак «отношение/функция не существует» в ответе PostgREST. */
export function isMissingObjectError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  // PGRST205 — table not found in schema cache; PGRST202 — function not found;
  // 42P01 — undefined_table; 42883 — undefined_function (Postgres SQLSTATE).
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true
  return (
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('could not find the function') ||
    message.includes('in the schema cache')
  )
}

/**
 * Возвращает подмножество `tables`, которых нет в подключённой БД. Прочие ошибки
 * (RLS, сеть) не считаются «отсутствием» — guard не должен ронять рабочий путь
 * из-за временной сетевой ошибки.
 */
export async function findMissingTables(
  supabase: Pick<SupabaseClient, 'from'>,
  tables: string[],
): Promise<string[]> {
  const missing: string[] = []
  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .select('*', { head: true, count: 'exact' })
      .limit(0)
    if (isMissingObjectError(error)) missing.push(table)
  }
  return missing
}

export interface SchemaRequirement {
  /** Таблицы, наличие которых обязательно. */
  tables: string[]
  /** Имя файла миграции, которую надо применить, если объектов нет. */
  migration: string
  /** Человекочитаемое имя фичи для текста ошибки. */
  feature: string
}

/**
 * Кидает понятную ошибку, если хоть один обязательный объект отсутствует.
 * Вызывать в начале рантайм-пути фичи (до основной работы и до записи в Telegram).
 */
export async function assertSchemaReady(
  supabase: Pick<SupabaseClient, 'from'>,
  requirement: SchemaRequirement,
): Promise<void> {
  const missing = await findMissingTables(supabase, requirement.tables)
  if (missing.length > 0) {
    throw new Error(
      `${requirement.feature}: schema not applied — отсутствуют объекты [${missing.join(', ')}]. ` +
        `Накатите миграцию supabase/migrations/${requirement.migration} на прод-Supabase ` +
        `(см. docs/OPERATIONS.md → Deploy → применение миграций).`,
    )
  }
}

export const WEEKLY_REPORT_SCHEMA: SchemaRequirement = {
  tables: ['weekly_report_runs'],
  migration: '20260622073323_weekly_telegram_report.sql',
  feature: 'weekly report',
}
