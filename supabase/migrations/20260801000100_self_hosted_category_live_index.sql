-- Covers the category feed's public predicate and descending pagination order.
-- Kept partial so unpublished/rejected pipeline rows do not consume RAM/cache.
create index if not exists idx_articles_live_category_created
  on public.articles (primary_category, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';
