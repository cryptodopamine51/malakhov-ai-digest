-- Migration: content engine v2
-- Apply via Supabase Dashboard → SQL Editor

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS lead            TEXT,
  ADD COLUMN IF NOT EXISTS summary         TEXT[],
  ADD COLUMN IF NOT EXISTS card_teaser     TEXT,
  ADD COLUMN IF NOT EXISTS tg_teaser       TEXT,
  ADD COLUMN IF NOT EXISTS editorial_body  TEXT,
  ADD COLUMN IF NOT EXISTS editorial_model TEXT,
  ADD COLUMN IF NOT EXISTS quality_ok      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_quality
  ON articles(published, quality_ok, created_at DESC);
