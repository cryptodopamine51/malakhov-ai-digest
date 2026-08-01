#!/usr/bin/env bash
# Encrypted logical backup for the self-hosted Supabase production database.
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
COMPOSE=${COMPOSE:-$ROOT/supabase-source/docker}
BACKUP_ROOT=${BACKUP_ROOT:-$ROOT/backups}
RECIPIENT_FILE=${RECIPIENT_FILE:-$ROOT/secrets/backup-recipients.txt}
MIN_DUMP_BYTES=${MIN_DUMP_BYTES:-100000}
EVIDENCE_DIR=$ROOT/evidence
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
START_EPOCH=$(date -u +%s)
WORK_DIR=
REPOSITORY=${REPOSITORY:-}

if test -z "$REPOSITORY"; then
  if test -d "$ROOT/app-current"; then
    REPOSITORY=$ROOT/app-current
  else
    REPOSITORY=$ROOT/app-staging
  fi
fi

umask 077
test "$(id -u)" = 0
test -r "$COMPOSE/.env"
test -s "$RECIPIENT_FILE"
test -f "$REPOSITORY/infra/vps/LOCK.json"
command -v age >/dev/null
command -v flock >/dev/null

install -d -m 700 "$BACKUP_ROOT" "$BACKUP_ROOT/encrypted/daily" \
  "$BACKUP_ROOT/encrypted/weekly" "$BACKUP_ROOT/encrypted/monthly" \
  "$EVIDENCE_DIR"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || {
  printf '%s\n' 'backup=skipped reason=lock_held' >&2
  exit 75
}

WORK_DIR=$(mktemp -d "$BACKUP_ROOT/.work-$STAMP.XXXXXX")
chmod 700 "$WORK_DIR"
BUNDLE=$WORK_DIR/bundle
install -d -m 700 "$BUNDLE/database" "$BUNDLE/config" "$BUNDLE/recovery" "$BUNDLE/repository"

cleanup() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  case "$WORK_DIR" in
    "$BACKUP_ROOT"/.work-"$STAMP".*)
      if test -d "$WORK_DIR"; then rm -rf -- "$WORK_DIR"; fi
      ;;
  esac
  if test "$exit_status" -ne 0; then
    failure="$EVIDENCE_DIR/backup-$STAMP.failed"
    {
      printf 'backup_status=failed\n'
      printf 'started_utc=%s\n' "$STAMP"
      printf 'exit_status=%s\n' "$exit_status"
    } > "$failure"
    chmod 600 "$failure"
  fi
  exit "$exit_status"
}
trap cleanup EXIT HUP INT TERM

db_psql() {
  (cd "$COMPOSE" && docker compose exec -T db psql -q -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@")
}

write_db_evidence() {
  db_psql -F '|' -At <<'SQL'
select 'runtime_tables', count(*) from pg_class where relkind='r' and relnamespace='public'::regnamespace and relname in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'runtime_rls', count(*) from pg_class where relkind='r' and relnamespace='public'::regnamespace and relrowsecurity and relname in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'reference_categories_rls', count(*) from pg_class where relkind='r' and relnamespace='public'::regnamespace and relname='categories' and relrowsecurity;
select 'unexpected_public_tables', count(*) from pg_class where relkind='r' and relnamespace='public'::regnamespace and relname not in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','categories','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'service_rpc_contracts', count(*) from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('service_role',oid,'execute');
select 'live_rows', count(*) from public.articles where published and quality_ok and verified_live and publish_status='live';
select 'duplicate_ids', count(*) from (select id from public.articles group by id having count(*) > 1) duplicates;
select 'duplicate_slugs', count(*) from (select slug from public.articles where slug is not null group by slug having count(*) > 1) duplicates;
select 'duplicate_original_urls', count(*) from (select original_url from public.articles group by original_url having count(*) > 1) duplicates;
select 'article_checksum', md5(string_agg(md5(concat_ws('|',id::text,coalesce(slug,''),original_url,coalesce(updated_at::text,''),coalesce(length(editorial_body)::text,''))),'' order by id)) from public.articles;
select 'required_indexes', count(*) from pg_class where relkind='i' and relnamespace='public'::regnamespace and relname in ('idx_articles_verified_public','idx_articles_published','idx_articles_live_category_created');
select 'table_rows_' || table_name,
  (xpath('/row/count/text()', query_to_xml(format('select count(*) as count from public.%I', table_name), false, true, '')))[1]::text
from (values ('articles'),('anthropic_batch_items'),('anthropic_batches'),('article_attempts'),('article_feedback'),('article_quality_scores'),('categories'),('digest_runs'),('enrich_runs'),('ingest_runs'),('llm_usage_logs'),('pipeline_alerts'),('source_runs'),('telegram_channel_posts'),('weekly_report_runs')) tables(table_name)
order by table_name;
SQL
}

(cd "$COMPOSE" && docker compose exec -T db \
  pg_dump -U supabase_admin -d postgres --format=custom --compress=9 --no-owner) \
  > "$BUNDLE/database/postgres.dump"
test "$(wc -c < "$BUNDLE/database/postgres.dump")" -ge "$MIN_DUMP_BYTES"
(cd "$COMPOSE" && docker compose exec -T db \
  pg_dumpall -U supabase_admin --globals-only) \
  > "$BUNDLE/database/globals.sql"
(cd "$COMPOSE" && docker compose exec -T db pg_restore --list) \
  < "$BUNDLE/database/postgres.dump" > "$BUNDLE/database/restore.list"
write_db_evidence > "$BUNDLE/database/evidence.tsv"

install -m 600 "$COMPOSE/.env" "$BUNDLE/config/supabase.env"
install -m 600 "$COMPOSE/docker-compose.yml" "$BUNDLE/config/docker-compose.yml"
install -m 600 "$COMPOSE/docker-compose.malakhov.yml" "$BUNDLE/config/docker-compose.malakhov.yml"
if test -f "$ROOT/app-staging/infra/vps/.staging.env"; then
  install -m 600 "$ROOT/app-staging/infra/vps/.staging.env" "$BUNDLE/config/app-staging.env"
fi
if test -f "$ROOT/secrets/app-production.env"; then
  install -m 600 "$ROOT/secrets/app-production.env" "$BUNDLE/config/app-production.env"
fi
if test -f "$ROOT/secrets/web-runtime.env"; then
  install -m 600 "$ROOT/secrets/web-runtime.env" "$BUNDLE/config/web-runtime.env"
fi
install -m 600 "$REPOSITORY/infra/vps/LOCK.json" "$BUNDLE/repository/LOCK.json"
tar -C "$REPOSITORY" -cpf "$BUNDLE/repository/migrations.tar" supabase/migrations infra/vps

for recovery_file in \
  "$ROOT/recovery/recovery-export-20260801T160000Z.tar.gz" \
  "$ROOT/recovery/recovery-export-20260801T160000Z.tar.gz.sha256" \
  "$ROOT/recovery/articles.jsonl"; do
  if test -f "$recovery_file"; then install -m 600 "$recovery_file" "$BUNDLE/recovery/"; fi
done

SERVER_VERSION=$(db_psql -Atqc 'show server_version')
SNAPSHOT_EPOCH=$(date -u +%s)
{
  printf 'backup_format_version=1\n'
  printf 'snapshot_utc=%s\n' "$STAMP"
  printf 'snapshot_epoch=%s\n' "$SNAPSHOT_EPOCH"
  printf 'postgres_version=%s\n' "$SERVER_VERSION"
  printf 'supabase_release=v1.26.07\n'
  printf 'retention_daily=7\n'
  printf 'retention_weekly=4\n'
  printf 'retention_monthly=6\n'
} > "$BUNDLE/metadata.env"

SUMS_FILE=$WORK_DIR/SHA256SUMS
(cd "$BUNDLE" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$SUMS_FILE")
mv "$SUMS_FILE" "$BUNDLE/SHA256SUMS"

BASE=malakhov-ai-digest-$STAMP.tar.age
DAILY=$BACKUP_ROOT/encrypted/daily/$BASE
TEMP_AGE=$WORK_DIR/$BASE
tar -C "$WORK_DIR" -cpf - bundle | age -R "$RECIPIENT_FILE" -o "$TEMP_AGE"
test "$(wc -c < "$TEMP_AGE")" -ge "$MIN_DUMP_BYTES"
install -m 600 "$TEMP_AGE" "$DAILY"
sha256sum "$DAILY" > "$DAILY.sha256"
chmod 600 "$DAILY.sha256"

FINISH_EPOCH=$(date -u +%s)
MANIFEST=$DAILY.manifest
{
  printf 'backup_status=success\n'
  printf 'artifact=%s\n' "$DAILY"
  printf 'snapshot_utc=%s\n' "$STAMP"
  printf 'snapshot_epoch=%s\n' "$SNAPSHOT_EPOCH"
  printf 'completed_epoch=%s\n' "$FINISH_EPOCH"
  printf 'duration_seconds=%s\n' "$((FINISH_EPOCH - START_EPOCH))"
  printf 'size_bytes=%s\n' "$(wc -c < "$DAILY")"
  printf 'sha256=%s\n' "$(sha256sum "$DAILY" | awk '{print $1}')"
  printf 'encrypted=true\n'
  printf 'plaintext_retained=false\n'
} > "$MANIFEST"
chmod 600 "$MANIFEST"
cp "$MANIFEST" "$EVIDENCE_DIR/backup-$STAMP.manifest"
chmod 600 "$EVIDENCE_DIR/backup-$STAMP.manifest"

link_tier() {
  tier=$1
  for suffix in '' .sha256 .manifest; do
    ln -f "$DAILY$suffix" "$BACKUP_ROOT/encrypted/$tier/$BASE$suffix"
  done
}

weekday=$(date -u +%u)
day_of_month=$(date -u +%d)
if test "$weekday" = 7 || ! find "$BACKUP_ROOT/encrypted/weekly" -maxdepth 1 -name '*.tar.age' -print -quit | grep -q .; then link_tier weekly; fi
if test "$day_of_month" = 01 || ! find "$BACKUP_ROOT/encrypted/monthly" -maxdepth 1 -name '*.tar.age' -print -quit | grep -q .; then link_tier monthly; fi

prune_tier() {
  tier=$1
  keep=$2
  find "$BACKUP_ROOT/encrypted/$tier" -maxdepth 1 -type f -name '*.tar.age' -print \
    | sort -r | tail -n "+$((keep + 1))" | while IFS= read -r old; do
      test -n "$old" || continue
      rm -f -- "$old" "$old.sha256" "$old.manifest"
    done
}
prune_tier daily 7
prune_tier weekly 4
prune_tier monthly 6

printf 'backup=passed artifact=%s duration_seconds=%s encrypted=true plaintext_retained=false\n' \
  "$DAILY" "$((FINISH_EPOCH - START_EPOCH))"
