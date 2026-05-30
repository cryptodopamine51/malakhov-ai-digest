import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveDigestStory,
  extractNumericAnchors,
  selectDigestArticles,
  validateDigestComposition,
  type DigestSelectionArticle,
} from '../../bot/digest-selection'

function article(overrides: Partial<DigestSelectionArticle> & { id: string; original_title: string }): DigestSelectionArticle {
  return {
    id: overrides.id,
    source_name: overrides.source_name ?? 'The Decoder',
    original_title: overrides.original_title,
    ru_title: overrides.ru_title ?? null,
    lead: overrides.lead ?? null,
    tg_teaser: overrides.tg_teaser ?? null,
    primary_category: overrides.primary_category ?? 'ai-industry',
    secondary_categories: overrides.secondary_categories ?? [],
    topics: overrides.topics ?? ['ai-industry'],
    score: overrides.score ?? 5,
    pub_date: overrides.pub_date ?? '2026-05-29T10:00:00.000Z',
  }
}

test('extractNumericAnchors normalizes money units used in funding headlines', () => {
  assert.deepEqual(
    extractNumericAnchors('Anthropic raises $65 Billion at a $965 млрд valuation near $1T'),
    ['1t', '65b', '965b'],
  )
})

test('deriveDigestStory keys the Anthropic funding round across sources as one story', () => {
  const crunchbase = deriveDigestStory(article({
    id: 'crunchbase',
    source_name: 'Crunchbase News',
    original_title: 'Anthropic Nears $1T Valuation And Leapfrogs OpenAI On Unicorn Board With $65B Funding Round',
    ru_title: 'Оценка Anthropic достигла $965 млрд после раунда на $65 млрд',
  }))
  const techcrunch = deriveDigestStory(article({
    id: 'techcrunch',
    source_name: 'TechCrunch AI',
    original_title: 'Anthropic raises $65 Billion, nears $1T valuation ahead of IPO',
    ru_title: 'Anthropic привлёк $65 млрд при оценке почти $1 трлн',
  }))
  const decoder = deriveDigestStory(article({
    id: 'decoder',
    source_name: 'The Decoder',
    original_title: 'Claude company Anthropic nears a trillion-dollar valuation after raising $65 billion in Series H',
    ru_title: 'Anthropic привлекла $65 млрд в раунде Series H при оценке почти $1 трлн',
  }))

  assert.equal(crunchbase.storyKey, 'anthropic:funding:65b')
  assert.equal(techcrunch.storyKey, crunchbase.storyKey)
  assert.equal(decoder.storyKey, crunchbase.storyKey)
})

test('deriveDigestStory separates Anthropic funding from Claude model release', () => {
  const funding = deriveDigestStory(article({
    id: 'funding',
    original_title: 'Anthropic raises $65 Billion, nears $1T valuation ahead of IPO',
  }))
  const model = deriveDigestStory(article({
    id: 'model',
    original_title: 'Anthropic ships Claude Opus 4.8 as a modest but tangible improvement',
    ru_title: 'Claude Opus 4.8 обходит GPT-5.5 в большинстве тестов',
  }))

  assert.equal(funding.storyKey, 'anthropic:funding:65b')
  assert.equal(model.storyKey, 'anthropic:model_release:claude-opus-4.8')
  assert.notEqual(model.storyKey, funding.storyKey)
})

test('selectDigestArticles drops duplicate stories inside one digest', () => {
  const candidates = [
    article({
      id: 'tribeca',
      source_name: 'The Verge AI',
      score: 8,
      original_title: 'A $2,000 AI-generated film will make its debut at Tribeca',
    }),
    article({
      id: 'anthropic-crunchbase',
      source_name: 'Crunchbase News',
      score: 6,
      original_title: 'Anthropic Nears $1T Valuation With $65B Funding Round',
      ru_title: 'Оценка Anthropic достигла $965 млрд после раунда на $65 млрд',
    }),
    article({
      id: 'mistral',
      source_name: 'The Decoder',
      score: 6,
      original_title: "Mistral rebrands LeChat as Vibe, betting its chatbot's future is as a full-blown work agent",
    }),
    article({
      id: 'google',
      source_name: 'Google Research Blog',
      score: 5,
      original_title: 'A New Era of Innovation: Google Research at I/O 2026',
      ru_title: 'Google представила Gemini for Science и другие ИИ-инструменты на I/O 2026',
    }),
    article({
      id: 'anthropic-techcrunch',
      source_name: 'TechCrunch AI',
      score: 5,
      original_title: 'Anthropic raises $65 Billion, nears $1T valuation ahead of IPO',
      ru_title: 'Anthropic привлёк $65 млрд при оценке почти $1 трлн',
    }),
    article({
      id: 'habr',
      source_name: 'Habr AI',
      score: 5,
      original_title: 'Gemini-3.5-flash догнал GPT-5.5 на 97/S и в 2.5× дешевле',
    }),
  ]

  const { articles, diagnostics } = selectDigestArticles(candidates)

  assert.deepEqual(
    articles.map((item) => item.id),
    ['tribeca', 'anthropic-crunchbase', 'mistral', 'google', 'habr'],
  )
  assert.equal(diagnostics.skipped.find((item) => item.articleId === 'anthropic-techcrunch')?.reason, 'duplicate_story')
  assert.equal(validateDigestComposition(articles).ok, true)
})

test('selectDigestArticles drops a strong story sent in a recent successful digest', () => {
  const recent = [
    article({
      id: 'yesterday-anthropic',
      source_name: 'Crunchbase News',
      original_title: 'Anthropic Nears $1T Valuation With $65B Funding Round',
      ru_title: 'Оценка Anthropic достигла $965 млрд после раунда на $65 млрд',
    }),
  ]
  const candidates = [
    article({
      id: 'decoder-anthropic',
      source_name: 'The Decoder',
      score: 6,
      original_title: 'Claude company Anthropic nears a trillion-dollar valuation after raising $65 billion in Series H',
      ru_title: 'Anthropic привлекла $65 млрд в раунде Series H при оценке почти $1 трлн',
    }),
    article({
      id: 'claude-opus',
      source_name: 'The Decoder',
      score: 6,
      original_title: 'Anthropic ships Claude Opus 4.8 as a modest but tangible improvement',
      ru_title: 'Claude Opus 4.8 обходит GPT-5.5 в большинстве тестов',
    }),
    article({
      id: 'groq',
      source_name: 'TechCrunch AI',
      score: 5,
      original_title: 'After Nvidia’s $20B not-aqui-hire, AI chip startup Groq reportedly raising $650M',
      ru_title: 'Groq привлекает $650 млн после сделки с Nvidia на $20 млрд',
    }),
  ]

  const { articles, diagnostics } = selectDigestArticles(candidates, recent)

  assert.deepEqual(articles.map((item) => item.id), ['claude-opus', 'groq'])
  assert.equal(diagnostics.skipped[0]?.reason, 'recent_story_duplicate')
  assert.equal(diagnostics.skipped[0]?.storyKey, 'anthropic:funding:65b')
})

test('selectDigestArticles caps strong primary entity concentration while allowing two different events', () => {
  const candidates = [
    article({
      id: 'anthropic-funding',
      source_name: 'Crunchbase News',
      original_title: 'Anthropic raises $65 Billion, nears $1T valuation ahead of IPO',
    }),
    article({
      id: 'claude-opus',
      source_name: 'The Decoder',
      original_title: 'Anthropic ships Claude Opus 4.8 as a modest but tangible improvement',
    }),
    article({
      id: 'claude-security',
      source_name: 'ZDNet AI',
      original_title: 'Claude Opus 4.8 misalignment study reveals new safety behavior',
    }),
    article({
      id: 'groq',
      source_name: 'TechCrunch AI',
      original_title: 'After Nvidia’s $20B not-aqui-hire, AI chip startup Groq reportedly raising $650M',
    }),
  ]

  const { articles, diagnostics } = selectDigestArticles(candidates, [], { perPrimaryEntityCap: 2 })

  assert.deepEqual(articles.map((item) => item.id), ['anthropic-funding', 'claude-opus', 'groq'])
  assert.equal(diagnostics.skipped.find((item) => item.articleId === 'claude-security')?.reason, 'primary_entity_cap')
})
