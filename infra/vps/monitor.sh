#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
FOUNDATION=${FOUNDATION:-$ROOT/supabase-source/docker}
BACKUP_ROOT=${BACKUP_ROOT:-$ROOT/backups/encrypted/daily}
STATUS_DIR=$ROOT/evidence/monitor
PUBLIC_URL=${PUBLIC_URL:-https://news.malakhovai.ru}
MAX_BACKUP_AGE=${MAX_BACKUP_AGE:-129600}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FAILURES=()

umask 077
install -d -m 700 "$STATUS_DIR"

fail() { FAILURES+=("$1"); }

foundation_bad=$(cd "$FOUNDATION" && docker compose ps --format '{{.Health}}' | awk '$1 != "healthy" {n++} END{print n+0}')
test "$foundation_bad" = 0 || fail foundation_containers

for container in malakhov-digest-production-app malakhov-digest-production-caddy; do
  state=$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)
  test "$state" = 'running|healthy' || fail "container_$container"
done

disk_used=$(df -P /srv | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
test "$disk_used" -lt 80 || fail disk_usage

latest_backup=$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name '*.tar.age' -print | sort | tail -n 1)
if test -z "$latest_backup"; then
  fail backup_missing
else
  backup_epoch=$(stat -c %Y "$latest_backup")
  backup_age=$(($(date -u +%s) - backup_epoch))
  test "$backup_age" -le "$MAX_BACKUP_AGE" || fail backup_stale
  if ! test -s "$latest_backup.sha256" || ! sha256sum -c "$latest_backup.sha256" >/dev/null 2>&1; then
    fail backup_checksum
  fi
fi

db_result=$(cd "$FOUNDATION" && docker compose exec -T db psql -q -X -U postgres -d postgres -Atqc \
  "select (select count(*) from pg_stat_activity where datname=current_database()) || '|' || (select count(*) from pg_locks where not granted) || '|' || (select count(*) from public.articles where published and quality_ok and verified_live and publish_status='live')")
IFS='|' read -r db_connections blocked_locks live_rows <<< "$db_result"
test "$db_connections" -lt 80 || fail db_connections
test "$blocked_locks" = 0 || fail db_blocked_locks
test "$live_rows" -ge 741 || fail live_rows

systemctl is-active --quiet x-ui || fail xui_service
for port in 2096 21417; do ss -lntH "sport = :$port" | grep -q . || fail "protected_port_$port"; done

if test -f "$ROOT/.cutover-complete"; then
  if ! curl -fsS --max-time 15 "$PUBLIC_URL/api/feed?limit=1" \
    | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("total", 0) >= 741 else 1)'; then
    fail external_feed
  fi
  printf '' | openssl s_client -connect news.malakhovai.ru:443 -servername news.malakhovai.ru 2>/dev/null \
    | openssl x509 -noout -checkend 604800 >/dev/null 2>&1 || fail tls_expiry
fi

STATUS_FILE=$STATUS_DIR/latest.status
if test "${#FAILURES[@]}" -eq 0; then
  {
    printf 'status=healthy\n'
    printf 'checked_utc=%s\n' "$STAMP"
    printf 'live_rows=%s\n' "$live_rows"
    printf 'disk_used_percent=%s\n' "$disk_used"
    printf 'db_connections=%s\n' "$db_connections"
  } > "$STATUS_FILE"
  chmod 600 "$STATUS_FILE"
  printf 'monitor=healthy live_rows=%s disk_used_percent=%s\n' "$live_rows" "$disk_used"
  exit 0
fi

failure_csv=$(IFS=,; printf '%s' "${FAILURES[*]}")
{
  printf 'status=critical\n'
  printf 'checked_utc=%s\n' "$STAMP"
  printf 'failures=%s\n' "$failure_csv"
} > "$STATUS_FILE"
chmod 600 "$STATUS_FILE"
logger -p daemon.crit -t malakhov-monitor "critical checks failed: $failure_csv"
printf 'monitor=critical failures=%s\n' "$failure_csv" >&2
exit 1
