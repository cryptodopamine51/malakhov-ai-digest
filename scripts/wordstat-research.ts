import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const DEFAULT_FOLDER_ID = 'b1g9m3kj0uamkcfoqmb1'
const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests'
const DEFAULT_NUM_PHRASES = 30

interface Args {
  phrases: string[]
  numPhrases: number
  folderId: string
  out: string | null
  rawOut: string | null
}

interface WordstatTopRequest {
  phrase: string
  count: number
}

interface WordstatResponse {
  topRequests?: WordstatTopRequest[]
  results?: Array<{ phrase: string; count: number | string }>
  totalCount?: number | string
  [key: string]: unknown
}

interface WordstatResult {
  phrase: string
  totalCount: number | null
  topRequests: WordstatTopRequest[]
  response: WordstatResponse
}

function loadExtraEnv(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function parseArgs(argv: string[]): Args {
  const phrases: string[] = []
  let phrasesFile: string | null = null
  let out: string | null = null
  let rawOut: string | null = null
  let numPhrases = DEFAULT_NUM_PHRASES
  let folderId = process.env.WORDSTAT_FOLDER_ID ?? DEFAULT_FOLDER_ID

  for (const arg of argv) {
    if (arg.startsWith('--phrase=')) phrases.push(arg.slice('--phrase='.length).trim())
    else if (arg.startsWith('--phrases-file=')) phrasesFile = arg.slice('--phrases-file='.length)
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length)
    else if (arg.startsWith('--raw-out=')) rawOut = arg.slice('--raw-out='.length)
    else if (arg.startsWith('--num=')) numPhrases = Number(arg.slice('--num='.length))
    else if (arg.startsWith('--folder-id=')) folderId = arg.slice('--folder-id='.length)
  }

  if (phrasesFile) {
    const filePhrases = readFileSync(resolve(process.cwd(), phrasesFile), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\s+#.*$/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
    phrases.push(...filePhrases)
  }

  const uniquePhrases = [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))]

  if (uniquePhrases.length === 0) {
    throw new Error('Pass --phrase="..." or --phrases-file=path')
  }
  if (!Number.isInteger(numPhrases) || numPhrases < 1 || numPhrases > 2000) {
    throw new Error('--num must be an integer from 1 to 2000')
  }
  if (!folderId) throw new Error('Missing folderId')

  return { phrases: uniquePhrases, numPhrases, folderId, out, rawOut }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function fetchTopRequests(
  phrase: string,
  folderId: string,
  numPhrases: number,
  apiKey: string,
): Promise<WordstatResult> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phrase, folderId, numPhrases }),
    })

    const text = await res.text()
    let response: WordstatResponse
    try {
      response = text ? JSON.parse(text) as WordstatResponse : {}
    } catch {
      response = { raw: text }
    }

    if (res.ok) {
      const topRequests = normalizeTopRequests(response)
      return {
        phrase,
        totalCount: parseCount(response.totalCount) ?? topRequests[0]?.count ?? null,
        topRequests,
        response,
      }
    }

    lastError = new Error(`${phrase}: ${res.status} ${res.statusText} ${text.slice(0, 300)}`.trim())
    if (![403, 408, 425, 429, 500, 502, 503, 504].includes(res.status)) break
    await sleep(500 * attempt)
  }

  throw lastError ?? new Error(`${phrase}: request failed`)
}

function parseCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s/g, '')
  if (!/^\d+$/.test(normalized)) return null
  return Number(normalized)
}

function normalizeTopRequests(response: WordstatResponse): WordstatTopRequest[] {
  const source = Array.isArray(response.topRequests) ? response.topRequests : response.results
  if (!Array.isArray(source)) return []

  return source
    .map((item) => ({
      phrase: item.phrase,
      count: parseCount(item.count) ?? 0,
    }))
    .filter((item) => item.phrase && item.count > 0)
}

function formatNumber(value: number | null): string {
  if (value === null) return 'n/a'
  return new Intl.NumberFormat('ru-RU').format(value)
}

function formatNested(items: WordstatTopRequest[], limit = 10): string {
  const nested = items
    .slice(0, limit)
    .map((item) => `${item.phrase} ${formatNumber(item.count)}`)
  return nested.length > 0 ? nested.join(' · ') : '—'
}

function toMarkdown(results: WordstatResult[]): string {
  const generatedAt = new Date().toISOString().slice(0, 10)
  const sorted = [...results].sort((a, b) => (b.totalCount ?? -1) - (a.totalCount ?? -1))

  const lines = [
    `# Wordstat-прогон — ${generatedAt}`,
    '',
    '> Данные: Yandex Cloud Search API v2 Wordstat, `topRequests`, показы/мес по РФ.',
    '> Важно: операторы точного соответствия Wordstat API v2 не поддерживает, поэтому это broad-кластеры, а не exact-match частотность.',
    '',
    '## Сводка',
    '',
    '| Фраза | Показов/мес | Топ вложенных запросов |',
    '|---|---:|---|',
  ]

  for (const result of sorted) {
    lines.push(`| ${result.phrase} | ${formatNumber(result.totalCount)} | ${formatNested(result.topRequests, 8)} |`)
  }

  lines.push('', '## Детализация')
  for (const result of sorted) {
    lines.push('', `### ${result.phrase} — ${formatNumber(result.totalCount)}`)
    if (result.topRequests.length === 0) {
      lines.push('', 'Нет вложенных запросов в ответе API.')
      continue
    }
    lines.push('', '| Вложенный запрос | Показов/мес |', '|---|---:|')
    for (const item of result.topRequests) {
      lines.push(`| ${item.phrase} | ${formatNumber(item.count)} |`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = process.env.WORDSTAT_API_KEY
  if (!apiKey) throw new Error('WORDSTAT_API_KEY missing')

  const results: WordstatResult[] = []
  for (const [index, phrase] of args.phrases.entries()) {
    console.error(`[wordstat] ${index + 1}/${args.phrases.length}: ${phrase}`)
    results.push(await fetchTopRequests(phrase, args.folderId, args.numPhrases, apiKey))
    await sleep(350)
  }

  const markdown = toMarkdown(results)
  console.log(markdown)

  if (args.out) {
    writeFileSync(resolve(process.cwd(), args.out), markdown)
    console.error(`[wordstat] wrote ${args.out}`)
  }
  if (args.rawOut) {
    writeFileSync(resolve(process.cwd(), args.rawOut), JSON.stringify(results, null, 2))
    console.error(`[wordstat] wrote ${args.rawOut}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
