#!/usr/bin/env bash
# Restore and validate an already decrypted backup bundle in a disposable DB.
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
COMPOSE=${COMPOSE:-$ROOT/supabase-source/docker}
BUNDLE=${1:-}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
START_EPOCH=$(date -u +%s)
DB_NAME=iteration3_restore_$(date -u +%Y%m%d%H%M%S)
RESTORE_ROOT=$(dirname "$BUNDLE")
EVIDENCE_DIR=$ROOT/evidence
DATABASE_CREATED=false

test "$(id -u)" = 0
test -d "$BUNDLE"
test -s "$BUNDLE/database/postgres.dump"
case "$RESTORE_ROOT" in
  /run/malakhov-restore-*) ;;
  *) printf 'restore_drill=blocked reason=unsafe_restore_root\n' >&2; exit 64 ;;
esac

umask 077
install -d -m 700 "$EVIDENCE_DIR"
exec 9>"$ROOT/backups/.restore-drill.lock"
flock -n 9 || {
  printf '%s\n' 'restore_drill=blocked reason=lock_held' >&2
  exit 75
}

db_psql() {
  database=$1
  shift
  (cd "$COMPOSE" && docker compose exec -T db psql -q -X -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@")
}

drop_target() {
  if test "$DATABASE_CREATED" = true; then
    db_psql postgres -c "drop database if exists $DB_NAME with (force)" >/dev/null || true
    DATABASE_CREATED=false
  fi
}

cleanup() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  drop_target
  rm -rf -- "$RESTORE_ROOT"
  if test "$exit_status" -ne 0; then
    {
      printf 'restore_status=failed\n'
      printf 'started_utc=%s\n' "$STAMP"
      printf 'exit_status=%s\n' "$exit_status"
      printf 'disposable_target_removed=true\n'
    } > "$EVIDENCE_DIR/restore-drill-$STAMP.failed"
    chmod 600 "$EVIDENCE_DIR/restore-drill-$STAMP.failed"
  fi
  exit "$exit_status"
}
trap cleanup EXIT HUP INT TERM

(cd "$BUNDLE" && sha256sum -c SHA256SUMS >/dev/null)
(cd "$COMPOSE" && docker compose exec -T db pg_restore --list) \
  < "$BUNDLE/database/postgres.dump" >/dev/null

db_psql postgres -c "create database $DB_NAME template template0"
DATABASE_CREATED=true
(cd "$COMPOSE" && docker compose exec -T db \
  pg_restore -U supabase_admin --no-owner --exit-on-error -d "$DB_NAME") \
  < "$BUNDLE/database/postgres.dump"

db_psql "$DB_NAME" -F '|' -At > "$RESTORE_ROOT/restored-evidence.tsv" <<'SQL'
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

cmp "$BUNDLE/database/evidence.tsv" "$RESTORE_ROOT/restored-evidence.tsv"
grep -Fx 'runtime_tables|14' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'runtime_rls|14' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'reference_categories_rls|1' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'unexpected_public_tables|0' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'service_rpc_contracts|3' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'live_rows|741' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'duplicate_ids|0' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'duplicate_slugs|0' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null
grep -Fx 'duplicate_original_urls|0' "$RESTORE_ROOT/restored-evidence.tsv" >/dev/null

SNAPSHOT_EPOCH=$(sed -n 's/^snapshot_epoch=//p' "$BUNDLE/metadata.env")
FINISH_EPOCH=$(date -u +%s)
drop_target
if db_psql postgres -Atqc "select count(*) from pg_database where datname='$DB_NAME'" | grep -Fx 0 >/dev/null; then
  TARGET_REMOVED=true
else
  TARGET_REMOVED=false
  exit 1
fi

EVIDENCE=$EVIDENCE_DIR/restore-drill-$STAMP.manifest
{
  printf 'restore_status=success\n'
  printf 'backup_snapshot_epoch=%s\n' "$SNAPSHOT_EPOCH"
  printf 'drill_started_epoch=%s\n' "$START_EPOCH"
  printf 'rpo_age_at_drill_seconds=%s\n' "$((START_EPOCH - SNAPSHOT_EPOCH))"
  printf 'rto_seconds=%s\n' "$((FINISH_EPOCH - START_EPOCH))"
  printf 'schema_counts_checksums_match=true\n'
  printf 'rls_rpc_indexes_match=true\n'
  printf 'disposable_target_removed=%s\n' "$TARGET_REMOVED"
} > "$EVIDENCE"
chmod 600 "$EVIDENCE"
printf 'restore_drill=passed rto_seconds=%s rpo_age_seconds=%s disposable_target_removed=true\n' \
  "$((FINISH_EPOCH - START_EPOCH))" "$((START_EPOCH - SNAPSHOT_EPOCH))"
