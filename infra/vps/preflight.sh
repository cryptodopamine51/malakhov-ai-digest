#!/usr/bin/env sh
set -eu

compose=/srv/malakhov-ai-digest/supabase-source/docker
cd "$compose"
docker compose config >/dev/null
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

for port in 5432 6543 8000 8443; do
  if ss -lntH "sport = :$port" | awk '$4 !~ /^127\\.0\\.0\\.1:/ && $4 !~ /^\\[::1\\]:/ { found=1 } END { exit found ? 0 : 1 }'; then
    echo "ERROR: Supabase port $port is not loopback-only" >&2
    exit 1
  fi
done
if ss -lntH "sport = :3000" | grep -q .; then
  echo 'ERROR: Studio must not be published directly' >&2
  exit 1
fi

docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'create schema if not exists recovery_ops' \
  -c 'revoke all on schema recovery_ops from public, anon, authenticated' \
  -c 'create table if not exists recovery_ops.preflight_sentinel (value text primary key)' \
  -c "insert into recovery_ops.preflight_sentinel(value) values ('foundation') on conflict (value) do nothing"
docker compose restart db
until docker compose exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done
docker compose exec -T db psql -U postgres -d postgres -Atqc "select value from recovery_ops.preflight_sentinel where value = 'foundation'" | grep -Fx foundation >/dev/null
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'drop schema recovery_ops cascade' >/dev/null
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
printf '%s\n' 'preflight=passed persistence=passed sentinel=removed supabase_host_ports=not_published studio=not_published'
