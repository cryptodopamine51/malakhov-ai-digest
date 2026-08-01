-- Iteration 3 production schema hardening.
-- Keep 14 mutable/runtime tables plus the required categories reference table,
-- remove the recovery-only sentinel, and expose exactly three RPC contracts to
-- service_role. Trigger helpers remain usable by triggers without Data API
-- EXECUTE grants.

begin;

create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension extension
    join pg_namespace namespace on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'public'
  ) then
    alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

drop table if exists public.recovery_preflight_sentinel;

drop function if exists public.apply_anthropic_batch_item_result(
  uuid,
  text,
  text,
  integer,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text,
  text,
  jsonb,
  text[],
  jsonb,
  jsonb,
  boolean,
  text,
  text,
  timestamp with time zone,
  text,
  text,
  text
);

revoke execute on function public.categories_set_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.update_article_feedback_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.update_telegram_channel_posts_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated, service_role;

grant select on public.categories to anon, authenticated;
grant execute on function public.apply_anthropic_batch_item_result(
  uuid,
  text,
  text,
  integer,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text,
  text,
  jsonb,
  text[],
  jsonb,
  jsonb,
  jsonb,
  boolean,
  text,
  text,
  timestamp with time zone,
  text,
  text,
  text
) to service_role;
grant execute on function public.claim_weekly_report_run(date, text, text, uuid[], text) to service_role;
grant execute on function public.publish_article(uuid, text) to service_role;

do $$
declare
  runtime_tables integer;
  runtime_rls integer;
  reference_tables integer;
  unexpected_tables integer;
  service_rpcs integer;
begin
  select count(*) into runtime_tables
  from pg_class
  where relkind = 'r'
    and relnamespace = 'public'::regnamespace
    and relname in (
      'articles', 'anthropic_batch_items', 'anthropic_batches',
      'article_attempts', 'article_feedback', 'article_quality_scores',
      'digest_runs', 'enrich_runs', 'ingest_runs', 'llm_usage_logs',
      'pipeline_alerts', 'source_runs', 'telegram_channel_posts',
      'weekly_report_runs'
    );

  select count(*) into runtime_rls
  from pg_class
  where relkind = 'r'
    and relnamespace = 'public'::regnamespace
    and relrowsecurity
    and relname in (
      'articles', 'anthropic_batch_items', 'anthropic_batches',
      'article_attempts', 'article_feedback', 'article_quality_scores',
      'digest_runs', 'enrich_runs', 'ingest_runs', 'llm_usage_logs',
      'pipeline_alerts', 'source_runs', 'telegram_channel_posts',
      'weekly_report_runs'
    );

  select count(*) into reference_tables
  from pg_class
  where relkind = 'r'
    and relnamespace = 'public'::regnamespace
    and relname = 'categories'
    and relrowsecurity;

  select count(*) into unexpected_tables
  from pg_class
  where relkind = 'r'
    and relnamespace = 'public'::regnamespace
    and relname not in (
      'articles', 'anthropic_batch_items', 'anthropic_batches',
      'article_attempts', 'article_feedback', 'article_quality_scores',
      'categories', 'digest_runs', 'enrich_runs', 'ingest_runs',
      'llm_usage_logs', 'pipeline_alerts', 'source_runs',
      'telegram_channel_posts', 'weekly_report_runs'
    );

  select count(*) into service_rpcs
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and has_function_privilege('service_role', oid, 'execute');

  if runtime_tables <> 14 or runtime_rls <> 14 then
    raise exception 'runtime table/RLS contract mismatch: tables=%, rls=%', runtime_tables, runtime_rls;
  end if;
  if reference_tables <> 1 then
    raise exception 'categories reference table must exist with RLS';
  end if;
  if unexpected_tables <> 0 then
    raise exception 'unexpected public tables: %', unexpected_tables;
  end if;
  if service_rpcs <> 3 then
    raise exception 'service_role must have exactly 3 public RPC contracts, got %', service_rpcs;
  end if;
end;
$$;

commit;
