/**
 * pipeline/publish-verify.ts
 *
 * Verifies that publish_ready articles are actually live on the site.
 * Transitions: publish_ready → verifying → live | verification_failed
 *
 * Запуск: npm run publish-verify
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { fireAlert } from './alerts'

const BATCH_SIZE = 30
const VERIFY_TIMEOUT_MS = 10_000
const CONCURRENCY = 5

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkLive(siteUrl: string, slug: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const url = `${siteUrl}/articles/${slug}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return { ok: res.ok, status: res.status, error: null }
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function verifyBatch(articles: Article[], siteUrl: string): Promise<{
  live: Article[]
  failed: Article[]
  noSlug: Article[]
}> {
  const live: Article[] = []
  const failed: Article[] = []
  const noSlug: Article[] = []

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const chunk = articles.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async (article) => {
        if (!article.slug) return { article, result: null }
        const result = await checkLive(siteUrl, article.slug)
        return { article, result }
      })
    )

    for (const { article, result } of results) {
      if (!result) {
        noSlug.push(article)
      } else if (result.ok) {
        live.push(article)
      } else {
        log(`✗ Verify failed [${result.status ?? 'err'}]: ${article.slug} — ${result.error ?? ''}`)
        failed.push(article)
      }
    }
  }

  return { live, failed, noSlug }
}

async function publishVerify(): Promise<void> {
  log('=== Запуск publish-verify.ts ===')

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  if (!siteUrl) {
    log('NEXT_PUBLIC_SITE_URL не задан — пропускаем verify')
    process.exit(0)
  }

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const now = new Date().toISOString()

  // Find articles ready for verification
  const { data: candidates, error: selectError } = await supabase
    .from('articles')
    .select('*')
    .eq('publish_status', 'publish_ready')
    .not('slug', 'is', null)
    .order('publish_ready_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (selectError) {
    log(`Ошибка выборки: ${selectError.message}`)
    process.exit(1)
  }

  // Also verify articles already marked live to catch unpublish/404 regressions
  const { data: liveSample } = await supabase
    .from('articles')
    .select('*')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .not('slug', 'is', null)
    .order('verified_live_at', { ascending: true })
    .limit(10)

  const toVerify = [...(candidates ?? []), ...(liveSample ?? [])] as Article[]

  if (!toVerify.length) {
    log('Нет статей для проверки')
    return
  }

  log(`Проверяем ${toVerify.length} статей на сайте ${siteUrl}`)

  // Mark all as verifying
  const candidateIds = (candidates ?? []).map((a) => (a as Article).id)
  if (candidateIds.length) {
    await supabase
      .from('articles')
      .update({ publish_status: 'verifying', updated_at: now })
      .in('id', candidateIds)
      .eq('publish_status', 'publish_ready')
  }

  const { live, failed, noSlug } = await verifyBatch(toVerify, siteUrl)

  // Update live articles
  if (live.length) {
    const liveIds = live.map((a) => a.id)
    await supabase
      .from('articles')
      .update({
        publish_status: 'live',
        verified_live: true,
        verified_live_at: now,
        live_check_error: null,
        updated_at: now,
      })
      .in('id', liveIds)
    log(`✓ Verified live: ${live.length} статей`)
  }

  // Update failed articles
  for (const article of failed) {
    await supabase
      .from('articles')
      .update({
        publish_status: 'verification_failed',
        verified_live: false,
        live_check_error: `HEAD ${siteUrl}/articles/${article.slug} returned non-2xx`,
        updated_at: now,
      })
      .eq('id', article.id)

    await fireAlert({
      supabase,
      alertType: 'publish_verify_failed',
      severity: 'warning',
      entityKey: article.slug ?? article.id,
      message: `Статья недоступна на сайте: /articles/${article.slug}`,
      payload: { articleId: article.id, slug: article.slug },
      botToken,
      adminChatId,
    })
  }

  // No slug — mark as failed
  if (noSlug.length) {
    const noSlugIds = noSlug.map((a) => a.id)
    await supabase
      .from('articles')
      .update({
        publish_status: 'verification_failed',
        verified_live: false,
        live_check_error: 'no slug',
        updated_at: now,
      })
      .in('id', noSlugIds)
    log(`⚠ No slug: ${noSlug.length} статей — помечены как verification_failed`)
  }

  log('─────────────────────────────────────')
  log(`Verified live:  ${live.length}`)
  log(`Failed:         ${failed.length}`)
  log(`No slug:        ${noSlug.length}`)
  log('=== publish-verify.ts завершён ===')
}

publishVerify().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
