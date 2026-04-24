import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8').trim()
}

function printSection(title: string, body: string): void {
  const line = '='.repeat(title.length)
  console.log(`${title}\n${line}\n${body}\n`)
}

try {
  printSection('CLAUDE.md', read('CLAUDE.md'))
  printSection('docs/INDEX.md', read('docs/INDEX.md'))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to load project context: ${message}`)
  process.exit(1)
}
