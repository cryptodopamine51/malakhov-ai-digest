import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getAllArticlesForSitemap } from '../../lib/articles'

test('getAllArticlesForSitemap paginates through all sitemap article pages', async () => {
  const pages = [
    [
      {
        slug: 'newer-story',
        primary_category: 'ai-industry',
        updated_at: '2026-06-10T12:00:00.000Z',
      },
      {
        slug: 'legacy-story-a1b2c3',
        primary_category: 'ai-labs',
        updated_at: '2026-06-10T11:00:00.000Z',
      },
    ],
    [
      {
        slug: 'legacy-story',
        primary_category: 'ai-labs',
        updated_at: '2026-06-09T10:00:00.000Z',
      },
      {
        slug: null,
        primary_category: 'coding',
        updated_at: '2026-06-09T09:00:00.000Z',
      },
    ],
    [
      {
        slug: 'oldest-story',
        primary_category: null,
        updated_at: '2026-06-08T08:00:00.000Z',
      },
    ],
  ]
  const ranges: Array<[number, number]> = []

  const articles = await getAllArticlesForSitemap({
    pageSize: 2,
    fetchPage: async (from, to) => {
      ranges.push([from, to])
      return {
        data: pages.shift() ?? [],
        error: null,
      }
    },
  })

  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
    [4, 5],
  ])
  assert.deepEqual(articles, [
    {
      slug: 'newer-story',
      primaryCategory: 'ai-industry',
      updated_at: '2026-06-10T12:00:00.000Z',
    },
    {
      slug: 'legacy-story',
      primaryCategory: 'ai-labs',
      updated_at: '2026-06-10T11:00:00.000Z',
    },
    {
      slug: 'oldest-story',
      primaryCategory: '',
      updated_at: '2026-06-08T08:00:00.000Z',
    },
  ])
})

test('getAllArticlesForSitemap returns an empty list on Supabase page error', async () => {
  const articles = await getAllArticlesForSitemap({
    pageSize: 2,
    fetchPage: async () => ({
      data: null,
      error: { message: 'boom' },
    }),
  })

  assert.deepEqual(articles, [])
})
