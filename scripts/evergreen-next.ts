/**
 * Печатает следующую evergreen-тему для работы агента.
 *
 * Логика выбора:
 *   1. Берём только темы с `status: "planned"` из content/evergreen/topics.json.
 *   2. Сортируем по приоритету (high → medium → low), внутри одного приоритета — по id.
 *   3. Печатаем первую.
 *
 * Опции:
 *   --json     вывести как JSON, не human-readable
 *   --status=  выбрать другой статус (planned по умолчанию)
 *
 * Пример:
 *   npm run evergreen:next
 *   npm run evergreen:next -- --json
 *   npm run evergreen:next -- --status=editing
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Topic = {
  id: number
  status: string
  cluster: string
  title: string
  primaryKeyword: string
  supportingKeywords: string[]
  intent: string
  audience: string[]
  targetSlug: string
  priority: string
  cta: string
  notes: string
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function getArgValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) return process.argv[exactIndex + 1]
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function readTopics(): Topic[] {
  const path = join(process.cwd(), 'content', 'evergreen', 'topics.json')
  return JSON.parse(readFileSync(path, 'utf8')) as Topic[]
}

function pickNext(topics: Topic[], status: string): Topic | null {
  const candidates = topics
    .filter((t) => t.status === status)
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 99
      const pb = PRIORITY_RANK[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      return a.id - b.id
    })
  return candidates[0] ?? null
}

function printHuman(topic: Topic): void {
  console.log('')
  console.log(`Следующая evergreen-тема (status=${topic.status}):`)
  console.log('')
  console.log(`  id:        ${topic.id}`)
  console.log(`  кластер:   ${topic.cluster}`)
  console.log(`  заголовок: ${topic.title}`)
  console.log(`  slug:      ${topic.targetSlug}`)
  console.log(`  intent:    ${topic.intent}`)
  console.log(`  priority:  ${topic.priority}`)
  console.log(`  primary:   ${topic.primaryKeyword}`)
  console.log(`  audience:  ${topic.audience.join(', ')}`)
  console.log(`  cta:       ${topic.cta}`)
  console.log('')
  console.log(`  notes:`)
  console.log(`    ${topic.notes}`)
  console.log('')
  console.log(`Следующая команда:`)
  console.log(`  npm run evergreen:new -- --topic-id=${topic.id}`)
  console.log('')
}

function main(): void {
  const status = getArgValue('--status') ?? 'planned'
  const asJson = hasFlag('--json')

  const topics = readTopics()
  const next = pickNext(topics, status)

  if (!next) {
    if (asJson) {
      console.log(JSON.stringify({ topic: null, status }, null, 2))
    } else {
      console.log(`Нет тем со статусом "${status}" в content/evergreen/topics.json.`)
    }
    process.exit(0)
  }

  if (asJson) {
    console.log(JSON.stringify({ topic: next }, null, 2))
    return
  }

  printHuman(next)
}

const argv1 = process.argv[1] ?? ''
const isDirectInvocation =
  argv1.endsWith('/scripts/evergreen-next.ts') ||
  argv1.endsWith('\\scripts\\evergreen-next.ts')

if (isDirectInvocation) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

export { pickNext, readTopics }
export type { Topic }
