/**
 * IndexNow key file. Required by the IndexNow protocol: the body of this URL
 * must equal the key sent in the ping payload, proving we control the domain.
 *
 * The key is intentionally public — IndexNow does not treat it as a secret.
 * Stored in the `INDEXNOW_KEY` env var so it can be rotated without a code
 * change. If the env var is missing the route returns 404, which makes
 * IndexNow reject our pings (and our `pingIndexNow()` helper short-circuits
 * to a no-op anyway).
 */

export const dynamic = 'force-static'
export const revalidate = 3600

export async function GET(): Promise<Response> {
  const key = process.env.INDEXNOW_KEY?.trim()
  if (!key) {
    return new Response('IndexNow key not configured', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  return new Response(key, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
