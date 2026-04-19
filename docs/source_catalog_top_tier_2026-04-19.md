# Source Catalog: Top-Tier AI Inputs

## Tier A — must ingest

| Source | Domain | Type | Feed | Coverage | Notes |
|---|---|---|---|---|---|
| OpenAI News | openai.com | official lab | `https://openai.com/news/rss.xml` | lab releases, product launches | already in pipeline |
| Google Research Blog | research.google | official lab | `https://research.google/blog/rss` | research, models, papers | already in pipeline |
| Hugging Face Blog | huggingface.co | lab / OSS | `https://huggingface.co/blog/feed.xml` | OSS, models, infra | already in pipeline |
| AWS Machine Learning Blog | aws.amazon.com | platform / lab | `https://aws.amazon.com/blogs/machine-learning/feed/` | production ML, model launches, infra | verified 2026-04-19 |
| Microsoft Blogs | blogs.microsoft.com | platform / lab | `https://blogs.microsoft.com/feed/` | Copilot, Azure AI, model ecosystem | verified 2026-04-19, requires keyword filter |
| NVIDIA Blog | blogs.nvidia.com | platform / lab | `https://blogs.nvidia.com/feed/` | infra, robotics, model serving, chips | verified 2026-04-19, requires keyword filter |
| The Decoder | the-decoder.com | tech press | `https://the-decoder.com/feed/` | labs, product, market | already in pipeline |
| The Verge AI | theverge.com | tech press | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | product and consumer AI | already in pipeline |
| MIT Technology Review AI | technologyreview.com | deep analysis | `https://www.technologyreview.com/topic/artificial-intelligence/feed` | research and industry | already in pipeline |
| VentureBeat AI | venturebeat.com | enterprise AI press | `https://venturebeat.com/category/ai/feed/` | product, infra, enterprise | already in pipeline |
| Crunchbase News | news.crunchbase.com | funding / startup press | `https://news.crunchbase.com/feed/` | fundraising, valuations, startup market | verified 2026-04-19, keyword filtered |
| Habr AI | habr.com | RU editorial / practitioner | `https://habr.com/ru/rss/hubs/artificial_intelligence/articles/` | practical Russian AI scene | already in pipeline |

## Tier B — ingest with filters

| Source | Domain | Type | Feed | Coverage | Notes |
|---|---|---|---|---|---|
| TechCrunch AI | techcrunch.com | tech press | `https://techcrunch.com/category/artificial-intelligence/feed/` | good breadth, more noise | already in pipeline |
| TechCrunch Venture | techcrunch.com | venture press | `https://techcrunch.com/category/venture/feed/` | fundraising and valuation | keep strong keyword filter |
| Axios Pro Rata | axios.com | deal/newsletter press | `https://www.axios.com/feeds/feed/pro-rata` | market, deals, capital | keep strong keyword filter |
| Sequoia Capital | sequoiacap.com | investor blog | `https://sequoiacap.com/feed/` | AI company-building, capital, GTM | verified 2026-04-19, keyword filtered |
| a16z Blog | a16z.com | investor blog | `https://a16z.com/feed/` | startup and market theses | already in pipeline |
| YC Blog | ycombinator.com | startup ecosystem | `https://www.ycombinator.com/blog/rss.xml` | startup building and operator lessons | already in pipeline |
| vc.ru Финансы | vc.ru | RU business feed | `https://vc.ru/finance/rss` | RU investment coverage | already in pipeline |
| vc.ru Стартапы | vc.ru | RU startup feed | `https://vc.ru/startups/rss` | RU startup coverage | already in pipeline |

## Tier C — candidates / backlog

| Source | Domain | Why not active yet |
|---|---|---|
| Anthropic | anthropic.com | no stable public RSS endpoint confirmed on 2026-04-19 |
| Meta AI | ai.meta.com | no stable public RSS endpoint confirmed on 2026-04-19 |
| Mistral | mistral.ai | RSS endpoint not confirmed on 2026-04-19 |
| Cohere | cohere.com | RSS endpoint not confirmed on 2026-04-19 |
| Sifted | sifted.eu | feed access inconsistent / protected during checks |
| Lightspeed | lsvp.com | feed available behind redirects and protection, needs parser validation |

## Editorial selection rules

- Official lab sources outrank commentary blogs.
- Funding/startup sources must pass keyword filters to avoid generic VC noise.
- Broad corporate blogs are allowed only behind AI-specific keyword filters.
- RU sources stay, but must not dominate section mix to the point that Labs/Investments/Startups become mirror copies of `ai-russia`.
