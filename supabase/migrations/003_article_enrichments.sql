-- Migration: article enrichments — glossary, tables, images
-- Apply via Supabase Dashboard → SQL Editor  (already applied via Management API)

ALTER TABLE articles ADD COLUMN IF NOT EXISTS glossary       jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS article_tables jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS article_images jsonb;
