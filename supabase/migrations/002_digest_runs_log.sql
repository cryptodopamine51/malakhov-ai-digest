-- Migration: digest run log
-- Apply via Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS digest_runs (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     timestamptz DEFAULT now(),
  status         text        NOT NULL,  -- 'success' | 'skipped' | 'low_articles' | 'error'
  articles_count int,
  article_ids    uuid[],
  message_text   text,
  error_message  text,
  site_url       text
);

CREATE INDEX IF NOT EXISTS idx_digest_runs_created_at ON digest_runs(created_at DESC);
