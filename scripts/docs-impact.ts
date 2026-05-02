import { execFileSync } from 'node:child_process'

type Rule = {
  doc: string
  matches: (file: string) => boolean
}

const CANONICAL_DOCS = new Set([
  'docs/PROJECT.md',
  'docs/ARCHITECTURE.md',
  'docs/ARTICLE_SYSTEM.md',
  'docs/OPERATIONS.md',
  'docs/DECISIONS.md',
  'docs/DESIGN.md',
  'docs/editorial_style_guide.md',
])

const RULES: Rule[] = [
  {
    doc: 'docs/ARTICLE_SYSTEM.md',
    matches: (file) =>
      /^(pipeline\/(ingest|rss-parser|feeds\.config|enricher|fetcher|scorer|slug|claude|generate-images|image-director|image-generator)\.ts)$/.test(file),
  },
  {
    doc: 'docs/ARTICLE_SYSTEM.md',
    matches: (file) =>
      /^(app\/articles\/|app\/archive\/|app\/topics\/|app\/sources\/|bot\/daily-digest\.ts$|bot\/daily-digest-core\.ts$|lib\/articles\.ts$|lib\/article-slugs\.ts$|app\/sitemap\.ts$|src\/components\/ArticleCard\.tsx$)/.test(file),
  },
  {
    doc: 'docs/ARCHITECTURE.md',
    matches: (file) =>
      /^(lib\/supabase\.ts$|supabase\/|app\/internal\/)/.test(file),
  },
  {
    doc: 'docs/OPERATIONS.md',
    matches: (file) =>
      /^(\.github\/workflows\/|vercel\.json$|package\.json$|scripts\/|app\/api\/cron\/|pipeline\/(alerts|provider-guard|source-health|backlog-monitor|publish-verify|publish-verify-utils|retry-failed|recover-stuck|claims|types)\.ts$)/.test(file),
  },
  {
    doc: 'docs/PROJECT.md',
    matches: (file) =>
      /^(app\/page\.tsx$|app\/layout\.tsx$|src\/components\/Header\.tsx$)/.test(file),
  },
  {
    doc: 'docs/DESIGN.md',
    matches: (file) =>
      /^(app\/globals\.css$|src\/components\/(?!ArticleCard\.tsx$|Header\.tsx$).+)/.test(file),
  },
]

function runGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function getArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function getChangedFiles(): string[] {
  const base = getArgValue('--base')
  const head = getArgValue('--head')

  if (base && head) {
    return unique(runGit(['diff', '--name-only', '--diff-filter=ACMRD', base, head]).split('\n'))
  }

  const tracked = runGit(['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD']).split('\n')
  const untracked = runGit(['ls-files', '--others', '--exclude-standard']).split('\n')

  return unique([...tracked, ...untracked])
}

function isDocumentationFile(file: string): boolean {
  return file === 'CLAUDE.md' || file === 'README.md' || file.startsWith('docs/')
}

const changedFiles = getChangedFiles()

if (changedFiles.length === 0) {
  console.log('docs-impact: no changed files')
  process.exit(0)
}

const changedDocs = new Set(changedFiles.filter((file) => CANONICAL_DOCS.has(file)))
const impacted = new Map<string, string[]>()

for (const file of changedFiles) {
  if (isDocumentationFile(file) || file.startsWith('legacy/')) {
    continue
  }

  for (const rule of RULES) {
    if (!rule.matches(file)) continue
    const current = impacted.get(rule.doc) ?? []
    current.push(file)
    impacted.set(rule.doc, current)
  }
}

if (impacted.size === 0) {
  console.log('docs-impact: no mapped code changes detected')
  process.exit(0)
}

const missingDocs: Array<{ doc: string; files: string[] }> = []

for (const [doc, files] of Array.from(impacted.entries())) {
  if (changedDocs.has(doc)) continue
  missingDocs.push({ doc, files: unique(files) })
}

if (missingDocs.length > 0) {
  console.error('docs-impact: missing canonical documentation updates')
  for (const item of missingDocs) {
    console.error(`- ${item.doc}`)
    for (const file of item.files) {
      console.error(`  caused by: ${file}`)
    }
  }
  console.error('Update the listed docs or narrow the change scope, then run `npm run docs:check` again.')
  process.exit(1)
}

console.log('docs-impact: ok')
for (const [doc, files] of Array.from(impacted.entries())) {
  console.log(`- ${doc}`)
  for (const file of unique(files)) {
    console.log(`  covered by change in: ${file}`)
  }
}
