-- Weekly Telegram report: idempotent delivery log and exact Monday 11:00 MSK schedule.

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

alter table public.weekly_report_runs enable row level security;
revoke all on table public.weekly_report_runs from anon, authenticated;
grant select, insert, update on table public.weekly_report_runs to service_role;

create index if not exists idx_weekly_report_runs_week_desc
  on public.weekly_report_runs (week_start desc, created_at desc);

create or replace function public.claim_weekly_report_run(
  p_week_start date,
  p_chat_id text,
  p_format text,
  p_article_ids uuid[],
  p_message_hash text
)
returns table (run_id uuid, claimed boolean, existing_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  if cardinality(p_article_ids) <> 6 then
    raise exception 'weekly report requires exactly 6 article ids';
  end if;

  insert into public.weekly_report_runs (
    week_start, chat_id, format, status, article_ids, message_hash,
    telegram_message_id, error, started_at, finished_at, updated_at
  )
  values (
    p_week_start, p_chat_id, p_format, 'running', p_article_ids, p_message_hash,
    null, null, now(), null, now()
  )
  on conflict (week_start, chat_id) do update
    set format = excluded.format,
        status = 'running',
        article_ids = excluded.article_ids,
        message_hash = excluded.message_hash,
        telegram_message_id = null,
        error = null,
        started_at = now(),
        finished_at = null,
        updated_at = now()
  where weekly_report_runs.status = 'failed'
     or (
       weekly_report_runs.status = 'running'
       and weekly_report_runs.updated_at < now() - interval '15 minutes'
     )
  returning weekly_report_runs.id into v_run_id;

  if v_run_id is not null then
    return query select v_run_id, true, 'running'::text;
    return;
  end if;

  return query
    select wr.id, false, wr.status
    from public.weekly_report_runs wr
    where wr.week_start = p_week_start and wr.chat_id = p_chat_id;
end;
$$;

revoke all on function public.claim_weekly_report_run(date, text, text, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.claim_weekly_report_run(date, text, text, uuid[], text)
  to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tg-weekly-report') then
    perform cron.unschedule('tg-weekly-report');
  end if;
end $$;

-- Supabase pg_cron uses UTC in this project: 08:00 UTC = 11:00 Europe/Moscow.
select cron.schedule(
  'tg-weekly-report',
  '0 8 * * 1',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-weekly-report',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);
