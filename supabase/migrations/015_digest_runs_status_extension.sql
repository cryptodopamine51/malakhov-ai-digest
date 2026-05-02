-- 015_digest_runs_status_extension.sql
--
-- Wave 2.4 (observability_publication_2026-05-01): любая ветка
-- bot/daily-digest.ts::main() обязана записать digest_runs row.
-- Старые row из миграций 002/009 имеют статусы из enum
-- ('running','success','skipped','low_articles','error','failed') и должны
-- продолжать существовать. Поэтому здесь — НАДМНОЖЕСТВО, не replace.
--
-- См. docs/spec_observability_publication_2026-05-01.md § 6.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'digest_runs_status_check_v2'
  ) then
    alter table digest_runs drop constraint digest_runs_status_check_v2;
  end if;
end $$;

alter table digest_runs
  add constraint digest_runs_status_check_v2
  check (status in (
    -- legacy (миграции 002 и 009) — оставляем, чтобы старые row не падали
    'running',
    'success',
    'skipped',
    'low_articles',
    'error',
    'failed',
    -- новые точные коды (spec § 6) — main() пишет их вместо общих
    'skipped_already_claimed',
    'skipped_no_articles',
    'skipped_outside_window',
    'failed_send',
    'failed_pipeline_stalled'
  ));
