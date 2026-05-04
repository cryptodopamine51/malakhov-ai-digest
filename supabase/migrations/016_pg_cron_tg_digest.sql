-- Migration 016: strict-time Telegram digest scheduling via pg_cron + pg_net
--
-- Установлено вручную в проде 2026-05-04 — этот файл фиксирует факт,
-- чтобы при reprovisioning БД pipeline восстановился из миграций.
--
-- Контекст: Vercel Cron на Hobby plan (1) ограничен одним firing в день
-- на entry, (2) выполняется на best-effort schedule с задержкой до часа.
-- Для строгого 09:30/11:30 МСК ± 1 минута используется pg_cron внутри
-- Supabase, который дёргает Vercel-route через pg_net с тем же
-- CRON_SECRET. Vercel Cron остаётся как fallback — UNIQUE-claim в
-- digest_runs (digest_date+channel_id) защищает от дублей.

-- 1. Расширения
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Secret в Vault.
-- ВНИМАНИЕ: эта миграция не вставляет реальный токен — это сделано один
-- раз руками через Supabase Management API:
--   SELECT vault.create_secret('Bearer <CRON_SECRET>', 'cron_bearer_token', '...')
-- Перед применением миграции на свежую БД нужно сначала записать секрет
-- через Supabase Dashboard → Vault или ту же команду create_secret.
-- Здесь — только проверка наличия, чтобы schedule ниже не упал silently.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'cron_bearer_token'
  ) then
    raise notice 'cron_bearer_token не найден в vault — pg_cron jobs будут падать. Создай через vault.create_secret.';
  end if;
end $$;

-- 3. Идемпотентное снятие старых job (если переcоздаём).
do $$
begin
  perform cron.unschedule('tg-digest-weekday') where exists (
    select 1 from cron.job where jobname = 'tg-digest-weekday'
  );
  perform cron.unschedule('tg-digest-weekend') where exists (
    select 1 from cron.job where jobname = 'tg-digest-weekend'
  );
exception when others then
  raise notice 'cron.unschedule no-op: %', sqlerrm;
end $$;

-- 4. Расписания (pg_cron работает в timezone БД — проверь через SHOW timezone;
-- по умолчанию UTC, что нам и нужно):
-- 30 6 UTC = 09:30 МСК
-- 30 8 UTC = 11:30 МСК
-- 1-5 = Пн-Пт, 6,0 = Сб+Вс (cron convention: 0=воскресенье)
select cron.schedule(
  'tg-digest-weekday',
  '30 6 * * 1-5',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-digest',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

select cron.schedule(
  'tg-digest-weekend',
  '30 8 * * 6,0',
  $job$
  select net.http_get(
    url := 'https://news.malakhovai.ru/api/cron/tg-digest',
    headers := jsonb_build_object(
      'Authorization',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_bearer_token')
    )
  )
  $job$
);

-- 5. Проверка результата для оператора.
-- Запусти руками после миграции:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--    WHERE jobname LIKE 'tg-digest-%';
--   SELECT jobid, runid, start_time, status, return_message
--     FROM cron.job_run_details
--    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'tg-digest-%')
--    ORDER BY runid DESC LIMIT 10;
--   SELECT id, status_code, content::text, created
--     FROM net._http_response
--    ORDER BY id DESC LIMIT 5;
