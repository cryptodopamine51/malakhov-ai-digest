#!/usr/bin/env sh
set -eu

root=/srv/malakhov-ai-digest
infra="$root/infra/vps"
source="$root/supabase-source"
compose="$source/docker"
commit=949a57d2854b7fcadc0d621cb7fffa167506d581

test "$(id -u)" = 0
test -f "$infra/LOCK.json"
command -v docker >/dev/null
docker compose version >/dev/null

install -d -m 700 "$root" "$root/recovery" "$root/backups"
if [ ! -d "$source/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/supabase/supabase.git "$source"
fi
git -C "$source" fetch --depth=1 origin "$commit"
git -C "$source" checkout --detach "$commit"
test "$(git -C "$source" rev-parse HEAD)" = "$commit"

if [ ! -f "$compose/.env" ]; then
  cp "$compose/.env.example" "$compose/.env"
  chmod 600 "$compose/.env"
  (cd "$compose" && sh utils/generate-keys.sh --update-env >/dev/null)
fi
chmod 600 "$compose/.env"
cp "$infra/docker-compose.override.yml" "$compose/docker-compose.malakhov.yml"
chmod 600 "$compose/docker-compose.malakhov.yml"

set_env() {
  key=$1
  value=$2
  if grep -q "^${key}=" "$compose/.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$compose/.env"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$compose/.env"
  fi
}

set_env COMPOSE_FILE 'docker-compose.yml:docker-compose.malakhov.yml'
set_env SUPABASE_PUBLIC_URL 'http://127.0.0.1:8000'
set_env API_EXTERNAL_URL 'http://127.0.0.1:8000/auth/v1'
set_env SITE_URL 'https://news.malakhovai.ru'
set_env ADDITIONAL_REDIRECT_URLS ''
set_env KONG_HTTP_PORT '127.0.0.1:8000'
set_env KONG_HTTPS_PORT '127.0.0.1:8443'
set_env POOLER_DEFAULT_POOL_SIZE '12'
set_env POOLER_MAX_CLIENT_CONN '60'
set_env POOLER_DB_POOL_SIZE '4'
set_env POOLER_TENANT_ID 'malakhov-ai-digest'
set_env DISABLE_SIGNUP 'true'
set_env ENABLE_EMAIL_SIGNUP 'false'
set_env ENABLE_PHONE_SIGNUP 'false'
set_env ENABLE_ANONYMOUS_USERS 'false'
set_env FUNCTIONS_VERIFY_JWT 'true'

(cd "$compose" && docker compose config >/dev/null)
printf '%s\n' "foundation prepared: release=v1.26.07 commit=$commit compose=$compose"
