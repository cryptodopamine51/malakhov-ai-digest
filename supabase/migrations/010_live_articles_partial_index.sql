-- Migration 010: partial indexes for public-read article queries.
-- Run outside a transaction because CREATE INDEX CONCURRENTLY cannot be wrapped.

create index concurrently if not exists idx_articles_live_ranked
  on articles (score desc, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';

create index concurrently if not exists idx_articles_live_pub_date
  on articles (pub_date desc nulls last, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';
