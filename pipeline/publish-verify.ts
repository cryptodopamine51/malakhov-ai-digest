/**
 * pipeline/publish-verify.ts
 *
 * Verifies that publish_ready articles are actually live on the site.
 * Transitions: publish_ready → verifying → live | (retry → publish_ready) | verification_failed
 *
 * An article is only marked verification_failed after MAX_VERIFY_ATTEMPTS consecutive failures.
 * Transient network errors reset the article to publish_ready for the next run.
 *
 * Запуск: npm run publish-verify
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { fireAlert } from './alerts'

const BATCH_SIZE = 30
const VERIFY_TIMEOUT_MS = 5_000
const CONCURRENCY = 5
const MAX_VERIFY_ATTEMPTS = 3

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkLive(
  siteUrl: string,
  slug: string,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
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

interface CheckResult {
  article: Article
  ok: boolean
  status: number | null
  error: string | null
}

async function verifyChunk(articles: Article[], siteUrl: string): Promise<CheckResult[]> {
  return Promise.all(
    articles.map(async (article) => {
      if (!article.slug) return { article, ok: false, status: null, error: 'no slug' }
      const { ok, status, error } = await checkLive(siteUrl, article.slug)
      return { article, ok, status, error }
    })
  )
}

async function countVerifyAttempts(
  supabase: ReturnType<typeof getServerClient>,
  articleId: string,
): Promise<number> {
  const { count } = await supabase
    .from('article_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('article_id', articleId)
    .eq('stage', 'verify')
  return count ?? 0
}

async function writeVerifyAttempt(
  supabase: ReturnType<typeof getServerClient>,
  articleId: string,
  resultStatus: 'ok' | 'retryable' | 'failed',
  errorMessage?: string,
): Promise<void> {
  const { count: attemptNo } = await supabase
    .from('article_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('article_id', articleId)
    .eq('stage', 'verify')

  await supabase.from('article_attempts').insert({
    article_id: articleId,
    stage: 'verify',
    attempt_no: (attemptNo ?? 0) + 1,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    result_status: resultStatus,
    error_code: resultStatus !== 'ok' ? 'fetch_failed' : null,
    error_message: errorMessage ?? null,
    payload: {},
  })
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

  // Articles waiting for first or subsequent verification
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

  // Spot-check already-live articles (oldest verified first) for regressions
  const { data: liveSample } = await supabase
    .from('articles')
    .select('*')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .not('slug', 'is', null)
    .order('verified_live_at', { ascending: true })
    .limit(5)

  const newCandidates = (candidates ?? []) as Article[]
  const liveCheck = (liveSample ?? []) as Article[]
  const toVerify = [...newCandidates, ...liveCheck]

  if (!toVerify.length) {
    log('Нет статей для проверки')
    return
  }

  log(`Проверяем: ${newCandidates.length} новых + ${liveCheck.length} live-sample`)

  // Mark new candidates as verifying
  if (newCandidates.length) {
    await supabase
      .from('articles')
      .update({ publish_status: 'verifying', updated_at: now })
      .in('id', newCandidates.map((a) => a.id))
      .eq('publish_status', 'publish_ready')
  }

  // Process in chunks of CONCURRENCY
  let verifiedLive = 0
  let resetToReady = 0
  let markedFailed = 0
  let regressions = 0

  for (let i = 0; i < toVerify.length; i += CONCURRENCY) {
    const chunk = toVerify.slice(i, i + CONCURRENCY)
    const results = await verifyChunk(chunk, siteUrl)

    for (const { article, ok, status, error } of results) {
      const isLiveSample = article.publish_status === 'live'

      if (ok) {
        if (!isLiveSample) {
          await supabase
            .from('articles')
            .update({
              publish_status: 'live',
              verified_live: true,
              verified_live_at: now,
              live_check_error: null,
              updated_at: now,
            })
            .in('id', [article.id])
          await writeVerifyAttempt(supabase, article.id, 'ok')
          verifiedLive++
          log(`✓ live: /articles/${article.slug}`)
        }
        // live sample passed — nothing to update
      } else if (isLiveSample) {
        // Previously-live article is now unreachable — regression
        await supabase
          .from('articles')
          .update({
            publish_status: 'verification_failed',
            verified_live: false,
            live_check_error: `regression: ${status ?? error}`,
            updated_at: now,
          })
          .eq('id', article.id)

        await fireAlert({
          supabase,
          alertType: 'publish_verify_failed',
          severity: 'critical',
          entityKey: article.slug ?? article.id,
          message: `Regression: ранее опубликованная статья стала недоступна: /articles/${article.slug} [${status ?? error}]`,
          payload: { articleId: article.id, slug: article.slug, status, error },
          botToken,
          adminChatId,
        })
        regressions++
        log(`✗ regression: /articles/${article.slug} [${status ?? error}]`)
      } else {
        // New article failed verify — check attempt history
        const prevAttempts = await countVerifyAttempts(supabase, article.id)
        const errorMsg = `HEAD returned ${status ?? error}`

        await writeVerifyAttempt(supabase, article.id, 'retryable', errorMsg)

        if (prevAttempts + 1 < MAX_VERIFY_ATTEMPTS) {
          // Not exhausted yet — reset to publish_ready for next run
          await supabase
            .from('articles')
            .update({
              publish_status: 'publish_ready',
              live_check_error: `attempt ${prevAttempts + 1}/${MAX_VERIFY_ATTEMPTS}: ${errorMsg}`,
              updated_at: now,
            })
            .eq('id', article.id)
          resetToReady++
          log(`↻ retry (${prevAttempts + 1}/${MAX_VERIFY_ATTEMPTS}): /articles/${article.slug}`)
        } else {
          // Exhausted — mark permanently failed and alert
          await supabase
            .from('articles')
            .update({
              publish_status: 'verification_failed',
              verified_live: false,
              live_check_error: `failed after ${MAX_VERIFY_ATTEMPTS} attempts: ${errorMsg}`,
              updated_at: now,
            })
            .eq('id', article.id)

          await fireAlert({
            supabase,
            alertType: 'publish_verify_failed',
            severity: 'warning',
            entityKey: article.slug ?? article.id,
            message: `Статья недоступна после ${MAX_VERIFY_ATTEMPTS} попыток: /articles/${article.slug}`,
            payload: { articleId: article.id, slug: article.slug, attempts: MAX_VERIFY_ATTEMPTS },
            botToken,
            adminChatId,
          })
          markedFailed++
          log(`✗ verification_failed (exhausted): /articles/${article.slug}`)
        }
      }
    }
  }

  log('─────────────────────────────────────')
  log(`Verified live:  ${verifiedLive}`)
  log(`Reset to ready: ${resetToReady}`)
  log(`Failed:         ${markedFailed}`)
  log(`Regressions:    ${regressions}`)
  log('=== publish-verify.ts завершён ===')
}

publishVerify().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
