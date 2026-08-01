#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
RELEASE=${RELEASE:-$(cd "$(dirname "$0")/../.." && pwd)}
FOUNDATION=${FOUNDATION:-$ROOT/supabase-source/docker}
SOURCE_SECRETS=${SOURCE_SECRETS:-$ROOT/secrets/web-runtime.env}
APP_ENV=$ROOT/secrets/app-production.env
COMPOSE_FILE=$RELEASE/infra/vps/production-compose.yml
RELEASE_ID=${RELEASE_ID:-$(basename "$RELEASE")}
BUILD_PROXY_NAME=${BUILD_PROXY_NAME:-malakhov-digest-build-api}
BUILD_PROXY_PORT=${BUILD_PROXY_PORT:-18080}

test "$(id -u)" = 0
test -r "$FOUNDATION/.env"
test -r "$SOURCE_SECRETS"
test -f "$COMPOSE_FILE"
case "$RELEASE" in "$ROOT"/releases/*) ;; *) printf '%s\n' 'deploy=blocked reason=release_path' >&2; exit 64 ;; esac

# Release trees are versioned and root-owned. Containers receive only the
# read-only Caddyfile mount; the application image is built from this snapshot.
chown -R root:root "$RELEASE"
chmod -R go-w "$RELEASE"

umask 077
install -d -m 700 "$ROOT/secrets" "$ROOT/releases"

env_value() {
  key=$1
  file=$2
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

ANON_KEY=$(env_value ANON_KEY "$FOUNDATION/.env")
SERVICE_ROLE_KEY=$(env_value SERVICE_ROLE_KEY "$FOUNDATION/.env")
test -n "$ANON_KEY"
test -n "$SERVICE_ROLE_KEY"

HEALTH_TOKEN=$(env_value HEALTH_TOKEN "$APP_ENV" 2>/dev/null || true)
PUBLISH_VERIFY_SECRET=$(env_value PUBLISH_VERIFY_SECRET "$APP_ENV" 2>/dev/null || true)
CRON_SECRET=$(env_value CRON_SECRET "$APP_ENV" 2>/dev/null || true)
test -n "$HEALTH_TOKEN" || HEALTH_TOKEN=$(openssl rand -hex 32)
test -n "$PUBLISH_VERIFY_SECRET" || PUBLISH_VERIFY_SECRET=$(openssl rand -hex 32)
test -n "$CRON_SECRET" || CRON_SECRET=$(openssl rand -hex 32)

R2_PUBLIC_BASE_URL=$(env_value R2_PUBLIC_BASE_URL "$SOURCE_SECRETS")
TELEGRAM_BOT_TOKEN=$(env_value TELEGRAM_BOT_TOKEN "$SOURCE_SECRETS")
TELEGRAM_ADMIN_CHAT_ID=$(env_value TELEGRAM_ADMIN_CHAT_ID "$SOURCE_SECRETS")
TELEGRAM_CHANNEL_ID=$(env_value TELEGRAM_CHANNEL_ID "$SOURCE_SECRETS")
NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=$(env_value NEXT_PUBLIC_TELEGRAM_CHANNEL_URL "$SOURCE_SECRETS")
test -n "$R2_PUBLIC_BASE_URL"
test -n "$TELEGRAM_BOT_TOKEN"

{
  printf 'APP_RELEASE_ID=%s\n' "$RELEASE_ID"
  printf 'APP_ENV_FILE=%s\n' "$APP_ENV"
  printf 'SUPABASE_DOCKER_NETWORK=supabase_default\n'
  printf 'BUILD_SUPABASE_URL=http://127.0.0.1:%s\n' "$BUILD_PROXY_PORT"
  printf 'SUPABASE_URL=http://kong:8000\n'
  printf 'SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
  printf 'SUPABASE_SERVICE_KEY=%s\n' "$SERVICE_ROLE_KEY"
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://news.malakhovai.ru\n'
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
  printf 'NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru\n'
  printf 'R2_PUBLIC_BASE_URL=%s\n' "$R2_PUBLIC_BASE_URL"
  printf 'NEXT_PUBLIC_R2_PUBLIC_BASE_URL=%s\n' "$R2_PUBLIC_BASE_URL"
  printf 'NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=%s\n' "$NEXT_PUBLIC_TELEGRAM_CHANNEL_URL"
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN"
  printf 'TELEGRAM_ADMIN_CHAT_ID=%s\n' "$TELEGRAM_ADMIN_CHAT_ID"
  printf 'TELEGRAM_CHANNEL_ID=%s\n' "$TELEGRAM_CHANNEL_ID"
  printf 'HEALTH_TOKEN=%s\n' "$HEALTH_TOKEN"
  printf 'PUBLISH_VERIFY_SECRET=%s\n' "$PUBLISH_VERIFY_SECRET"
  printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  printf 'APP_ENV=production\n'
  printf 'BOT_POLLING_ENABLED=false\n'
  printf 'INGESTION_SCHEDULER_ENABLED=false\n'
  printf 'PROCESS_EVENTS_SCHEDULER_ENABLED=false\n'
} > "$APP_ENV"
chmod 600 "$APP_ENV"

cleanup_build_proxy() {
  docker rm -f "$BUILD_PROXY_NAME" >/dev/null 2>&1 || true
}
trap cleanup_build_proxy EXIT INT TERM
cleanup_build_proxy
docker run -d --rm \
  --name "$BUILD_PROXY_NAME" \
  --network supabase_default \
  -p "127.0.0.1:${BUILD_PROXY_PORT}:${BUILD_PROXY_PORT}" \
  caddy:2.10.2-alpine \
  caddy reverse-proxy --from ":${BUILD_PROXY_PORT}" --to kong:8000 \
    --change-host-header >/dev/null
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 -o /dev/null \
    -H "apikey: $ANON_KEY" \
    "http://127.0.0.1:${BUILD_PROXY_PORT}/rest/v1/categories?select=slug&limit=1"; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 2 -o /dev/null \
  -H "apikey: $ANON_KEY" \
  "http://127.0.0.1:${BUILD_PROXY_PORT}/rest/v1/categories?select=slug&limit=1"

cd "$RELEASE/infra/vps"
docker compose --project-name malakhov-digest-production --env-file "$APP_ENV" \
  -f production-compose.yml config >/dev/null
docker compose --project-name malakhov-digest-production --env-file "$APP_ENV" \
  -f production-compose.yml up -d --build --wait --wait-timeout 360 --force-recreate
cleanup_build_proxy

docker exec malakhov-digest-production-app node -e \
  "const u=new URL('http://127.0.0.1:3000/api/health');u.searchParams.set('token',process.env.HEALTH_TOKEN);fetch(u).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ln -sfn "$RELEASE" "$ROOT/app-current"
printf 'production_deploy=passed release=%s values_logged=false\n' "$RELEASE_ID"
