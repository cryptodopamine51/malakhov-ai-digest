#!/usr/bin/env sh
# Proves the self-hosted REST/RPC boundary without printing API keys or bodies.
set -eu

FOUNDATION=${FOUNDATION:-/srv/malakhov-ai-digest/supabase-source/docker}
NETWORK=${SUPABASE_DOCKER_NETWORK:-supabase_default}
test -r "$FOUNDATION/.env"
env_value() { sed -n "s/^$1=//p" "$FOUNDATION/.env" | tail -n 1; }
ANON_KEY=$(env_value ANON_KEY)
SERVICE_ROLE_KEY=$(env_value SERVICE_ROLE_KEY)
test -n "$ANON_KEY"
test -n "$SERVICE_ROLE_KEY"
export ANON_KEY SERVICE_ROLE_KEY

docker run --rm -i --network "$NETWORK" \
  -e ANON_KEY -e SERVICE_ROLE_KEY \
  node:22.16.0-bookworm-slim node - <<'NODE'
const root = 'http://kong:8000/rest/v1'
const anon = process.env.ANON_KEY
const service = process.env.SERVICE_ROLE_KEY
if (!anon || !service) throw new Error('required API key is missing')

async function request(label, path, key, options = {}, allowed) {
  const response = await fetch(`${root}${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  console.log(`${label}=${response.status}`)
  if (!allowed.includes(response.status)) throw new Error(`${label}: unexpected HTTP ${response.status}`)
  return response
}

const fixtureId = '11111111-1111-4111-8111-111111111111'
const fixtureUrl = 'https://staging.invalid/api-role-fixture'
const live = await request('anon_live_read', '/articles?select=id&published=eq.true&quality_ok=eq.true&verified_live=eq.true&publish_status=eq.live&limit=1', anon, {}, [200])
if ((await live.json()).length !== 1) throw new Error('anon live read did not return a row')
const categories = await request('anon_active_categories_read', '/categories?select=slug&is_active=eq.true&limit=1', anon, {}, [200])
if ((await categories.json()).length !== 1) throw new Error('anon active category read did not return a row')
await request('anon_insert_denied', '/articles', anon, { method: 'POST', body: JSON.stringify({ id: fixtureId, original_url: fixtureUrl }) }, [401, 403])
await request('anon_category_insert_denied', '/categories', anon, { method: 'POST', body: JSON.stringify({ slug: 'iteration-3-denied', name_ru: 'denied', order_index: 999 }) }, [401, 403])
await request('anon_rpc_denied', '/rpc/publish_article', anon, { method: 'POST', body: JSON.stringify({ p_article_id: fixtureId, p_verifier: 'iteration2' }) }, [401, 403, 404])
await request('service_cleanup_before', `/articles?id=eq.${fixtureId}`, service, { method: 'DELETE' }, [204])
await request('service_insert', '/articles', service, {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ id: fixtureId, original_url: fixtureUrl, original_title: 'API role fixture', source_name: 'Iteration 2', source_lang: 'en', primary_category: 'ai-industry', publish_status: 'draft' }),
}, [201])
const rpc = await request('service_rpc', '/rpc/publish_article', service, { method: 'POST', body: JSON.stringify({ p_article_id: fixtureId, p_verifier: 'iteration2' }) }, [200])
await rpc.json()
await request('service_cleanup_after', `/articles?id=eq.${fixtureId}`, service, { method: 'DELETE' }, [204])
console.log('api_roles=passed service_key_logged=false')
NODE
