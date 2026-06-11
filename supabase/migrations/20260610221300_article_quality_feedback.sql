-- Wave 3: daily article quality judge + one-tap owner feedback.

create extension if not exists pgcrypto;

create table if not exists public.article_quality_scores (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  judge_model text not null,
  score smallint not null check (score between 1 and 5),
  reasons jsonb not null default '{}'::jsonb,
  writer_path text,
  sample_source text not null default 'daily_quality_judge',
  sampled_for_date date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_article_quality_scores_daily_unique
  on public.article_quality_scores(article_id, judge_model, sampled_for_date, sample_source);

create index if not exists idx_article_quality_scores_created
  on public.article_quality_scores(created_at desc);

create index if not exists idx_article_quality_scores_score_created
  on public.article_quality_scores(score asc, created_at desc);

create index if not exists idx_article_quality_scores_writer_created
  on public.article_quality_scores(writer_path, created_at desc)
  where writer_path is not null;

alter table public.article_quality_scores enable row level security;

create table if not exists public.article_feedback (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  rating smallint not null check (rating in (0, 1, 2)),
  source text not null default 'owner_tg' check (source in ('owner_tg')),
  telegram_chat_id bigint,
  telegram_message_id bigint,
  telegram_user_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_article_feedback_owner_source_unique
  on public.article_feedback(article_id, source);

create index if not exists idx_article_feedback_created
  on public.article_feedback(created_at desc);

create index if not exists idx_article_feedback_rating_created
  on public.article_feedback(rating, created_at desc);

alter table public.article_feedback enable row level security;

create or replace function public.update_article_feedback_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_article_feedback_updated_at on public.article_feedback;
create trigger update_article_feedback_updated_at
  before update on public.article_feedback
  for each row
  execute procedure public.update_article_feedback_updated_at();
