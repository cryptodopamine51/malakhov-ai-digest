-- Схема базы данных для Malakhov AI Digest
-- Применяется через Supabase Dashboard -> SQL Editor

CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_url    TEXT UNIQUE NOT NULL,
  original_title  TEXT NOT NULL,
  original_text   TEXT,
  source_name     TEXT NOT NULL,
  source_lang     TEXT NOT NULL CHECK (source_lang IN ('en', 'ru')),
  topics          TEXT[],
  pub_date        TIMESTAMPTZ,
  cover_image_url TEXT,
  ru_title        TEXT,
  ru_text         TEXT,
  why_it_matters  TEXT,
  dedup_hash      TEXT UNIQUE,
  enriched        BOOLEAN DEFAULT false,
  published       BOOLEAN DEFAULT false,
  tg_sent         BOOLEAN DEFAULT false,
  score           INTEGER DEFAULT 0,
  slug            TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Индекс для выборки опубликованных статей по дате (главная страница)
CREATE INDEX idx_articles_published ON articles(published, created_at DESC);

-- Индекс для фильтрации по темам (GIN для массивов)
CREATE INDEX idx_articles_topics ON articles USING GIN(topics);

-- Индекс для очереди Telegram-рассылки
CREATE INDEX idx_articles_tg ON articles(tg_sent, published, score DESC);

-- Индекс для поиска по слагу (URL страницы статьи)
CREATE INDEX idx_articles_slug ON articles(slug);

-- Триггер автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
