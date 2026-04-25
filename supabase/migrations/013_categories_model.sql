-- Wave 2.1: categories model
-- См. docs/spec_2026_04_25_site_improvements.md, ADR в docs/DECISIONS.md.
--
-- Идея: одна основная категория + до двух смежных вместо плоского массива topics[].
-- В этой миграции slug категории совпадает с текущими значениями topics для
-- обратной совместимости. Перенумерация slug-ов и редиректы — задача 2.2.

-- 1. Справочник категорий
CREATE TABLE IF NOT EXISTS categories (
  slug           text PRIMARY KEY,
  name_ru        text NOT NULL,
  description_ru text,
  order_index    integer NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO categories (slug, name_ru, description_ru, order_index) VALUES
  ('ai-industry',     'Индустрия',    'Главные новости индустрии искусственного интеллекта.', 10),
  ('ai-research',     'Исследования', 'Научные статьи, бенчмарки и архитектурные исследования.', 20),
  ('ai-labs',         'Лаборатории',  'Анонсы и обновления ведущих AI-лабораторий и моделей.', 30),
  ('ai-investments',  'Инвестиции',   'Раунды, M&A и оценки AI-компаний.', 40),
  ('ai-startups',     'Стартапы',     'AI-стартапы, продукты и альфа-материалы рынка.', 50),
  ('ai-russia',       'Россия',       'AI и технологии в России.', 60),
  ('coding',          'Код',          'Инструменты разработчика и programming-AI.', 70)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read_active_categories ON categories;
CREATE POLICY public_read_active_categories
ON categories
FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- 2. Новые поля в articles
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS primary_category     text,
  ADD COLUMN IF NOT EXISTS secondary_categories text[] NOT NULL DEFAULT '{}'::text[];

-- 3. Backfill из topics[].
--    primary_category ← первый известный topic, иначе fallback 'ai-industry'.
--    secondary_categories ← следующие до двух известных topic, без дубликата primary.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  WITH valid_topics AS (
    SELECT
      a.id,
      ARRAY(
        SELECT t
        FROM unnest(COALESCE(a.topics, ARRAY[]::text[])) WITH ORDINALITY AS u(t, ord)
        WHERE t IN (SELECT c.slug FROM categories c)
        ORDER BY ord
      ) AS known
    FROM articles a
    WHERE a.primary_category IS NULL
  ),
  resolved AS (
    SELECT
      id,
      COALESCE(NULLIF(known[1], ''), 'ai-industry') AS primary_slug,
      COALESCE(known[2:3], ARRAY[]::text[])         AS secondary_slugs
    FROM valid_topics
  )
  UPDATE articles a
  SET
    primary_category     = r.primary_slug,
    secondary_categories = r.secondary_slugs
  FROM resolved r
  WHERE a.id = r.id;

  SELECT COUNT(*)
    INTO orphan_count
    FROM articles
   WHERE topics IS NULL
      OR array_length(topics, 1) IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(topics) t WHERE t IN (SELECT slug FROM categories)
      );

  RAISE NOTICE 'Wave 2.1 backfill: articles without any known topic mapped to ai-industry: %', orphan_count;
END $$;

-- 4. Constraints и FK после backfill
ALTER TABLE articles
  ALTER COLUMN primary_category SET NOT NULL;

ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_primary_category_fk;
ALTER TABLE articles
  ADD CONSTRAINT articles_primary_category_fk
  FOREIGN KEY (primary_category) REFERENCES categories(slug)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_secondary_categories_max_2;
ALTER TABLE articles
  ADD CONSTRAINT articles_secondary_categories_max_2
  CHECK (
    secondary_categories IS NULL
    OR array_length(secondary_categories, 1) IS NULL
    OR array_length(secondary_categories, 1) <= 2
  );

-- 5. Индексы для category-feed выборок
CREATE INDEX IF NOT EXISTS idx_articles_primary_category
  ON articles(primary_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_secondary_categories
  ON articles USING gin(secondary_categories);

-- 6. updated_at trigger для categories (на случай ручного редактирования)
CREATE OR REPLACE FUNCTION categories_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS categories_set_updated_at ON categories;
CREATE TRIGGER categories_set_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION categories_set_updated_at();
