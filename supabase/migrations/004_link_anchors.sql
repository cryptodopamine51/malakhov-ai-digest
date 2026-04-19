-- Migration 004: add link_anchors column for inline article linking
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS link_anchors text[];
