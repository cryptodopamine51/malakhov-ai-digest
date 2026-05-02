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

import { getServerClient, type Article, type PublishArticleResult } from '../lib/supabase'
import { fireAlert, resolveAlert } from './alerts'
import { buildVerifyUrl, getVerifyCandidateKind } from './publish-verify-utils'

const BATCH_SIZE = 30
const VERIFY_TIMEOUT_MS = 5_000
const CONCURRENCY = 5
const MAX_VERIFY_ATTEMPTS = 3
const PUBLISH_VERIFIER = 'publish-verify'

const PUBLISH_ARTICLE_RESULTS = new Set<PublishArticleResult>([
  'published_live',
  'rejected_quality',
  'rejected_unverified',
  'already_live',
  'not_eligible',
])

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkLive(
  siteUrl: string,
  slug: string,
  primaryCategory: string | null,
  candidateKind: ReturnType<typeof getVerifyCandidateKind>,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const url = `${buildVerifyUrl(siteUrl, slug, primaryCategory, candidateKind)}?v=${Date.now()}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    const headers: Record<string, string> = {}
    const internalVerifySecret = process.env.PUBLISH_VERIFY_SECRET
    if (candidateKind !== 'live_sample' && internalVerifySecret) {
      headers['x-publish-verify-secret'] = internalVerifySecret
    }
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, headers })
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
      const candidateKind = getVerifyCandidateKind(article)
      const { ok, status, error } = await checkLive(siteUrl, article.slug, article.primary_category, candidateKind)
      return { article, ok, status, error }
    })
  )
}

async function countVerifyAttempts(
  supabase: ReturnType<typeof getServerClient>,
  articleId: string,
  stage: 'verify' | 'verify_sample' = 'verify',
): Promise<number> {
  const { count } = await supabase
    .from('article_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('article_id', articleId)
    .eq('stage', stage)
  return count ?? 0
}

async function writeVerifyAttempt(
  supabase: ReturnType<typeof getServerClient>,
  articleId: string,
  attemptNo: number,
  resultStatus: 'ok' | 'retryable' | 'failed',
  errorMessage?: string,
  stage: 'verify' | 'verify_sample' = 'verify',
  errorCode = resultStatus !== 'ok' ? 'fetch_failed' : null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from('article_attempts').insert({
    article_id: articleId,
    stage,
    attempt_no: attemptNo,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    result_status: resultStatus,
    error_code: errorCode,
    error_message: errorMessage ?? null,
    payload,
  })
}

function isPublishArticleResult(value: unknown): value is PublishArticleResult {
  return typeof value === 'string' && PUBLISH_ARTICLE_RESULTS.has(value as PublishArticleResult)
}

function isPublishRpcBypassActive(): boolean {
  return process.env.PUBLISH_RPC_DISABLED === '1'
}

async function publishArticleViaRpc(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  now: string,
  botToken?: string,
  adminChatId?: string,
): Promise<PublishArticleResult> {
  if (isPublishRpcBypassActive()) {
    await fireAlert({
      supabase,
      alertType: 'publish_rpc_bypass_active',
      severity: 'warning',
      message: 'PUBLISH_RPC_DISABLED=1: publish-verify использует legacy update вместо RPC publish_article',
      payload: { articleId: article.id, slug: article.slug, verifier: PUBLISH_VERIFIER },
      botToken,
      adminChatId,
    })

    const { error } = await supabase
      .from('articles')
      .update({
        publish_status: 'live',
        verified_live: true,
        verified_live_at: now,
        live_check_error: null,
        updated_at: now,
      })
      .eq('id', article.id)

    if (error) {
      throw new Error(`legacy publish update failed: ${error.message}`)
    }

    return 'published_live'
  }

  const { data, error } = await supabase.rpc('publish_article', {
    p_article_id: article.id,
    p_verifier: PUBLISH_VERIFIER,
  })

  if (error) {
    throw new Error(`publish_article RPC failed: ${error.message}`)
  }

  if (!isPublishArticleResult(data)) {
    throw new Error(`publish_article RPC returned unexpected result: ${String(data)}`)
  }

  return data
}

async function markAlreadyLiveVerified(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  now: string,
): Promise<void> {
  if (article.verified_live === true) return

  const { error } = await supabase
    .from('articles')
    .update({
      verified_live: true,
      verified_live_at: now,
      live_check_error: null,
      last_publish_verifier: PUBLISH_VERIFIER,
      updated_at: now,
    })
    .eq('id', article.id)
    .eq('publish_status', 'live')

  if (error) {
    throw new Error(`already-live verification backfill failed: ${error.message}`)
  }
}

async function handlePublishTransitionFailure(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  result: PublishArticleResult,
  now: string,
  botToken?: string,
  adminChatId?: string,
): Promise<void> {
  const errorMessage = `publish_article returned ${result}`

  if (result === 'rejected_quality') {
    await supabase
      .from('articles')
      .update({
        publish_status: 'withdrawn',
        verified_live: false,
        live_check_error: errorMessage,
        updated_at: now,
      })
      .eq('id', article.id)

    await fireAlert({
      supabase,
      alertType: 'publish_verify_failed',
      severity: 'critical',
      entityKey: article.slug ?? article.id,
      message: `RPC отказал публикацию из-за quality_ok=false: /articles/${article.slug}`,
      payload: { articleId: article.id, slug: article.slug, transitionResult: result },
      botToken,
      adminChatId,
    })
    return
  }

  await supabase
    .from('articles')
    .update({
      live_check_error: errorMessage,
      updated_at: now,
    })
    .eq('id', article.id)
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

  const { data: legacyBackfill, error: legacySelectError } = await supabase
    .from('articles')
    .select('*')
    .eq('publish_status', 'live')
    .eq('published', true)
    .eq('quality_ok', true)
    .is('verified_live', null)
    .not('slug', 'is', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (legacySelectError) {
    log(`Ошибка выборки legacy verify backlog: ${legacySelectError.message}`)
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
  const legacyCandidates = (legacyBackfill ?? []) as Article[]
  const liveCheck = (liveSample ?? []) as Article[]
  const toVerify = [...newCandidates, ...legacyCandidates, ...liveCheck]

  if (!toVerify.length) {
    log('Нет статей для проверки')
    return
  }

  log(`Проверяем: ${newCandidates.length} новых + ${legacyCandidates.length} legacy + ${liveCheck.length} live-sample`)

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
      const candidateKind = getVerifyCandidateKind(article)
      const isLiveSample = candidateKind === 'live_sample'
      const isNewCandidate = candidateKind === 'new_candidate'

      if (ok) {
        if (!isLiveSample) {
          const prevAttempts = await countVerifyAttempts(supabase, article.id)
          let transitionResult: PublishArticleResult

          try {
            transitionResult = await publishArticleViaRpc(supabase, article, now, botToken, adminChatId)
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            await writeVerifyAttempt(
              supabase,
              article.id,
              prevAttempts + 1,
              'failed',
              errorMsg,
              'verify',
              'publish_rpc_error',
              { publish_transition_result: 'rpc_error' },
            )
            await fireAlert({
              supabase,
              alertType: 'publish_verify_failed',
              severity: 'critical',
              entityKey: article.slug ?? article.id,
              message: `RPC publish_article упал для /articles/${article.slug}: ${errorMsg}`,
              payload: { articleId: article.id, slug: article.slug, error: errorMsg },
              botToken,
              adminChatId,
            })
            markedFailed++
            log(`✗ publish_rpc_error: /articles/${article.slug} [${errorMsg}]`)
            continue
          }

          if (transitionResult === 'published_live' || transitionResult === 'already_live') {
            if (transitionResult === 'already_live') {
              await markAlreadyLiveVerified(supabase, article, now)
            }
            await writeVerifyAttempt(
              supabase,
              article.id,
              prevAttempts + 1,
              'ok',
              undefined,
              'verify',
              null,
              { publish_transition_result: transitionResult },
            )
            await resolveAlert(supabase, 'publish_verify_failed', article.slug ?? article.id)
            await resolveAlert(supabase, 'publish_verify_failed_warn', article.slug ?? article.id)
            if (transitionResult === 'published_live') {
              await resolveAlert(supabase, 'publish_rpc_bypass_active')
            }
            verifiedLive++
            log(`✓ ${transitionResult}: /articles/${article.slug}`)
          } else {
            await writeVerifyAttempt(
              supabase,
              article.id,
              prevAttempts + 1,
              'failed',
              `publish_article returned ${transitionResult}`,
              'verify',
              `publish_rpc_${transitionResult}`,
              { publish_transition_result: transitionResult },
            )
            await handlePublishTransitionFailure(supabase, article, transitionResult, now, botToken, adminChatId)
            markedFailed++
            log(`✗ ${transitionResult}: /articles/${article.slug}`)
          }
        } else {
          await resolveAlert(supabase, 'publish_verify_failed', article.slug ?? article.id)
          await resolveAlert(supabase, 'publish_verify_failed_warn', article.slug ?? article.id)
        }
      } else if (isLiveSample) {
        const prevSampleFails = await countVerifyAttempts(supabase, article.id, 'verify_sample')
        const errorMsg = `HEAD returned ${status ?? error}`

        if (prevSampleFails + 1 < MAX_VERIFY_ATTEMPTS) {
          await writeVerifyAttempt(
            supabase,
            article.id,
            prevSampleFails + 1,
            'retryable',
            errorMsg,
            'verify_sample',
          )
          log(`↻ live-sample retry (${prevSampleFails + 1}/${MAX_VERIFY_ATTEMPTS}): /articles/${article.slug}`)
          continue
        }

        // Previously-live article is unreachable after repeated samples — regression
        await writeVerifyAttempt(
          supabase,
          article.id,
          prevSampleFails + 1,
          'failed',
          errorMsg,
          'verify_sample',
        )
        await supabase
          .from('articles')
          .update({
            publish_status: 'verification_failed',
            verified_live: false,
            live_check_error: `regression after ${MAX_VERIFY_ATTEMPTS} samples: ${status ?? error}`,
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
        // New article or legacy backfill failed verify — check attempt history
        const prevAttempts = await countVerifyAttempts(supabase, article.id)
        const errorMsg = `HEAD returned ${status ?? error}`
        const exhausted = prevAttempts + 1 >= MAX_VERIFY_ATTEMPTS
        await writeVerifyAttempt(
          supabase,
          article.id,
          prevAttempts + 1,
          exhausted ? 'failed' : 'retryable',
          errorMsg,
        )

        if (!exhausted) {
          // Not exhausted yet — reset or keep in backlog for next run
          await supabase
            .from('articles')
            .update({
              publish_status: isNewCandidate ? 'publish_ready' : 'live',
              live_check_error: `attempt ${prevAttempts + 1}/${MAX_VERIFY_ATTEMPTS}: ${errorMsg}`,
              updated_at: now,
            })
            .eq('id', article.id)
          // Early warning — fires once per article, deduped 1h.
          // Critical alert still fires only on exhaustion below.
          await fireAlert({
            supabase,
            alertType: 'publish_verify_failed_warn',
            severity: 'warning',
            entityKey: article.slug ?? article.id,
            message: `Verify failed (попытка ${prevAttempts + 1}/${MAX_VERIFY_ATTEMPTS}): /articles/${article.slug} [${errorMsg}]`,
            payload: { articleId: article.id, slug: article.slug, attempts: prevAttempts + 1, errorMsg },
            botToken,
            adminChatId,
          })
          resetToReady++
          log(`↻ retry (${prevAttempts + 1}/${MAX_VERIFY_ATTEMPTS}): /articles/${article.slug} [${candidateKind}]`)
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
            severity: 'critical',
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
