alter table public.article_attempts enable row level security;
alter table public.articles enable row level security;
alter table public.digest_runs enable row level security;
alter table public.enrich_runs enable row level security;
alter table public.ingest_runs enable row level security;
alter table public.pipeline_alerts enable row level security;
alter table public.source_runs enable row level security;

drop policy if exists public_read_live_articles on public.articles;

create policy public_read_live_articles
on public.articles
for select
to anon, authenticated
using (
  published = true
  and quality_ok = true
  and verified_live = true
  and publish_status = 'live'
);
