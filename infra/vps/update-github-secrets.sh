#!/usr/bin/env bash
# Run from the operator Mac only after authoritative DNS and public TLS are green.
set -Eeuo pipefail

REPO=${REPO:-cryptodopamine51/malakhov-ai-digest}
SSH_HOST=${SSH_HOST:-root@195.245.239.84}
SSH_KEY=${SSH_KEY:-/Users/malast/.ssh/codex_malakhov_ai_vps}
ROOT=${ROOT:-/srv/malakhov-ai-digest}
FOUNDATION_ENV=$ROOT/supabase-source/docker/.env
APP_ENV=$ROOT/secrets/app-production.env
PUBLIC_URL=https://news.malakhovai.ru

command -v gh >/dev/null
gh auth status -h github.com >/dev/null
curl -fsS --max-time 15 "$PUBLIC_URL/api/feed?limit=1" \
  | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("total", 0) >= 741 else 1)'
printf '' | openssl s_client -connect news.malakhovai.ru:443 -servername news.malakhovai.ru 2>/dev/null \
  | openssl x509 -noout -checkend 604800 >/dev/null

ssh_value() {
  file=$1
  key=$2
  ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes "$SSH_HOST" \
    "sed -n 's/^${key}=//p' '$file' | tail -n 1"
}

for spec in "$FOUNDATION_ENV:ANON_KEY" "$FOUNDATION_ENV:SERVICE_ROLE_KEY" \
  "$APP_ENV:PUBLISH_VERIFY_SECRET"; do
  file=${spec%:*}
  key=${spec##*:}
  test -n "$(ssh_value "$file" "$key")"
done

printf '%s' "$PUBLIC_URL" | gh secret set SUPABASE_URL --repo "$REPO"
printf '%s' "$PUBLIC_URL" | gh secret set NEXT_PUBLIC_SUPABASE_URL --repo "$REPO"
printf '%s' "$PUBLIC_URL" | gh secret set NEXT_PUBLIC_SITE_URL --repo "$REPO"
ssh_value "$FOUNDATION_ENV" ANON_KEY | gh secret set SUPABASE_ANON_KEY --repo "$REPO"
ssh_value "$FOUNDATION_ENV" SERVICE_ROLE_KEY | gh secret set SUPABASE_SERVICE_KEY --repo "$REPO"
ssh_value "$APP_ENV" PUBLISH_VERIFY_SECRET | gh secret set PUBLISH_VERIFY_SECRET --repo "$REPO"

printf 'github_secret_cutover=passed repo=%s values_logged=false\n' "$REPO"
