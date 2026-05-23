import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

type PackageFile = {
  target: string
  template: string
}

const PACKAGE_FILES: PackageFile[] = [
  { target: '01-seo-brief.md', template: 'seo-brief.template.md' },
  { target: '02-serp-research.md', template: 'serp-research.template.md' },
  { target: '03-source-notes.md', template: 'source-notes.template.md' },
  { target: '04-outline.md', template: 'outline.template.md' },
  { target: '05-draft.md', template: 'draft.template.md' },
  { target: '06-editorial-pass.md', template: 'editorial-pass.template.md' },
  { target: '07-final-article.md', template: 'final-article.template.md' },
  { target: '08-metadata.json', template: 'metadata.template.json' },
  { target: '09-image-brief.md', template: 'image-brief.template.md' },
  { target: '10-codex-publication-task.md', template: 'codex-publication-task.template.md' },
  { target: '11-publication-checklist.md', template: 'publication-checklist.template.md' },
  { target: '12-chatgpt-image-prompts.md', template: 'chatgpt-image-prompts.template.md' },
]

const root = process.cwd()
const evergreenDir = join(root, 'content', 'evergreen')
const templatesDir = join(evergreenDir, 'templates')
const topicsPath = join(evergreenDir, 'topics.json')

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

function loadTopics(): Topic[] {
  const parsed = JSON.parse(readFileSync(topicsPath, 'utf8')) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${topicsPath} to contain an array`)
  }
  return parsed as Topic[]
}

function formatMoscowDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Failed to format Moscow date')
  }

  return `${year}-${month}-${day}`
}

function inferMode(topic: Topic): 'create' | 'update_existing' {
  const slug = topic.targetSlug
  const markdownPath = join(root, 'content', 'guides', `${slug}.md`)
  const metadataPath = join(root, 'content', 'guides', 'meta', `${slug}.json`)

  if (topic.status === 'published' || topic.status === 'needs_update') {
    return 'update_existing'
  }

  if (existsSync(markdownPath) || existsSync(metadataPath)) {
    return 'update_existing'
  }

  return 'create'
}

function renderTemplate(template: string, topic: Topic, mode: string, date: string): string {
  const replacements: Record<string, string> = {
    id: String(topic.id),
    status: topic.status,
    cluster: topic.cluster,
    title: topic.title,
    primaryKeyword: topic.primaryKeyword,
    supportingKeywordsList: topic.supportingKeywords.join(', '),
    supportingKeywordsBullets: topic.supportingKeywords.map((keyword) => `- ${keyword}`).join('\n'),
    intent: topic.intent,
    audienceList: topic.audience.join(', '),
    slug: topic.targetSlug,
    priority: topic.priority,
    cta: topic.cta,
    notes: topic.notes,
    mode,
    date,
  }

  return template.replace(/\{\{(\w+)\}\}/g, (token, key: string) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : token
  })
}

function main() {
  const topicIdRaw = getArgValue('--topic-id')
  const dryRun = hasFlag('--dry-run')
  const force = hasFlag('--force')

  if (!topicIdRaw) {
    throw new Error('Usage: npm run evergreen:new -- --topic-id=<id> [--dry-run] [--force]')
  }

  const topicId = Number(topicIdRaw)
  if (!Number.isInteger(topicId) || topicId < 1) {
    throw new Error(`Invalid --topic-id value: ${topicIdRaw}`)
  }

  const topics = loadTopics()
  const topic = topics.find((item) => item.id === topicId)
  if (!topic) {
    throw new Error(`Topic ${topicId} not found in content/evergreen/topics.json`)
  }

  const slug = topic.targetSlug
  const packageDir = join(evergreenDir, 'packages', slug)
  const date = formatMoscowDate()
  const mode = inferMode(topic)
  const outputFiles = ['00-topic.json', ...PACKAGE_FILES.map((file) => file.target)]

  if (dryRun) {
    const existingTargets = outputFiles.filter((file) => existsSync(join(packageDir, file)))
    console.log(`evergreen:new dry-run`)
    console.log(`- topic: ${topic.id} ${topic.title}`)
    console.log(`- mode: ${mode}`)
    console.log(`- package: content/evergreen/packages/${slug}`)
    if (existingTargets.length > 0) {
      console.log(`- existing scaffold files: ${existingTargets.length}`)
    }
    for (const file of outputFiles) {
      console.log(`- would create: ${file}`)
    }
    return
  }

  if (existsSync(packageDir) && !force) {
    const existingTargets = outputFiles.filter((file) => existsSync(join(packageDir, file)))
    if (existingTargets.length > 0) {
      throw new Error(
        `Package already exists at content/evergreen/packages/${slug}. Use --force to overwrite scaffold files.`,
      )
    }
  }

  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, '00-topic.json'), `${JSON.stringify(topic, null, 2)}\n`)

  for (const file of PACKAGE_FILES) {
    const template = readFileSync(join(templatesDir, file.template), 'utf8')
    const rendered = renderTemplate(template, topic, mode, date)
    writeFileSync(join(packageDir, file.target), rendered.endsWith('\n') ? rendered : `${rendered}\n`)
  }

  console.log(`Created evergreen package: content/evergreen/packages/${slug}`)
  console.log(`Mode: ${mode}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
