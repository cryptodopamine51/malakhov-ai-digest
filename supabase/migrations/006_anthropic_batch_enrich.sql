-- Migration 006: Anthropic Batch enrich orchestration
-- Adds batch lifecycle tables, current batch linkage on articles,
-- and an idempotent RPC for atomic apply.

create extension if not exists pgcrypto;

alter table enrich_runs
  add column if not exists run_kind text not null default 'sync';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrich_runs_run_kind_check'
  ) then
    alter table enrich_runs
      add constraint enrich_runs_run_kind_check
      check (run_kind in ('sync', 'batch_submit', 'batch_collect'));
  end if;
end $$;

create table if not exists anthropic_batches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references enrich_runs(id) on delete set null,
  provider_batch_id text not null,
  status text not null default 'submitted',
  processing_status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  cancel_initiated_at timestamptz,
  results_url text,
  last_polled_at timestamptz,
  poll_attempts integer not null default 0,
  request_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  errored_count integer not null default 0,
  expired_count integer not null default 0,
  canceled_count integer not null default 0,
  total_input_tokens integer not null default 0,
  total_output_tokens integer not null default 0,
  total_cache_read_tokens integer not null default 0,
  total_cache_creation_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  error_summary text,
  created_by text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anthropic_batches_status_check'
  ) then
    alter table anthropic_batches
      add constraint anthropic_batches_status_check
      check (status in ('submitted', 'completed', 'partial', 'failed', 'canceled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anthropic_batches_processing_status_check'
  ) then
    alter table anthropic_batches
      add constraint anthropic_batches_processing_status_check
      check (processing_status in ('in_progress', 'canceling', 'ended'));
  end if;
end $$;

create table if not exists anthropic_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references anthropic_batches(id) on delete set null,
  article_id uuid not null references articles(id) on delete cascade,
  request_custom_id text not null,
  status text not null default 'queued_for_batch',
  result_type text,
  error_code text,
  error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  submitted_at timestamptz,
  result_imported_at timestamptz,
  applied_at timestamptz,
  apply_attempts integer not null default 0,
  last_apply_error text,
  last_apply_error_code text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anthropic_batch_items_status_check'
  ) then
    alter table anthropic_batch_items
      add constraint anthropic_batch_items_status_check
      check (status in (
        'queued_for_batch',
        'batch_submitted',
        'batch_processing',
        'batch_result_ready',
        'applying',
        'applied',
        'batch_failed',
        'apply_failed_retriable',
        'apply_failed_terminal'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anthropic_batch_items_result_type_check'
  ) then
    alter table anthropic_batch_items
      add constraint anthropic_batch_items_result_type_check
      check (
        result_type is null or
        result_type in ('succeeded', 'errored', 'expired', 'canceled')
      );
  end if;
end $$;

alter table articles
  add column if not exists current_batch_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'articles_current_batch_item_id_fkey'
  ) then
    alter table articles
      add constraint articles_current_batch_item_id_fkey
      foreign key (current_batch_item_id)
      references anthropic_batch_items(id)
      on delete set null;
  end if;
end $$;

alter table article_attempts
  add column if not exists batch_item_id uuid references anthropic_batch_items(id) on delete set null;

create unique index if not exists idx_anthropic_batches_provider_batch_unique
  on anthropic_batches(provider_batch_id);

create unique index if not exists idx_anthropic_batch_items_request_custom_unique
  on anthropic_batch_items(request_custom_id);

create unique index if not exists idx_anthropic_batch_items_batch_custom_unique
  on anthropic_batch_items(batch_id, request_custom_id)
  where batch_id is not null;

create unique index if not exists idx_article_attempts_stage_batch_item_unique
  on article_attempts(stage, batch_item_id)
  where batch_item_id is not null;

create index if not exists idx_batch_items_status_updated
  on anthropic_batch_items(status, updated_at desc);

create index if not exists idx_batch_items_article_created
  on anthropic_batch_items(article_id, created_at desc);

create index if not exists idx_batch_items_batch_status
  on anthropic_batch_items(batch_id, status, updated_at desc);

create index if not exists idx_batches_processing_status
  on anthropic_batches(processing_status, last_polled_at);

create index if not exists idx_articles_current_batch_item
  on articles(current_batch_item_id);

alter table anthropic_batches enable row level security;
alter table anthropic_batch_items enable row level security;

create or replace function apply_anthropic_batch_item_result(
  p_batch_item_id uuid,
  p_enrich_status text,
  p_publish_status text,
  p_score integer,
  p_cover_image_url text,
  p_original_text text,
  p_ru_title text,
  p_lead text,
  p_summary text[],
  p_card_teaser text,
  p_tg_teaser text,
  p_editorial_body text,
  p_editorial_model text,
  p_glossary jsonb,
  p_link_anchors text[],
  p_article_tables jsonb,
  p_article_images jsonb,
  p_quality_ok boolean,
  p_quality_reason text,
  p_slug text,
  p_publish_ready_at timestamptz,
  p_result_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns table(applied boolean, noop boolean, state text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item anthropic_batch_items%rowtype;
  v_article articles%rowtype;
  v_attempt_no integer;
begin
  select *
  into v_item
  from anthropic_batch_items
  where id = p_batch_item_id
  for update;

  if not found then
    return query select false, false, 'missing_item';
    return;
  end if;

  if v_item.status = 'applied' then
    return query select false, true, 'already_applied';
    return;
  end if;

  if v_item.status not in ('batch_result_ready', 'applying', 'apply_failed_retriable') then
    return query select false, false, 'item_not_ready';
    return;
  end if;

  begin
    update anthropic_batch_items
    set
      status = 'applying',
      apply_attempts = apply_attempts + 1,
      last_apply_error = null,
      last_apply_error_code = null,
      updated_at = now()
    where id = p_batch_item_id;

    select *
    into v_article
    from articles
    where id = v_item.article_id
    for update;

    if not found then
      update anthropic_batch_items
      set
        status = 'apply_failed_terminal',
        last_apply_error = 'article not found',
        last_apply_error_code = 'missing_article',
        updated_at = now()
      where id = p_batch_item_id;

      return query select false, false, 'missing_article';
      return;
    end if;

    v_attempt_no := coalesce(v_article.attempt_count, 0) + 1;

    update articles
    set
      enrich_status = p_enrich_status,
      publish_status = p_publish_status,
      publish_ready_at = p_publish_ready_at,
      score = coalesce(p_score, score),
      cover_image_url = p_cover_image_url,
      original_text = p_original_text,
      ru_title = p_ru_title,
      ru_text = p_editorial_body,
      lead = p_lead,
      summary = p_summary,
      card_teaser = p_card_teaser,
      tg_teaser = p_tg_teaser,
      editorial_body = p_editorial_body,
      editorial_model = p_editorial_model,
      glossary = case
        when p_glossary is null then null
        when jsonb_typeof(p_glossary) = 'array' and jsonb_array_length(p_glossary) = 0 then null
        else p_glossary
      end,
      link_anchors = case
        when p_link_anchors is null or array_length(p_link_anchors, 1) is null then null
        else p_link_anchors
      end,
      article_tables = case
        when p_article_tables is null then null
        when jsonb_typeof(p_article_tables) = 'array' and jsonb_array_length(p_article_tables) = 0 then null
        else p_article_tables
      end,
      article_images = case
        when p_article_images is null then null
        when jsonb_typeof(p_article_images) = 'array' and jsonb_array_length(p_article_images) = 0 then null
        else p_article_images
      end,
      quality_ok = p_quality_ok,
      quality_reason = nullif(p_quality_reason, ''),
      slug = p_slug,
      enriched = true,
      published = coalesce(p_quality_ok, false),
      current_batch_item_id = null,
      claim_token = null,
      processing_by = null,
      lease_expires_at = null,
      last_error = nullif(p_error_message, ''),
      last_error_code = nullif(p_error_code, ''),
      processing_finished_at = now(),
      updated_at = now()
    where id = v_article.id;

    insert into article_attempts (
      article_id,
      batch_item_id,
      stage,
      attempt_no,
      worker_id,
      claim_token,
      started_at,
      finished_at,
      duration_ms,
      result_status,
      error_code,
      error_message,
      payload
    )
    select
      v_article.id,
      p_batch_item_id,
      'enrich',
      v_attempt_no,
      v_article.processing_by,
      v_article.claim_token,
      coalesce(v_item.submitted_at, v_item.created_at, now()),
      now(),
      greatest(0, floor(extract(epoch from (now() - coalesce(v_item.submitted_at, v_item.created_at, now()))) * 1000))::integer,
      p_result_status,
      nullif(p_error_code, ''),
      nullif(p_error_message, ''),
      jsonb_build_object('batch_item_id', p_batch_item_id)
    where not exists (
      select 1
      from article_attempts
      where stage = 'enrich'
        and batch_item_id = p_batch_item_id
    );

    update anthropic_batch_items
    set
      status = 'applied',
      applied_at = now(),
      last_apply_error = null,
      last_apply_error_code = null,
      updated_at = now()
    where id = p_batch_item_id;

    return query select true, false, 'applied';
    return;
  exception
    when others then
      update anthropic_batch_items
      set
        status = 'apply_failed_retriable',
        last_apply_error = SQLERRM,
        last_apply_error_code = SQLSTATE,
        updated_at = now()
      where id = p_batch_item_id;

      return query select false, false, 'apply_failed_retriable';
      return;
  end;
end;
$$;

create or replace view batch_enrich_operational_state
with (security_invoker = true)
as
select
  a.id as article_id,
  a.original_title,
  a.enrich_status,
  a.publish_status,
  a.current_batch_item_id,
  bi.batch_id,
  bi.status as batch_item_status,
  bi.result_type as batch_item_result_type,
  bi.error_code as batch_item_error_code,
  bi.error_message as batch_item_error_message,
  bi.result_imported_at,
  bi.applied_at,
  b.provider_batch_id,
  b.status as batch_status,
  b.processing_status as batch_processing_status,
  b.last_polled_at,
  b.finished_at as batch_finished_at
from articles a
left join anthropic_batch_items bi on bi.id = a.current_batch_item_id
left join anthropic_batches b on b.id = bi.batch_id;
