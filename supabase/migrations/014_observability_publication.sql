-- Migration 014: observability and publication hardening
-- See docs/spec_observability_publication_2026-05-01.md
-- Additive, idempotent. No destructive changes; existing rows stay valid.

-- 1. enrich_runs.rejected_breakdown — aggregated reject reasons per run
alter table enrich_runs
  add column if not exists rejected_breakdown jsonb not null default '{}'::jsonb;

-- 2. source_runs — fetch and rss filter visibility
alter table source_runs
  add column if not exists fetch_errors_count integer not null default 0,
  add column if not exists fetch_errors_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists items_rejected_count integer not null default 0,
  add column if not exists items_rejected_breakdown jsonb not null default '{}'::jsonb;

-- 3. article_attempts.stage — extend allowed stages
-- Previous (migration 011): 'enrich','verify','verify_sample'
-- New: add 'fetch','media_sanitize','ingest','digest' for full traceability.
alter table article_attempts
  drop constraint if exists article_attempts_stage_check;

alter table article_attempts
  add constraint article_attempts_stage_check
  check (stage in ('enrich', 'verify', 'verify_sample', 'fetch', 'media_sanitize', 'ingest', 'digest'));

-- 4. articles.last_publish_verifier and published_at
-- published_at is referenced by RPC publish_article and the live index below;
-- backfill existing live rows from updated_at to keep data coherent.
alter table articles
  add column if not exists last_publish_verifier text,
  add column if not exists published_at timestamptz;

update articles
  set published_at = coalesce(verified_live_at, updated_at, created_at, now())
  where publish_status = 'live' and published_at is null;

-- 5. RPC publish_article — atomic publish_ready → live transition
-- Returns one of:
--   'published_live'      — successfully promoted to live
--   'rejected_quality'    — quality_ok is not true (cannot publish)
--   'rejected_unverified' — reserved (used when verified_live invariant tightens)
--   'already_live'        — idempotent path
--   'not_eligible'        — article not found or not in eligible state
create or replace function public.publish_article(
  p_article_id uuid,
  p_verifier text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quality_ok boolean;
  v_publish_status text;
  v_verified_live boolean;
begin
  select quality_ok, publish_status, verified_live
    into v_quality_ok, v_publish_status, v_verified_live
    from articles
    where id = p_article_id
    for update;

  if not found then
    return 'not_eligible';
  end if;

  if v_publish_status = 'live' then
    return 'already_live';
  end if;

  if v_quality_ok is not true then
    return 'rejected_quality';
  end if;

  if v_publish_status not in ('publish_ready', 'verifying') then
    return 'not_eligible';
  end if;

  update articles
    set publish_status = 'live',
        verified_live = true,
        verified_live_at = now(),
        published = true,
        published_at = coalesce(published_at, now()),
        last_publish_verifier = p_verifier
    where id = p_article_id;

  return 'published_live';
end;
$$;

grant execute on function public.publish_article(uuid, text) to service_role;

-- 6. Performance index for /api/health and dashboard queries
create index if not exists idx_articles_published_at_live
  on articles (published_at desc)
  where publish_status = 'live';

-- 7. Performance index for rejected_breakdown / cost queries by day
create index if not exists idx_enrich_runs_finished_at
  on enrich_runs (finished_at desc);
