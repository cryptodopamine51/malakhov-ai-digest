#!/usr/bin/env sh
# Builds a private, production-equivalent Next.js staging runtime on the VPS.
# The resulting Caddy listener is 127.0.0.1:8088 only; access it via SSH tunnel.
set -eu

ROOT=${ROOT:-/srv/malakhov-ai-digest/app-staging}
FOUNDATION=${FOUNDATION:-/srv/malakhov-ai-digest/supabase-source/docker}
ENV_FILE="$ROOT/infra/vps/.staging.env"

test -r "$FOUNDATION/.env"
test -f "$ROOT/infra/vps/staging-compose.yml"

# The upstream .env allows unquoted human-readable values, so it is not safe to
# source as shell code. Read only the two key values needed here.
env_value() { sed -n "s/^$1=//p" "$FOUNDATION/.env" | tail -n 1; }
ANON_KEY=$(env_value ANON_KEY)
SERVICE_ROLE_KEY=$(env_value SERVICE_ROLE_KEY)
test -n "$ANON_KEY"
test -n "$SERVICE_ROLE_KEY"
HEALTH_TOKEN=$(sed -n 's/^HEALTH_TOKEN=//p' "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
if test -z "$HEALTH_TOKEN"; then HEALTH_TOKEN=$(openssl rand -hex 32); fi
# The upstream values stay root-only and are copied only into root-owned runtime
# env. Public values are intentionally distinct from the internal server URL.
umask 077
{
  printf 'SUPABASE_URL=http://kong:8000\n'
  printf 'SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
  printf 'SUPABASE_SERVICE_KEY=%s\n' "$SERVICE_ROLE_KEY"
  printf 'NEXT_PUBLIC_SUPABASE_URL=http://localhost:8088\n'
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
  printf 'NEXT_PUBLIC_SITE_URL=http://localhost:8088\n'
  printf 'SUPABASE_DOCKER_NETWORK=supabase_default\n'
  printf 'APP_ENV=staging\n'
  printf 'BOT_POLLING_ENABLED=false\n'
  printf 'INGESTION_SCHEDULER_ENABLED=false\n'
  printf 'PROCESS_EVENTS_SCHEDULER_ENABLED=false\n'
  printf 'HEALTH_TOKEN=%s\n' "$HEALTH_TOKEN"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

cd "$ROOT/infra/vps"
docker compose --project-name malakhov-digest-staging --env-file .staging.env -f staging-compose.yml up -d --build --wait --force-recreate
docker compose --project-name malakhov-digest-staging --env-file .staging.env -f staging-compose.yml ps
curl -fsS "http://127.0.0.1:8088/api/health?token=$HEALTH_TOKEN" >/dev/null
printf '%s\n' 'staging=passed url=http://127.0.0.1:8088 ssh_tunnel="ssh -L 8088:127.0.0.1:8088 root@195.245.239.84"'
