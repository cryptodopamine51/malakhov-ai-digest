-- Iteration 2 self-hosted staging adaptation.
--
-- Historical migrations 016, 017 and 20260622073323 also create live pg_cron
-- jobs aimed at news.malakhovai.ru. They are intentionally not applied on
-- staging. This additive replacement keeps their runtime table/RPC contracts
-- while keeping zero scheduled HTTP jobs until the owner-approved cutover.

create table if not exists public.telegram_channel_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivery_date date not null,
  content_date date not null,
  slot_no int not null check (slot_no between 1 and 5),
  channel_id text not null,
  article_id uuid references public.articles(id) on delete set null,
  status text not null check (status in ('planned','sending','success','failed_send','skipped_low_articles','skipped_no_article')),
  telegram_message_id bigint,
  caption text,
  caption_hash text,
  article_url text,
  cover_image_url text,
  story_key text,
  planned_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text
);
create unique index if not exists idx_tg_channel_posts_date_slot_channel on public.telegram_channel_posts(delivery_date, slot_no, channel_id);
create unique index if not exists idx_tg_channel_posts_article_success on public.telegram_channel_posts(channel_id, article_id) where status = 'success' and article_id is not null;
create index if not exists idx_tg_channel_posts_delivery_desc on public.telegram_channel_posts(delivery_date desc, slot_no asc);
create index if not exists idx_tg_channel_posts_sent_desc on public.telegram_channel_posts(sent_at desc) where status = 'success';

create or replace function public.update_telegram_channel_posts_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists update_telegram_channel_posts_updated_at on public.telegram_channel_posts;
create trigger update_telegram_channel_posts_updated_at before update on public.telegram_channel_posts for each row execute procedure public.update_telegram_channel_posts_updated_at();

create table if not exists public.weekly_report_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  chat_id text not null,
  format text not null check (format in ('signal', 'business', 'channel')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  article_ids uuid[] not null default '{}',
  message_hash text,
  telegram_message_id bigint,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_report_runs_week_chat_key unique (week_start, chat_id),
  constraint weekly_report_runs_six_articles_check check (cardinality(article_ids) = 6)
);
create index if not exists idx_weekly_report_runs_week_desc on public.weekly_report_runs (week_start desc, created_at desc);

create or replace function public.claim_weekly_report_run(
  p_week_start date, p_chat_id text, p_format text, p_article_ids uuid[], p_message_hash text
) returns table (run_id uuid, claimed boolean, existing_status text)
language plpgsql security invoker set search_path = public as $$
declare v_run_id uuid;
begin
  if cardinality(p_article_ids) <> 6 then raise exception 'weekly report requires exactly 6 article ids'; end if;
  insert into public.weekly_report_runs (week_start, chat_id, format, status, article_ids, message_hash, telegram_message_id, error, started_at, finished_at, updated_at)
  values (p_week_start, p_chat_id, p_format, 'running', p_article_ids, p_message_hash, null, null, now(), null, now())
  on conflict (week_start, chat_id) do update set format = excluded.format, status = 'running', article_ids = excluded.article_ids, message_hash = excluded.message_hash, telegram_message_id = null, error = null, started_at = now(), finished_at = null, updated_at = now()
  where weekly_report_runs.status = 'failed' or (weekly_report_runs.status = 'running' and weekly_report_runs.updated_at < now() - interval '15 minutes')
  returning weekly_report_runs.id into v_run_id;
  if v_run_id is not null then return query select v_run_id, true, 'running'::text; return; end if;
  return query select wr.id, false, wr.status from public.weekly_report_runs wr where wr.week_start = p_week_start and wr.chat_id = p_chat_id;
end;
$$;

-- The historical function is security definer in an exposed schema. Only the
-- service role is granted execution, so security invoker preserves the required
-- atomic lock while avoiding an exposed privileged function.
create or replace function public.publish_article(p_article_id uuid, p_verifier text)
returns text language plpgsql security invoker set search_path = public as $$
declare v_quality_ok boolean; v_publish_status text;
begin
  select quality_ok, publish_status into v_quality_ok, v_publish_status from public.articles where id = p_article_id for update;
  if not found then return 'not_eligible'; end if;
  if v_publish_status = 'live' then return 'already_live'; end if;
  if v_quality_ok is not true then return 'rejected_quality'; end if;
  if v_publish_status not in ('publish_ready', 'verifying') then return 'not_eligible'; end if;
  update public.articles set publish_status = 'live', verified_live = true, verified_live_at = now(), published = true, published_at = coalesce(published_at, now()), last_publish_verifier = p_verifier where id = p_article_id;
  return 'published_live';
end;
$$;

-- Default deny for every exposed runtime table, then grant the one public read
-- surface. service_role remains server-only and is checked over the REST API.
alter table public.articles enable row level security;
alter table public.anthropic_batch_items enable row level security;
alter table public.anthropic_batches enable row level security;
alter table public.article_attempts enable row level security;
alter table public.article_feedback enable row level security;
alter table public.article_quality_scores enable row level security;
alter table public.digest_runs enable row level security;
alter table public.enrich_runs enable row level security;
alter table public.ingest_runs enable row level security;
alter table public.llm_usage_logs enable row level security;
alter table public.pipeline_alerts enable row level security;
alter table public.source_runs enable row level security;
alter table public.telegram_channel_posts enable row level security;
alter table public.weekly_report_runs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.articles to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
