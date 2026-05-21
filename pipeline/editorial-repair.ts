import type { EditorialOutput } from './claude'
import { EDITORIAL_BANNED_PHRASES } from './claude'

export interface EditorialRepairResult {
  output: EditorialOutput
  fixes: string[]
}

export function repairEditorialOutput(input: EditorialOutput): EditorialRepairResult {
  const output: EditorialOutput = {
    ...input,
    summary: Array.isArray(input.summary) ? [...input.summary] : input.summary,
    glossary: Array.isArray(input.glossary) ? input.glossary.map((entry) => ({ ...entry })) : input.glossary,
    link_anchors: Array.isArray(input.link_anchors) ? [...input.link_anchors] : input.link_anchors,
    article_tables: Array.isArray(input.article_tables)
      ? input.article_tables.map((table) => ({
        headers: [...table.headers],
        rows: table.rows.map((row) => [...row]),
      }))
      : input.article_tables,
  }
  const fixes: string[] = []

  for (const field of ['ru_title', 'lead', 'card_teaser', 'tg_teaser', 'editorial_body', 'quality_reason'] as const) {
    const repaired = removeBannedPhrases(replaceStandaloneAi(output[field]))
    if (repaired !== output[field]) {
      output[field] = repaired
      fixes.push(`repair_text:${field}`)
    }
  }

  if (output.ru_title.length > 90) {
    const shortened = shortenTitle(output.ru_title)
    if (shortened !== output.ru_title) {
      output.ru_title = shortened
      fixes.push('shorten_ru_title')
    }
  }

  if (output.lead.length > 400) {
    const shortened = shortenLead(output.lead)
    if (shortened !== output.lead) {
      output.lead = shortened
      fixes.push('shorten_lead')
    }
  }

  if (Array.isArray(output.summary)) {
    output.summary = output.summary.map((item, index) => {
      const repaired = removeBannedPhrases(replaceStandaloneAi(item))
      if (repaired !== item) fixes.push(`repair_text:summary.${index}`)
      return repaired
    })
  }

  if (Array.isArray(output.glossary)) {
    output.glossary = output.glossary.map((entry, index) => {
      const term = removeBannedPhrases(replaceStandaloneAi(entry.term))
      const definition = removeBannedPhrases(replaceStandaloneAi(entry.definition))
      if (term !== entry.term) fixes.push(`repair_text:glossary.${index}.term`)
      if (definition !== entry.definition) fixes.push(`repair_text:glossary.${index}.definition`)
      return { term, definition }
    })
  }

  if (Array.isArray(output.link_anchors) && typeof output.editorial_body === 'string') {
    const before = output.link_anchors.length
    output.link_anchors = output.link_anchors
      .map(replaceStandaloneAi)
      .filter((anchor) => output.editorial_body.includes(anchor))
    if (output.link_anchors.length !== before) fixes.push('drop_invalid_link_anchors')
  }

  if (typeof output.editorial_body === 'string') {
    const restored = restoreParagraphs(output.editorial_body)
    if (restored !== output.editorial_body) {
      output.editorial_body = restored
      fixes.push('restore_editorial_body_paragraphs')
    }
  }

  return { output, fixes: [...new Set(fixes)] }
}

function replaceStandaloneAi(value: string): string {
  return value
    .replace(/\bAI[-‑–—](?=[\p{L}\p{N}])/giu, 'ИИ-')
    .replace(/(?<![.@])\bAI\b/giu, 'ИИ')
}

function removeBannedPhrases(value: string): string {
  let repaired = value
  for (const phrase of EDITORIAL_BANNED_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    repaired = repaired.replace(new RegExp(`${escaped}[,:;]?\\s*`, 'giu'), '')
  }
  return repaired
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function shortenTitle(value: string): string {
  const normalized = value.trim()
  const splitters = [' — ', ': ', '; ']
  for (const splitter of splitters) {
    const head = normalized.split(splitter)[0]?.trim()
    if (head && head.length >= 20 && head.length <= 90) return head
  }
  if (normalized.length <= 90) return normalized
  const words = normalized.split(/\s+/)
  let result = ''
  for (const word of words) {
    const next = result ? `${result} ${word}` : word
    if (next.length > 87) break
    result = next
  }
  return result.length >= 20 ? result.replace(/[,:;.-]+$/, '') : normalized.slice(0, 87).trim()
}

function shortenLead(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 400) return normalized

  const sentences = normalized
    .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []

  if (sentences.length > 1 && sentences[0] && sentences[0].length >= 100 && sentences[0].length <= 400) {
    return sentences[0]
  }

  let result = ''
  for (const word of normalized.split(/\s+/)) {
    const next = result ? `${result} ${word}` : word
    if (next.length > 397) break
    result = next
  }
  return result.length >= 100 ? `${result.replace(/[,:;.-]+$/, '')}.` : normalized.slice(0, 397).trim()
}

function restoreParagraphs(value: string): string {
  const paragraphs = value.split('\n\n').filter((paragraph) => paragraph.trim())
  if (paragraphs.length >= 3 || value.length < 1200) return value

  const sentences = value
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []
  if (sentences.length < 6) return value

  const targetParagraphs = sentences.length >= 10 ? 5 : sentences.length >= 8 ? 4 : 3
  const perParagraph = Math.ceil(sentences.length / targetParagraphs)
  const restored: string[] = []
  for (let index = 0; index < sentences.length; index += perParagraph) {
    restored.push(sentences.slice(index, index + perParagraph).join(' '))
  }
  return restored.join('\n\n')
}
