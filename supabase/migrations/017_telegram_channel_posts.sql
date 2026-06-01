-- 017_telegram_channel_posts.sql
--
-- Replace the old one-message Telegram digest schedule with five standalone
-- channel posts per Moscow day. The app route must be deployed before these
-- pg_cron jobs are enabled.

create table if not exists public.telegram_channel_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivery_date date not null,
  content_date date not null,
  slot_no int not null check (slot_no between 1 and 5),
  channel_id text not null,
  article_id uuid references public.articles(id) on delete set null,
  status text not null check (status in (
    'planned',
    'sending',
    'success',
    'failed_send',
    'skipped_low_articles',
    'skipped_no_article'
  )),
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

create unique index if not exists idx_tg_channel_posts_date_slot_channel
  on public.telegram_channel_posts(delivery_date, slot_no, channel_id);

create unique index if not exists idx_tg_channel_posts_article_success
  on public.telegram_channel_posts(channel_id, article_id)
  where status = 'success' and article_id is not null;

create index if not exists idx_tg_channel_posts_delivery_desc
  on public.telegram_channel_posts(delivery_date desc, slot_no asc);

create index if not exists idx_tg_channel_posts_sent_desc
  on public.telegram_channel_posts(sent_at desc)
  where status = 'success';

create or replace function public.update_telegram_channel_posts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_telegram_channel_posts_updated_at on public.telegram_channel_posts;
create trigger update_telegram_channel_posts_updated_at
  before update on public.telegram_channel_posts
  for each row
  execute procedure public.update_telegram_channel_posts_updated_at();

alter table public.telegram_channel_posts enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'cron_bearer_token'
  ) then
    raise notice 'cron_bearer_token not found in vault — tg-channel-post jobs will fail until it exists.';
  end if;
end $$;

do $$
declare
  job text;
begin
  foreach job in array array[
    'tg-digest-weekday',
    'tg-digest-weekend',
    'tg-channel-post-1',
    'tg-channel-post-2',
    'tg-channel-post-3',
    'tg-channel-post-4',
    'tg-channel-post-5'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job) then
      perform cron.unschedule(job);
    end if;
  end loop;
exception when others then
  raise notice 'cron.unschedule no-op: %', sqlerrm;
end $$;

select cron.schedule(
  'tg-channel-post-1',
  '30 6 * * *',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-channel-post?slot=1',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

select cron.schedule(
  'tg-channel-post-2',
  '30 9 * * *',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-channel-post?slot=2',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

select cron.schedule(
  'tg-channel-post-3',
  '30 12 * * *',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-channel-post?slot=3',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

select cron.schedule(
  'tg-channel-post-4',
  '30 15 * * *',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-channel-post?slot=4',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

select cron.schedule(
  'tg-channel-post-5',
  '0 18 * * *',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-channel-post?slot=5',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);
