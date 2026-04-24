-- Migration 008: structured LLM usage observability
-- Adds numeric usage totals to enrich_runs and a unified llm_usage_logs table.

create extension if not exists pgcrypto;

alter table enrich_runs
  add column if not exists total_input_tokens integer not null default 0,
  add column if not exists total_output_tokens integer not null default 0,
  add column if not exists total_cache_read_tokens integer not null default 0,
  add column if not exists total_cache_creation_tokens integer not null default 0,
  add column if not exists estimated_cost_usd numeric(12, 6) not null default 0;

create table if not exists llm_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  operation text not null,
  run_kind text,
  enrich_run_id uuid references enrich_runs(id) on delete set null,
  article_id uuid references articles(id) on delete set null,
  batch_item_id uuid references anthropic_batch_items(id) on delete set null,
  source_name text,
  source_lang text,
  original_title text,
  result_status text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_usage_logs_created_at
  on llm_usage_logs(created_at desc);

create index if not exists idx_llm_usage_logs_provider_operation_created
  on llm_usage_logs(provider, operation, created_at desc);

create index if not exists idx_llm_usage_logs_article_created
  on llm_usage_logs(article_id, created_at desc)
  where article_id is not null;

create index if not exists idx_llm_usage_logs_batch_item_created
  on llm_usage_logs(batch_item_id, created_at desc)
  where batch_item_id is not null;

create index if not exists idx_llm_usage_logs_run_created
  on llm_usage_logs(enrich_run_id, created_at desc)
  where enrich_run_id is not null;

alter table llm_usage_logs enable row level security;
