-- 20260602120000_secure_backup_tables_rls.sql
--
-- Close Supabase advisor `rls_disabled_in_public`.
--
-- Two ad-hoc backup tables were created via `CREATE TABLE AS` outside the
-- migration history and left without RLS, so the public anon key (embedded in
-- the site) could read full article rows from them:
--   * articles_category_migration_backup_20260425  (category-model migration backup)
--   * articles_cover_snapshot_20260507             (cover snapshot before R2 move)
--
-- Enabling RLS with no policy makes them unreadable for anon/authenticated while
-- service_role keeps full access (service_role bypasses RLS). Data is preserved.
--
-- NOTE: public.batch_enrich_operational_state is intentionally NOT touched — it is
-- a `security_invoker = true` VIEW (migration 006) that runs with the caller's
-- privileges and therefore already respects the `articles` RLS policy.

do $$
begin
  if to_regclass('public.articles_category_migration_backup_20260425') is not null then
    execute 'alter table public.articles_category_migration_backup_20260425 enable row level security';
  end if;

  if to_regclass('public.articles_cover_snapshot_20260507') is not null then
    execute 'alter table public.articles_cover_snapshot_20260507 enable row level security';
  end if;
end $$;
