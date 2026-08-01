import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const LEGACY_SUPABASE_HOST = 'oziddrpkwzsdtsibauon.supabase.co'
const ARTICLES_PATH = '/rest/v1/articles'
const MIN_EDITORIAL_BODY_LENGTH = 1200

export type JsonRecord = Record<string, unknown>

type Candidate = {
  article: JsonRecord
  responseDate: string | null
  sourceOrder: number
}

export type Rejection = {
  file: number
  reason: string
  detail?: string
}

export type RecoveryResult = {
  articles: JsonRecord[]
  rejected: Rejection[]
  scannedFiles: number
  matchedFetchRecords: number
  duplicateIdsResolved: number
  duplicateSlugOrUrlResolved: number
  checksum: string
  fieldStatistics: Record<string, { present: number; null: number; types: Record<string, number> }>
}

export type RecoverOptions = {
  input: string
  output?: string
  dryRun?: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseIso(value: unknown): number {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

function decodeBody(value: unknown): unknown {
  if (typeof value !== 'string' || !isStrictBase64(value)) {
    throw new Error('invalid_base64_body')
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  return JSON.parse(decoded) as unknown
}

function responseDate(record: JsonRecord): string | null {
  const headers = isRecord(record.data) && isRecord(record.data.headers) ? record.data.headers : null
  const value = headers?.date
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const updated = parseIso(left.article.updated_at) - parseIso(right.article.updated_at)
  if (updated !== 0) return updated
  const response = parseIso(left.responseDate) - parseIso(right.responseDate)
  if (response !== 0) return response
  return right.sourceOrder - left.sourceOrder
}

function isRecoverableArticle(value: JsonRecord): boolean {
  return value.published === true
    && value.quality_ok === true
    && value.publish_status === 'live'
    && typeof value.editorial_body === 'string'
    && value.editorial_body.length >= MIN_EDITORIAL_BODY_LENGTH
    && typeof value.id === 'string'
    && value.id.length > 0
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.sort((a, b) => compareText(a.name, b.name)).map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

function jsonl(articles: JsonRecord[]): string {
  return articles.map((article) => JSON.stringify(article)).join('\n') + (articles.length > 0 ? '\n' : '')
}

function calculateFieldStatistics(articles: JsonRecord[]): RecoveryResult['fieldStatistics'] {
  const statistics: RecoveryResult['fieldStatistics'] = {}
  for (const article of articles) {
    for (const [field, value] of Object.entries(article)) {
      const stat = statistics[field] ?? { present: 0, null: 0, types: {} }
      stat.present += 1
      if (value === null) stat.null += 1
      const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
      stat.types[type] = (stat.types[type] ?? 0) + 1
      statistics[field] = stat
    }
  }
  return Object.fromEntries(Object.entries(statistics).sort(([a], [b]) => compareText(a, b)))
}

function resolveUniqueField(candidates: Candidate[], field: 'slug' | 'original_url', rejected: Rejection[]): Candidate[] {
  const selected = new Map<string, Candidate>()
  const withoutField: Candidate[] = []
  for (const candidate of candidates) {
    const value = candidate.article[field]
    if (typeof value !== 'string' || value.length === 0) {
      withoutField.push(candidate)
      continue
    }
    const existing = selected.get(value)
    if (!existing || compareCandidate(candidate, existing) > 0) {
      if (existing) rejected.push({ file: existing.sourceOrder, reason: `duplicate_${field}`, detail: String(existing.article.id) })
      selected.set(value, candidate)
    } else {
      rejected.push({ file: candidate.sourceOrder, reason: `duplicate_${field}`, detail: String(candidate.article.id) })
    }
  }
  return [...selected.values(), ...withoutField]
}

export async function recoverSupabaseFetchCache(options: RecoverOptions): Promise<RecoveryResult> {
  const files = await listFiles(options.input)
  const byId = new Map<string, Candidate>()
  const rejected: Rejection[] = []
  let matchedFetchRecords = 0
  let duplicateIdsResolved = 0

  for (const [sourceOrder, file] of files.entries()) {
    let outer: unknown
    try {
      outer = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      rejected.push({ file: sourceOrder, reason: 'invalid_outer_json' })
      continue
    }
    if (!isRecord(outer) || outer.kind !== 'FETCH' || !isRecord(outer.data)) continue
    const urlValue = outer.data.url
    if (typeof urlValue !== 'string') {
      rejected.push({ file: sourceOrder, reason: 'missing_fetch_url' })
      continue
    }
    let url: URL
    try {
      url = new URL(urlValue)
    } catch {
      rejected.push({ file: sourceOrder, reason: 'invalid_fetch_url' })
      continue
    }
    if (url.hostname !== LEGACY_SUPABASE_HOST || url.pathname !== ARTICLES_PATH) {
      rejected.push({ file: sourceOrder, reason: 'outside_articles_whitelist' })
      continue
    }
    matchedFetchRecords += 1
    let decoded: unknown
    try {
      decoded = decodeBody(outer.data.body)
    } catch (error) {
      rejected.push({ file: sourceOrder, reason: error instanceof Error ? error.message : 'invalid_body' })
      continue
    }
    if (!Array.isArray(decoded)) {
      rejected.push({ file: sourceOrder, reason: 'body_is_not_array' })
      continue
    }
    for (const row of decoded) {
      if (!isRecord(row) || !isRecoverableArticle(row)) {
        rejected.push({ file: sourceOrder, reason: 'article_not_recoverable' })
        continue
      }
      const candidate = { article: row, responseDate: responseDate(outer), sourceOrder }
      const id = row.id as string
      const existing = byId.get(id)
      if (!existing || compareCandidate(candidate, existing) > 0) {
        if (existing) duplicateIdsResolved += 1
        byId.set(id, candidate)
      } else {
        duplicateIdsResolved += 1
      }
    }
  }

  const afterSlug = resolveUniqueField([...byId.values()], 'slug', rejected)
  const afterUrl = resolveUniqueField(afterSlug, 'original_url', rejected)
  const articles = afterUrl.map(({ article }) => article).sort((left, right) => compareText(String(left.id), String(right.id)))
  const contents = jsonl(articles)
  const checksum = createHash('sha256').update(contents).digest('hex')
  const fieldStatistics = calculateFieldStatistics(articles)
  const result: RecoveryResult = {
    articles,
    rejected,
    scannedFiles: files.length,
    matchedFetchRecords,
    duplicateIdsResolved,
    duplicateSlugOrUrlResolved: rejected.filter((item) => item.reason === 'duplicate_slug' || item.reason === 'duplicate_original_url').length,
    checksum,
    fieldStatistics,
  }

  if (options.output && !options.dryRun) {
    await fs.mkdir(options.output, { recursive: true, mode: 0o700 })
    const manifest = {
      format: 'malakhov-ai-digest-supabase-cache-recovery/v1',
      source: { legacyHost: LEGACY_SUPABASE_HOST, path: ARTICLES_PATH },
      counts: {
        scannedFiles: result.scannedFiles,
        matchedFetchRecords: result.matchedFetchRecords,
        recoveredArticles: result.articles.length,
        rejected: result.rejected.length,
        duplicateIdsResolved: result.duplicateIdsResolved,
        duplicateSlugOrUrlResolved: result.duplicateSlugOrUrlResolved,
      },
      artifacts: { articlesJsonl: 'articles.jsonl', sha256: { articlesJsonl: result.checksum } },
      note: 'Transport headers, cookies, request URLs, and API keys are intentionally excluded.',
    }
    await Promise.all([
      fs.writeFile(path.join(options.output, 'articles.jsonl'), contents, { mode: 0o600 }),
      fs.writeFile(path.join(options.output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(options.output, 'field-statistics.json'), `${JSON.stringify(fieldStatistics, null, 2)}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(options.output, 'rejected.json'), `${JSON.stringify(rejected, null, 2)}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(options.output, 'SHA256SUMS'), `${checksum}  articles.jsonl\n`, { mode: 0o600 }),
    ])
  }
  return result
}

function readCliOptions(argv: string[]): RecoverOptions {
  let input = path.resolve('.next/cache/fetch-cache')
  let output = path.resolve('output/supabase-recovery')
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--input' || option === '--output') {
      const value = argv[++index]
      if (!value) throw new Error(`${option} requires a value`)
      if (option === '--input') input = path.resolve(value)
      else output = path.resolve(value)
    } else if (option === '--dry-run') {
      dryRun = true
    } else {
      throw new Error(`Unknown option: ${option}`)
    }
  }
  return { input, output, dryRun }
}

async function main(): Promise<void> {
  const options = readCliOptions(process.argv.slice(2))
  const result = await recoverSupabaseFetchCache(options)
  console.log(JSON.stringify({
    dryRun: Boolean(options.dryRun),
    recoveredArticles: result.articles.length,
    scannedFiles: result.scannedFiles,
    matchedFetchRecords: result.matchedFetchRecords,
    rejected: result.rejected.length,
    checksum: result.checksum,
  }))
}

if (process.argv[1]?.endsWith('recover-supabase-cache.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
