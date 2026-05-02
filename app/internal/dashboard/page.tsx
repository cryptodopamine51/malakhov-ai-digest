import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getAdminClient } from '../../../lib/supabase'
import {
  firstSearchParam,
  getInternalDashboardData,
  isInternalDashboardAuthorized,
  type DashboardAlertRow,
  type DashboardDigestRunRow,
  type DashboardRecentLiveRow,
  type DashboardStuckBatchItemRow,
} from '../../../lib/internal-dashboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Internal dashboard',
  robots: { index: false, follow: false },
}

type DashboardSearchParams = Promise<{ token?: string | string[] }>

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('ru-RU').format(value)
}

function shortText(value: string | null | undefined, max = 90): string {
  if (!value) return '-'
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value === 'critical' || value.startsWith('failed')
      ? 'border-red-300 text-red-700'
      : value === 'warning' || value === 'open'
        ? 'border-amber-300 text-amber-700'
        : 'border-line text-muted'

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {value}
    </span>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-5 text-center text-sm text-muted">
        Нет данных
      </td>
    </tr>
  )
}

function HealthCards({ data }: { data: Awaited<ReturnType<typeof getInternalDashboardData>>['health'] }) {
  const cards = [
    ['Open alerts', data.alerts_open],
    ['Open batches', data.batches_open],
    ['Oldest pending, min', data.oldest_pending_age_minutes],
    ['Published today', data.articles_published_today],
    ['Live 6h', data.live_window_6h_count],
    ['Cost today, USD', data.cost_today_usd],
  ] as const

  return (
    <section id="health-cards" className="border-t border-line py-6">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-xl font-bold text-ink">Health</h2>
        <span className="text-xs text-muted">server {formatDateTime(data.server_time)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-base p-3">
            <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-2 font-mono text-lg font-semibold text-ink">{formatNumber(value)}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded border border-line p-3">
          <div className="text-muted">Ingest</div>
          <div className="mt-1 text-ink">{data.ingest?.status ?? '-'}</div>
          <div className="mt-1 text-xs text-muted">{formatDateTime(data.ingest?.finished_at)}</div>
        </div>
        <div className="rounded border border-line p-3">
          <div className="text-muted">Enrich</div>
          <div className="mt-1 text-ink">{data.enrich?.status ?? '-'} {data.enrich?.run_kind ?? ''}</div>
          <div className="mt-1 text-xs text-muted">{formatDateTime(data.enrich?.finished_at)}</div>
        </div>
        <div className="rounded border border-line p-3">
          <div className="text-muted">Digest</div>
          <div className="mt-1 text-ink">{data.digest?.status ?? '-'}</div>
          <div className="mt-1 text-xs text-muted">{data.digest?.digest_date ?? '-'} · {formatDateTime(data.digest?.sent_at)}</div>
        </div>
      </div>
    </section>
  )
}

function AlertsTable({ rows }: { rows: DashboardAlertRow[] }) {
  return (
    <section id="alerts-table" className="border-t border-line py-6">
      <h2 className="mb-3 font-serif text-xl font-bold text-ink">Alerts</h2>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Count</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <EmptyRow colSpan={6} /> : rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2"><StatusPill value={row.status} /></td>
                <td className="px-3 py-2 font-mono text-xs">{row.alert_type}</td>
                <td className="px-3 py-2"><StatusPill value={row.severity} /></td>
                <td className="px-3 py-2 font-mono">{row.occurrence_count}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.last_seen_at)}</td>
                <td className="px-3 py-2">{shortText(row.message)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StuckBatchesTable({ rows }: { rows: DashboardStuckBatchItemRow[] }) {
  return (
    <section id="stuck-batches-table" className="border-t border-line py-6">
      <h2 className="mb-3 font-serif text-xl font-bold text-ink">Stuck Batch Items</h2>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Article</th>
              <th className="px-3 py-2">Batch item</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <EmptyRow colSpan={5} /> : rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                <td className="px-3 py-2"><StatusPill value={row.status} /></td>
                <td className="px-3 py-2 font-mono text-xs">{row.article_id}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                <td className="px-3 py-2">{row.error_code ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RecentLiveTable({ rows }: { rows: DashboardRecentLiveRow[] }) {
  return (
    <section id="recent-live-table" className="border-t border-line py-6">
      <h2 className="mb-3 font-serif text-xl font-bold text-ink">Recent Live</h2>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[840px] border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Published</th>
              <th className="px-3 py-2">Verified</th>
              <th className="px-3 py-2">Lag min</th>
              <th className="px-3 py-2">Verifier</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Title</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <EmptyRow colSpan={6} /> : rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.published_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.verified_live_at)}</td>
                <td className="px-3 py-2 font-mono">{formatNumber(row.publish_lag_minutes)}</td>
                <td className="px-3 py-2">{row.last_publish_verifier ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.slug ?? '-'}</td>
                <td className="px-3 py-2">{shortText(row.ru_title, 80)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DigestsTable({ rows }: { rows: DashboardDigestRunRow[] }) {
  return (
    <section id="digest-runs-table" className="border-t border-line py-6">
      <h2 className="mb-3 font-serif text-xl font-bold text-ink">Digest Runs</h2>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Articles</th>
              <th className="px-3 py-2">Sent</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <EmptyRow colSpan={6} /> : rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                <td className="px-3 py-2">{row.digest_date ?? '-'}</td>
                <td className="px-3 py-2"><StatusPill value={row.status} /></td>
                <td className="px-3 py-2 font-mono">{formatNumber(row.articles_count)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.sent_at)}</td>
                <td className="px-3 py-2">{shortText(row.error_message, 80)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function InternalDashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams
}) {
  const [resolvedSearchParams, requestHeaders] = await Promise.all([searchParams, headers()])
  const queryToken = firstSearchParam(resolvedSearchParams.token)
  const headerToken = requestHeaders.get('x-health-token')

  if (!isInternalDashboardAuthorized({
    expectedToken: process.env.HEALTH_TOKEN,
    queryToken,
    headerToken,
  })) {
    notFound()
  }

  const data = await getInternalDashboardData(getAdminClient())

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:py-10">
      <meta httpEquiv="refresh" content="60" />
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-ink">Internal Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Moscow time, auto-refresh 60s</p>
        </div>
        <div className="text-sm text-muted">Updated {formatDateTime(data.health.server_time)}</div>
      </div>

      <HealthCards data={data.health} />
      <AlertsTable rows={data.alerts} />
      <StuckBatchesTable rows={data.stuckBatchItems} />
      <RecentLiveTable rows={data.recentLive} />
      <DigestsTable rows={data.digestRuns} />
    </div>
  )
}
