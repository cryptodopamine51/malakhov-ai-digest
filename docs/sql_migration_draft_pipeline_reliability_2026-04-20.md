# SQL Migration Draft: pipeline reliability

**Дата:** 2026-04-20  
**Статус:** draft для будущей миграции, ещё не applied

## 1. Назначение

Это черновик первой additive migration для status-layer и operational logs. Его задача не “сразу всё переключить”, а создать схему, на которую можно безопасно опереться в коде.

## 2. Draft SQL

```sql
-- Migration 005: pipeline reliability foundation
-- Draft only. Review before apply.

create extension if not exists pgcrypto;

alter table articles
  add column if not exists ingest_status text not null default 'ingested',
  add column if not exists enrich_status text not null default 'pending',
  add column if not exists publish_status text not null default 'draft',
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists discover_count integer not null default 1,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_finished_at timestamptz,
  add column if not exists processing_by text,
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_error_code text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists publish_ready_at timestamptz,
  add column if not exists verified_live boolean,
  add column if not exists verified_live_at timestamptz,
  add column if not exists live_check_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'articles_ingest_status_check'
  ) then
    alter table articles
      add constraint articles_ingest_status_check
      check (ingest_status in ('ingested', 'ingest_failed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'articles_enrich_status_check'
  ) then
    alter table articles
      add constraint articles_enrich_status_check
      check (enrich_status in (
        'pending',
        'processing',
        'retry_wait',
        'enriched_ok',
        'rejected',
        'failed',
        'stuck'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'articles_publish_status_check'
  ) then
    alter table articles
      add constraint articles_publish_status_check
      check (publish_status in (
        'draft',
        'publish_ready',
        'verifying',
        'live',
        'verification_failed',
        'withdrawn'
      ));
  end if;
end $$;

create table if not exists ingest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  feeds_total integer not null default 0,
  feeds_failed integer not null default 0,
  items_seen integer not null default 0,
  items_inserted integer not null default 0,
  items_duplicates integer not null default 0,
  items_failed integer not null default 0,
  error_summary text
);

create table if not exists enrich_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  batch_size integer not null default 0,
  articles_claimed integer not null default 0,
  articles_enriched_ok integer not null default 0,
  articles_rejected integer not null default 0,
  articles_retryable integer not null default 0,
  articles_failed integer not null default 0,
  oldest_pending_age_minutes integer,
  error_summary text
);

create table if not exists source_runs (
  id uuid primary key default gen_random_uuid(),
  ingest_run_id uuid references ingest_runs(id) on delete set null,
  source_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  items_seen integer not null default 0,
  items_new integer not null default 0,
  items_duplicates integer not null default 0,
  http_status integer,
  error_message text,
  response_time_ms integer
);

create table if not exists pipeline_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null,
  status text not null default 'open',
  entity_key text,
  dedupe_key text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists article_attempts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  stage text not null,
  attempt_no integer not null,
  worker_id text,
  claim_token uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  result_status text not null,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_articles_enrich_queue
  on articles(enrich_status, next_retry_at, created_at desc);

create index if not exists idx_articles_processing_lease
  on articles(enrich_status, lease_expires_at);

create index if not exists idx_articles_verified_public
  on articles(published, quality_ok, verified_live, created_at desc);

create index if not exists idx_articles_last_seen
  on articles(last_seen_at desc);

create index if not exists idx_source_runs_recent
  on source_runs(source_name, started_at desc);

create index if not exists idx_pipeline_alerts_dedupe_open
  on pipeline_alerts(dedupe_key, status, last_seen_at desc);

create index if not exists idx_article_attempts_article_started
  on article_attempts(article_id, started_at desc);
```

## 3. Optional phase-2 SQL

Когда дойдём до visibility gate:

```sql
create or replace view public_articles as
select *
from articles
where published = true
  and quality_ok = true
  and verified_live = true
  and publish_status = 'live';
```

## 4. Backfill draft

Отдельным скриптом или follow-up migration:

```sql
update articles
set
  enrich_status = 'pending'
where enriched = false
  and enrich_status = 'pending';

update articles
set
  enrich_status = 'enriched_ok',
  publish_status = 'live'
where published = true
  and quality_ok = true;

update articles
set enrich_status = 'rejected'
where coalesce(quality_reason, '') in ('low_score', 'quality_reject');

update articles
set enrich_status = 'failed'
where coalesce(quality_reason, '') in ('editorial_parse_failed', 'unhandled_error');
```

## 5. Что проверить перед применением

- в target базе уже есть `quality_ok`, `quality_reason`, `glossary`, `article_tables`, `article_images`, `link_anchors`
- `articles.slug` уже уникален или хотя бы не содержит конфликтов
- migration не конфликтует с trigger `update_articles_updated_at`
- view `public_articles` не создавать раньше, чем появится реальный `verified_live` data flow

## 6. Что не делать этой миграцией

- не удалять legacy-поля
- не переписывать `digest_runs`
- не делать destructive rename колонок
- не внедрять сразу RPC claim, если ещё не согласовано его API

