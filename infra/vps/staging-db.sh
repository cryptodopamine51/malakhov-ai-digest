#!/usr/bin/env sh
# Iteration 2 database runner. Run only on the VPS as root, after copying the
# task-owned repository paths to /srv/malakhov-ai-digest/app-staging.
# It never enables historical pg_cron/pg_net schedules.
set -eu

ROOT=${ROOT:-/srv/malakhov-ai-digest/app-staging}
COMPOSE=${COMPOSE:-/srv/malakhov-ai-digest/supabase-source/docker}
RECOVERY=${RECOVERY:-/srv/malakhov-ai-digest/recovery/articles.jsonl}
MODE=${1:-}

db_psql() {
  (cd "$COMPOSE" && docker compose exec -T db psql -q -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@")
}

db_psql_database() {
  database=$1
  shift
  (cd "$COMPOSE" && docker compose exec -T db psql -q -X -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@")
}

assert_no_committed_tg_cron() {
  # A fresh self-hosted DB may not have the cron extension at all. Avoid a
  # static reference to cron.job so that absence itself is accepted.
  db_psql <<'SQL'
do $$
declare jobs integer := 0;
begin
  if to_regclass('cron.job') is not null then
    execute $query$select count(*) from cron.job where jobname like 'tg-%'$query$ into jobs;
  end if;
  if jobs <> 0 then raise exception 'unexpected committed Telegram cron jobs: %', jobs; end if;
end;
$$;
SQL
}

safe_migrations() {
  find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort | while IFS= read -r file; do
    case "$file" in
      */010_live_articles_partial_index.sql|*/016_pg_cron_tg_digest.sql|*/017_telegram_channel_posts.sql|*/20260622073323_weekly_telegram_report.sql)
        ;;
      *) printf '%s\n' "$file" ;;
    esac
  done
}

all_migrations() {
  find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort
}

preflight() {
  # Migration 010 uses CREATE INDEX CONCURRENTLY, which PostgreSQL correctly
  # forbids in a transaction. A disposable DB validates the full history while
  # preserving the same no-side-effects guarantee.
  preflight_db=iteration2_schema_preflight
  db_psql -c "drop database if exists $preflight_db with (force)"
  db_psql -c "create database $preflight_db"
  cleanup_preflight() { db_psql -c "drop database if exists $preflight_db with (force)" >/dev/null; }
  trap cleanup_preflight EXIT HUP INT TERM
  {
    cat "$ROOT/supabase/schema.sql"
    # Scheduler history is deliberately replaced by the versioned self-hosted
    # adaptation in safe_migrations(). pg_cron only
    # supports its configured database, so its historical setup cannot be
    # meaningfully validated in this disposable database without changing the
    # global server configuration.
    # Preflight also includes 010, which is intentionally non-transactional
    # because it creates its two indexes concurrently.
    all_migrations | while IFS= read -r file; do
      case "$file" in
        */016_pg_cron_tg_digest.sql|*/017_telegram_channel_posts.sql|*/20260622073323_weekly_telegram_report.sql) ;;
        *) cat "$file" ;;
      esac
    done
  } | db_psql_database "$preflight_db"
  db_psql_database "$preflight_db" -Atqc "select count(*) from public.articles" | grep -Fx 0 >/dev/null
  assert_no_committed_tg_cron
  printf '%s\n' 'schema_preflight=passed mode=disposable_db cron_jobs_committed=0'
}

apply_schema() {
  if db_psql -Atqc "select to_regclass('public.articles') is not null" | grep -Fx t >/dev/null; then
    cat "$ROOT/supabase/migrations/010_live_articles_partial_index.sql" | db_psql
    find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '202608*.sql' -print | sort | while IFS= read -r file; do cat "$file"; done | db_psql
    db_psql -Atqc "select count(*) from pg_class where relname in ('idx_articles_live_ranked','idx_articles_live_pub_date')" | grep -Fx 2 >/dev/null
    assert_no_committed_tg_cron
    printf '%s\n' 'schema_apply=already_present'
    return
  fi
  {
    printf '\\set ON_ERROR_STOP on\n'
    printf 'begin;\n'
    cat "$ROOT/supabase/schema.sql"
    safe_migrations | while IFS= read -r file; do cat "$file"; done
    printf 'commit;\n'
  } | db_psql
  # Migration 010 documents its own PostgreSQL exception: CREATE INDEX
  # CONCURRENTLY cannot be transactional. Its IF NOT EXISTS statements are
  # isolated after the atomic schema transaction, and the two indexes are
  # verified immediately below.
  cat "$ROOT/supabase/migrations/010_live_articles_partial_index.sql" | db_psql
  db_psql -Atqc "select count(*) from pg_class where relname in ('idx_articles_live_ranked','idx_articles_live_pub_date')" | grep -Fx 2 >/dev/null
  assert_no_committed_tg_cron
  printf '%s\n' 'schema_apply=passed cron_jobs_committed=0'
}

import_recovery() {
  test -r "$RECOVERY"
  test "$(wc -l < "$RECOVERY" | tr -d ' ')" = 741
  # COPY text mode treats JSON's literal \\n escape sequences as record breaks.
  # Encode each verified JSONL record as base64 instead, so Postgres receives
  # the original byte stream exactly. The short-lived Node container has no
  # network, credentials, or mounted Docker socket.
  recovery_inserts() {
    docker run --rm -i --network none node:22.16.0-bookworm-slim node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk });
      process.stdin.on("end", () => {
        const rows = input.split("\n").filter(Boolean);
        if (rows.length !== 741) throw new Error(`expected 741 JSONL rows, got ${rows.length}`);
        for (const row of rows) {
          JSON.parse(row);
          const encoded = Buffer.from(row, "utf8").toString("base64");
          process.stdout.write(`insert into recovery_jsonl(payload) values (convert_from(decode('"'"'${encoded}'"'"', '"'"'base64'"'"'), '"'"'utf8'"'"')::jsonb);\n`);
        }
      });
    '
  }
  {
    printf '\\set ON_ERROR_STOP on\n'
    printf 'begin;\n'
    printf 'create temporary table recovery_jsonl (payload jsonb not null) on commit drop;\n'
    recovery_inserts < "$RECOVERY"
    printf '%s\n' "do \$\$ begin if (select count(*) from recovery_jsonl) <> 741 then raise exception 'expected 741 recovery records'; end if; end \$\$;"
    printf 'insert into public.articles select (jsonb_populate_record(null::public.articles, payload)).* from recovery_jsonl on conflict (id) do nothing;\n'
    printf '%s\n' "do \$\$ begin if (select count(*) from public.articles where published is true and quality_ok is true and publish_status = 'live') <> 741 then raise exception 'live recovery count is not 741'; end if; end \$\$;"
    printf '%s\n' "do \$\$ begin if exists (select 1 from public.articles group by id having count(*) > 1) or exists (select 1 from public.articles where slug is not null group by slug having count(*) > 1) or exists (select 1 from public.articles group by original_url having count(*) > 1) then raise exception 'recovery uniqueness check failed'; end if; end \$\$;"
    printf 'commit;\n'
  } | db_psql
  db_psql -Atqc "select count(*) from public.articles where published is true and quality_ok is true and publish_status = 'live'" | grep -Fx 741 >/dev/null
  printf '%s\n' 'recovery_import=passed live_rows=741 duplicates=0'
}

verify() {
  db_psql <<'SQL'
\pset tuples_only on
\pset format unaligned
select 'runtime_tables=' || count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'reference_tables=' || count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname = 'categories';
select 'unexpected_public_tables=' || count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname not in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','categories','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'runtime_rpcs=' || count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('apply_anthropic_batch_item_result','claim_weekly_report_run','publish_article');
select 'rls_tables=' || count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity and relname in ('articles','anthropic_batch_items','anthropic_batches','article_attempts','article_feedback','article_quality_scores','digest_runs','enrich_runs','ingest_runs','llm_usage_logs','pipeline_alerts','source_runs','telegram_channel_posts','weekly_report_runs');
select 'reference_rls=' || count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity and relname = 'categories';
select 'anon_articles_select=' || has_table_privilege('anon','public.articles','select') || ' anon_articles_insert=' || has_table_privilege('anon','public.articles','insert') || ' service_articles_insert=' || has_table_privilege('service_role','public.articles','insert');
select 'live_rows=' || count(*) from public.articles where published is true and quality_ok is true and publish_status = 'live';
select 'duplicate_ids=' || count(*) from (select id from public.articles group by id having count(*) > 1) d;
select 'duplicate_slugs=' || count(*) from (select slug from public.articles where slug is not null group by slug having count(*) > 1) d;
select 'duplicate_original_urls=' || count(*) from (select original_url from public.articles group by original_url having count(*) > 1) d;
set enable_seqscan = off;
explain (costs off) select id, slug from public.articles where published and quality_ok and verified_live and publish_status = 'live' order by score desc, created_at desc limit 20;
explain (costs off) select id, slug from public.articles where primary_category = 'ai-industry' and published and quality_ok and verified_live and publish_status = 'live' order by created_at desc limit 20;
reset enable_seqscan;
SQL
  assert_no_committed_tg_cron
}

lifecycle() {
  # Every transition is rolled back. No recovered row, scheduler row or
  # Telegram side effect persists from this gate.
  db_psql <<'SQL'
begin;
do $$
declare article_id uuid := gen_random_uuid(); transition text;
begin
  insert into public.articles (id, original_url, original_title, source_name, source_lang, primary_category, published, quality_ok, publish_status, enrich_status)
  values (article_id, 'https://staging.invalid/iteration2/' || article_id::text, 'Iteration 2 lifecycle fixture', 'Iteration 2', 'en', 'ai-industry', false, false, 'draft', 'pending');
  update public.articles set enrich_status = 'processing', claim_token = gen_random_uuid(), processing_by = 'iteration2', lease_expires_at = now() + interval '5 minutes' where id = article_id and enrich_status = 'pending';
  if not found then raise exception 'enrich claim was not acquired'; end if;
  update public.articles set enrich_status = 'enriched_ok', claim_token = null, processing_by = null, lease_expires_at = null, quality_ok = true, publish_status = 'publish_ready', verified_live = true where id = article_id;
  select public.publish_article(article_id, 'iteration2-lifecycle') into transition;
  if transition <> 'published_live' then raise exception 'publish lifecycle returned %', transition; end if;
  select public.publish_article(article_id, 'iteration2-lifecycle') into transition;
  if transition <> 'already_live' then raise exception 'publish idempotency returned %', transition; end if;
end;
$$;
do $$
declare first_claim boolean; second_claim boolean;
begin
  select claimed into first_claim from public.claim_weekly_report_run('2099-01-05', 'iteration2-staging', 'signal', array(select id from public.articles order by id limit 6), 'iteration2');
  select claimed into second_claim from public.claim_weekly_report_run('2099-01-05', 'iteration2-staging', 'signal', array(select id from public.articles order by id limit 6), 'iteration2');
  if first_claim is not true or second_claim is not false then raise exception 'weekly report idempotency failed: %, %', first_claim, second_claim; end if;
end;
$$;
rollback;
SQL
  printf '%s\n' 'lifecycle=passed enrich_claim_release=passed publish_idempotency=passed weekly_idempotency=passed telegram_calls=0'
}

case "$MODE" in
  preflight) preflight ;;
  apply) apply_schema ;;
  import) import_recovery ;;
  verify) verify ;;
  lifecycle) lifecycle ;;
  *) echo "usage: $0 {preflight|apply|import|verify|lifecycle}" >&2; exit 64 ;;
esac
