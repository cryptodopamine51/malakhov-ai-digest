-- Migration 009: idempotent Telegram digest lock
-- Adds an atomic lock for one Telegram digest per (digest_date, channel_id).

alter table digest_runs
  add column if not exists digest_date date,
  add column if not exists channel_id text,
  add column if not exists message_hash text,
  add column if not exists article_ids uuid[],
  add column if not exists telegram_message_id bigint,
  add column if not exists claimed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists error_message text;

update digest_runs
set digest_date = (created_at at time zone 'Europe/Moscow')::date
where digest_date is null;

update digest_runs
set channel_id = 'unknown'
where channel_id is null and status in ('success', 'running');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'digest_runs_status_check_v2'
  ) then
    alter table digest_runs
      add constraint digest_runs_status_check_v2
      check (status in ('running', 'success', 'skipped', 'low_articles', 'error', 'failed'));
  end if;
end $$;

create unique index if not exists idx_digest_runs_date_channel_live
  on digest_runs(digest_date, channel_id)
  where status in ('running', 'success');

create index if not exists idx_digest_runs_date_desc
  on digest_runs(digest_date desc, created_at desc);
