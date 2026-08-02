# P0 Task — восстановление Supabase и перенос Malakhov AI Digest на VPS

> Рабочий документ для выполнения в **трёх независимых чатах Codex**.
> Каждый новый чат обязан начать с чтения этого файла целиком и продолжить с первой
> незавершённой итерации. Документ не заменяет канонические `docs/ARCHITECTURE.md`,
> `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md` и `docs/DECISIONS.md`.
>
> Создан: 2026-08-01
> Приоритет: **P0 / production recovery**
> Статус: **READY FOR ITERATION 1**
> Владелец: Иван Малахов
> Production domain: `https://news.malakhovai.ru`

## 1. Цель

За 2–3 последовательные итерации:

1. Восстановить из локального Next.js fetch-cache максимум данных удалённого Supabase.
2. Поднять на VPS совместимый self-hosted Supabase/Postgres API без массового переписывания
   текущего `@supabase/supabase-js` кода.
3. Импортировать восстановленные новости и сохранить evergreen-контент.
4. Развернуть Next.js на VPS, восстановить RSS/enrich/publish/Telegram/monitoring.
5. Переключить production с Vercel только после объективных quality gates.
6. Настроить проверяемые резервные копии и documented rollback, чтобы повторная потеря одной
   платформы больше не могла уничтожить данные.

## 2. Зафиксированные факты на момент старта

### 2.1 Локальный проект

- Workspace: `/Users/malast/malakhov-ai-digest`
- Branch: `codex/prod-release-2026-06-17`
- HEAD на момент аудита: `66773647633711082ec54c137aa916084c2ae100`
- Worktree **грязный**: 74 modified/untracked entries на момент аудита.
- Чужие/предшествующие изменения нельзя сбрасывать, перезаписывать или «чистить».
- Запрещены `git reset --hard`, `git clean`, `git checkout -- <path>` и `git stash -u`.
- Старый Supabase ref: `oziddrpkwzsdtsibauon`.
- Старый host `oziddrpkwzsdtsibauon.supabase.co` не резолвится (`ENOTFOUND`).
- Текущий production всё ещё отвечает через Vercel; DNS `news.malakhovai.ru` указывал на
  `76.76.21.21` во время аудита.
- `content/evergreen/packages`: 18 локальных evergreen packages.
- `content/news/articles`: 0 сохранённых local-news JSON на момент аудита.
- `.next/cache/fetch-cache`: 3 959 Supabase REST response snapshots.
- Из кэша доказанно извлекаются 741 уникальная статья:
  - `published=true`;
  - `quality_ok=true`;
  - `publish_status=live`;
  - полный `editorial_body` длиной не менее 1200 символов;
  - response window: 2026-06-17 — 2026-06-24;
  - article update window: 2026-05-26 — 2026-06-24.

Категории восстановимого набора:

| Категория | Статей |
|---|---:|
| `ai-industry` | 208 |
| `ai-russia` | 187 |
| `ai-research` | 121 |
| `ai-labs` | 102 |
| `ai-investments` | 52 |
| `coding` | 38 |
| `ai-startups` | 33 |
| **Всего** | **741** |

Важно: до завершения Iteration 1 нельзя удалять `.next`, запускать cache cleanup или команды,
которые могут перегенерировать/очистить `.next/cache/fetch-cache`.

### 2.2 VPS

- IP: `195.245.239.84`
- SSH user: `root`
- SSH identity на Mac: `/Users/malast/.ssh/codex_malakhov_ai_vps`
- Expected SSH ED25519 host fingerprint:
  `SHA256:QCYBWOPiJBAT3+AOvP2x6r5lm10KFeGMU2h1dyLQ4X4`
- Проверенная команда подключения:

```bash
ssh -i /Users/malast/.ssh/codex_malakhov_ai_vps \
  -o IdentitiesOnly=yes \
  root@195.245.239.84
```

Не использовать SSH alias `malakhov-ai-vps` без проверки: на момент аудита он указывал на
старый IP `82.22.146.66`.

Inventory 2026-08-01:

| Параметр | Значение |
|---|---|
| Hostname | `226783.com` |
| OS | Ubuntu 24.04 LTS x86_64 |
| CPU | 4 vCPU |
| RAM | 7.8 GiB, доступно 7.2 GiB |
| Swap | 512 MiB |
| Disk | 60 GB, свободно около 52 GB |
| Docker / Node / Caddy / Postgres | не установлены |
| Firewall | UFW установлен, но inactive |
| Existing services | `x-ui` / `xray` |
| Existing listening ports | SSH 22, x-ui/xray 2096 и 21417, local 11111/62789 |

**Инвариант:** миграция не должна останавливать, перенастраивать или закрывать `x-ui/xray`.
Нельзя включать UFW, пока не подтверждены необходимые владельцу порты 2096/21417 и не создан
проверенный rollback для SSH.

## 3. Выбранная архитектура

### 3.1 Решение

На VPS разворачивается version-pinned Docker stack:

```text
Internet
  |
  +-- news.malakhovai.ru:443 --> Caddy --> Next.js 15
  |
  +-- api.news.malakhovai.ru:443 --> Caddy --> Supabase API gateway/PostgREST
                                                  |
                                                  +--> PostgreSQL 17
                                                  +--> Supavisor/pooler

GitHub Actions --> HTTPS Data API (service key, never public/client-side)
Postgres pg_cron/pg_net --> HTTPS Next.js cron routes where still required
Cloudflare R2 --> article images/covers (existing subsystem)
```

Причина: текущий runtime широко использует Supabase query builder и RPC. Совместимый API сохраняет
поведение `.from()`, `.rpc()`, RLS и роли, сокращая риск и объём изменений. Прямое переписывание
всего проекта на `postgres`, Prisma или другой ORM не входит в P0 recovery.

### 3.2 Ограничение версий

- Перед реализацией каждой итерации проверить официальный Supabase changelog и self-host docs.
- Не разворачивать плавающий `master`/`latest` без фиксации.
- Зафиксировать Supabase release/commit, все Docker image tags и lockfile.
- Учесть актуальные breaking changes self-hosted Supabase: PostgreSQL 17, смену владельца Studio
  и переход API gateway Kong → Envoy.
- Не использовать `supabase start` как production runtime.

### 3.3 Сетевой контур

- Публичны только 22, 80, 443 и уже используемые владельцем x-ui/xray ports.
- PostgreSQL 5432/6543, Studio, Docker socket и внутренние service ports не публикуются наружу.
- Public Data API получает только необходимые routes.
- `service_role`/secret key никогда не попадает в `NEXT_PUBLIC_*`, browser bundle, Git или логи.
- Public read идёт с anon/publishable role и RLS; административные операции — только server-side.
- Для Postgres используется connection pooler и ограниченный connection budget.

### 3.4 Планировщики

Не дублировать одну задачу одновременно в pg_cron, systemd и GitHub Actions.

Предпочтительный P0-вариант:

- RSS/enrich/retry/health/publish verification оставить в GitHub Actions и заменить только
  `SUPABASE_URL`/keys.
- Точные Telegram jobs, уже описанные в migrations через `pg_cron`/`pg_net`, направить на новый
  Next.js runtime после проверки Vault secret и idempotency.
- Backup GitHub workflows оставить только как backup, не как второй активный primary schedule.
- Для каждой job документировать: primary scheduler, backup scheduler, timezone, concurrency key,
  idempotency/claim mechanism и manual test.

## 4. Общие правила для всех итераций

1. В начале выполнить `npm run context` и прочитать:
   - этот task;
   - `CLAUDE.md`;
   - `docs/INDEX.md`;
   - `docs/ARCHITECTURE.md`;
   - `docs/ARTICLE_SYSTEM.md`;
   - релевантные разделы `docs/OPERATIONS.md`;
   - `docs/DECISIONS.md`.
2. Использовать skills `supabase` и `supabase-postgres-best-practices`.
3. Перед изменениями зафиксировать `git status --short` и не трогать unrelated dirty files.
4. Не выводить secret values. Проверки env печатают только `set/missing`.
5. Все VPS-записи выполняются через `/srv/malakhov-ai-digest` или явно документированный путь.
6. Не менять DNS, production secrets и активные cron schedules до соответствующего gate.
7. Любая schema/data mutation сначала проверяется на disposable/local DB или в transaction.
8. Миграции применяются с `ON_ERROR_STOP=1`; частично применённая схема не принимается.
9. Любое значимое изменение получает тест и обновление канонической документации.
10. В конце итерации обновить секцию `Progress / Handoff log` этого файла.
11. Не объявлять успех по одному HTTP 200. Требуются все gates текущей итерации.
12. Не удалять Vercel project и не отключать старый deployment в рамках этих итераций.

## 5. Quality gates всей миграции

### Gate S0 — Safety

- [ ] Зафиксированы branch, HEAD, dirty status и inventory.
- [ ] Создан независимый архив current worktree, включая untracked files.
- [ ] `.next/cache/fetch-cache` скопирован/заархивирован до любых build/clean действий.
- [ ] Для всех архивов записан SHA-256.
- [ ] `x-ui/xray` health и listening ports зафиксированы до изменений.
- [ ] Есть команда SSH rollback и проверен второй SSH session перед firewall changes.

### Gate R1 — Recovery

- [ ] Recovery extractor детерминирован и покрыт тестами.
- [ ] Получено ровно 741 уникальных live quality articles либо документировано и доказано
  большее корректное число.
- [ ] Ноль duplicate `id`, `slug`, `original_url` в import set.
- [ ] У каждой строки сохранены все исходные поля, включая неизвестные extractor типу.
- [ ] Созданы manifest, field statistics, rejection report и SHA-256.
- [ ] Recovery archive существует минимум в двух независимых местах: Mac + VPS.

### Gate D2 — Database/API

- [ ] Все 14 runtime tables и 3 RPC functions существуют.
- [ ] Schema parity tests зелёные.
- [ ] 741 восстановленная статья импортирована без silent truncation.
- [ ] Required indexes существуют и используются ключевыми query plans.
- [ ] `anon` читает только допустимые live rows.
- [ ] `anon` не может insert/update/delete.
- [ ] `service_role` выполняет необходимые server-side writes/RPC.
- [ ] PostgreSQL/API ports не торчат наружу сверх утверждённого HTTPS API.
- [ ] Pooler и connection limits настроены по RAM/CPU VPS.

### Gate A3 — Application

- [ ] `npm test` green.
- [ ] `npx tsc --noEmit` green.
- [ ] `npm run docs:check` green.
- [ ] Production-equivalent `npm run build` green.
- [ ] Главная не пустая и отдаёт recovered news.
- [ ] Все категории открываются и пагинация не теряет >1000 URL.
- [ ] Выборка не менее 30 детерминированных article URLs отдаёт 200 и правильный canonical.
- [ ] Evergreen guides продолжают открываться.
- [ ] RSS, sitemap, news sitemap, robots, `llms.txt`, `llms-full.txt` валидны.
- [ ] `/api/health` и internal dashboard работают с правильной авторизацией.
- [ ] Нет browser-side service key.

### Gate P4 — Pipeline/Telegram

- [ ] RSS ingest создаёт новую строку или корректно фиксирует duplicate.
- [ ] Enrich claim/release/RPC lifecycle проверен.
- [ ] Publish verification переводит тестовую статью ожидаемым образом.
- [ ] Retry/recover не создают двойных claims.
- [ ] Telegram digest/channel/weekly report проходят dry-run или безопасный owner-approved test.
- [ ] Проверена idempotency: повторный запуск не создаёт повторную публикацию/отправку.
- [ ] Каждый cron имеет ровно один primary scheduler.
- [ ] Monitoring создаёт и закрывает тестовый alert.

### Gate B5 — Backup/Restore

- [ ] Ежедневный logical backup автоматизирован.
- [ ] Backup зашифрован до отправки во внешнее хранилище.
- [ ] Есть offsite copy; единственная копия на том же VPS не считается backup.
- [ ] Определены retention: минимум 7 daily, 4 weekly, 6 monthly.
- [ ] Backup job пишет timestamp, size, checksum и exit status.
- [ ] Проведён полный restore drill в disposable database.
- [ ] После restore совпадают row counts и контрольная выборка/checksum.

### Gate C6 — Cutover

- [ ] Pre-cutover smoke зелёный с локального VPS и через staging Host header/domain.
- [ ] DNS target и TTL подтверждены.
- [ ] TLS certificate валиден.
- [ ] После DNS с двух независимых резолверов виден новый IP.
- [ ] 30–60 минут synthetic monitoring без critical alerts.
- [ ] Rollback на Vercel возможен без потери новых DB writes.
- [ ] Через 24 часа повторены backup, health, RSS, Telegram и sample URL checks.

## 6. Итерация 1 — спасти данные и поднять foundation

### Цель

Получить проверяемый recovery archive и работающий, но ещё не production, version-pinned
self-hosted Supabase foundation на VPS. DNS и пользовательский production не менять.

### Обязательные работы

1. Выполнить Safety Gate S0.
2. Создать recovery extractor в `scripts/`:
   - вход по умолчанию `.next/cache/fetch-cache`;
   - принимать `--input`, `--output`, `--dry-run`;
   - парсить только outer records `kind=FETCH`;
   - whitelist host старого Supabase и path `/rest/v1/articles`;
   - декодировать base64 body и валидировать JSON;
   - дедуплицировать по `id`;
   - при нескольких версиях выбирать строку с максимальным `updated_at`, затем response date;
   - сохранять неизвестные поля без потери;
   - не включать headers/cookies/API keys в export;
   - создавать JSONL/JSON или COPY-friendly export, manifest, rejected report, SHA-256.
3. Добавить fixture-based unit tests extractor:
   - valid array;
   - invalid JSON/base64;
   - wrong host/path;
   - duplicate versions;
   - unknown fields preserved;
   - secrets/cookies absent;
   - deterministic ordering/checksum.
4. Запустить extractor на реальном cache и доказать Gate R1.
5. Скопировать зашифрованный/закрытый recovery archive на VPS, не в web root.
6. Добавить `infra/vps/`:
   - pinned compose/config;
   - `.env.example` без secret values;
   - deploy/preflight/health/backup helpers;
   - Docker log rotation и volume locations;
   - запрет публикации DB/Studio ports;
   - README с точными версиями и rollback.
7. Проверить официальный Supabase changelog/docs и записать выбранный release/commit/image tags.
8. Установить Docker Engine/Compose на VPS официальным способом.
9. Поднять foundation в `/srv/malakhov-ai-digest` с persistent volumes.
10. Создать strong secrets на VPS с mode 600; значения не писать в чат или Git.
11. Проверить container health, disk footprint, restart policy и отсутствие port conflicts.
12. Не импортировать данные в production DB, пока schema/RLS preflight не зелёные.

### Тесты Iteration 1

```bash
npm run context
npx tsx --test tests/node/recover-supabase-cache.test.ts
npm test
npx tsc --noEmit
npm run docs:check
```

На VPS дополнительно:

- `docker compose config` без ошибок;
- все нужные containers healthy;
- `ss -lntup` не показывает public PostgreSQL/Studio;
- `x-ui/xray` ports и processes не изменились;
- stop/start foundation сохраняет test sentinel в Postgres volume.

### Definition of Done Iteration 1

- Gates S0 и R1 полностью закрыты.
- Self-host foundation healthy, но DNS/production не затронуты.
- Recovery archive есть на Mac и VPS с совпадающим checksum.
- Есть точный handoff для Iteration 2: версии, paths, container names, missing inputs и риски.

### Готовый промпт для нового чата — Iteration 1

```text
Выполни Iteration 1 из docs/task_vps_supabase_recovery_2026-08-01.md полностью.
Это P0 recovery. Сначала прочитай task, CLAUDE.md, docs/INDEX.md и канонические docs,
запусти npm run context, используй Supabase и Postgres best-practices skills.
SSH: root@195.245.239.84, key /Users/malast/.ssh/codex_malakhov_ai_vps,
expected host fingerprint SHA256:QCYBWOPiJBAT3+AOvP2x6r5lm10KFeGMU2h1dyLQ4X4.
Не трогай unrelated dirty files, не очищай .next до recovery archive, не меняй DNS,
не останавливай x-ui/xray. Работай до закрытия S0/R1 и DoD Iteration 1,
прогони все тесты и заполни Progress / Handoff log в task-файле.
```

## 7. Итерация 2 — схема, импорт, приложение и automation staging

### Цель

Получить полностью работающую staging-копию системы на VPS с восстановленными данными, но без
переключения основного DNS, пока не закрыты Database/Application/Pipeline gates.

### Обязательные работы

1. Проверить handoff Iteration 1, checksums и container health.
2. Создать reproducible schema bootstrap из `supabase/schema.sql` + всех migrations.
3. Обработать cloud-specific cron/vault безопасно:
   - schema/migrations применять в transaction с `ON_ERROR_STOP=1`;
   - не допустить выполнения старых jobs до новой конфигурации;
   - после применения сверить полный список tables/functions/indexes/policies/grants;
   - перенастроить cron endpoints/secrets только после application health.
4. Не редактировать уже применённые historical migrations без обоснования. Self-host adaptation
   оформить отдельным versioned migration/deploy wrapper и тестами.
5. Запустить migration parity и schema guard.
6. Импортировать recovery set idempotent/upsert-safe способом.
7. Проверить counts, duplicates, required fields, category distribution и sample checksums.
8. Провести security/RLS tests для anon и service roles.
9. Добавить production Dockerfile/standalone Next.js runtime, если его ещё нет.
10. Развернуть Next.js staging на внутреннем порту/Docker network.
11. Настроить Caddy config, но не переключать основной DNS без Gate C6.
12. Настроить `api.news.malakhovai.ru` или утверждённый API hostname через Caddy; Studio оставить
    private-only.
13. Перенести server-only env из локального защищённого источника; вывести только names set/missing.
14. Провести safe pipeline tests. Telegram send допускается только как явно согласованный тест;
    по умолчанию mock/dry-run.
15. Составить scheduler matrix и устранить двойное расписание.
16. Обновить `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`,
    `docs/DECISIONS.md` по фактически реализованной архитектуре.

### Обязательные DB assertions

```sql
-- Ожидается 741 либо доказанно больше корректно восстановленных live rows.
select count(*) from public.articles
where published is true and quality_ok is true and publish_status = 'live';

-- Все три результата должны быть 0.
select count(*) from (
  select id from public.articles group by id having count(*) > 1
) d;
select count(*) from (
  select slug from public.articles where slug is not null group by slug having count(*) > 1
) d;
select count(*) from (
  select original_url from public.articles group by original_url having count(*) > 1
) d;
```

Дополнительно проверить существование runtime surface:

- tables: `articles`, `anthropic_batch_items`, `anthropic_batches`, `article_attempts`,
  `article_feedback`, `article_quality_scores`, `digest_runs`, `enrich_runs`, `ingest_runs`,
  `llm_usage_logs`, `pipeline_alerts`, `source_runs`, `telegram_channel_posts`,
  `weekly_report_runs`;
- RPC: `apply_anthropic_batch_item_result`, `claim_weekly_report_run`, `publish_article`.

### Тесты Iteration 2

```bash
npm test
npx tsc --noEmit
npm run docs:check
npm run build
```

Плюс обязательны:

- migration parity/schema guard;
- API role tests;
- 30 deterministic article smoke URLs;
- category pagination/sitemap tests;
- health/RSS/sitemap XML validation;
- safe ingest/enrich/publish lifecycle;
- duplicate/idempotency tests;
- container restart persistence test.

### Definition of Done Iteration 2

- Gates D2, A3 и P4 закрыты на staging.
- 741+ статей доступны через API и Next.js staging.
- Главная/категории/статьи/evergreen/RSS/sitemap не пустые.
- Schedulers описаны и не дублируются.
- Production DNS ещё не переключён, если Gate C6 не начат владельцем.
- Handoff содержит точные owner actions для DNS/GitHub secrets, если они нужны.

### Готовый промпт для нового чата — Iteration 2

```text
Продолжи P0 migration по docs/task_vps_supabase_recovery_2026-08-01.md и выполни
Iteration 2 полностью. Сначала прочитай весь task и Progress / Handoff log, затем CLAUDE.md,
docs/INDEX.md и канонические docs; запусти npm run context и используй Supabase/Postgres skills.
SSH: root@195.245.239.84, key /Users/malast/.ssh/codex_malakhov_ai_vps,
expected fingerprint SHA256:QCYBWOPiJBAT3+AOvP2x6r5lm10KFeGMU2h1dyLQ4X4.
Не меняй основной DNS и не отправляй реальные Telegram-посты без явного безопасного gate.
Не трогай unrelated dirty files или x-ui/xray. Закрой D2/A3/P4 на staging, прогони полный
набор тестов, обнови канонические docs и Progress / Handoff log.
```

## 8. Итерация 3 — backup drill, production cutover и наблюдение

### Цель

Закрыть backup/restore и security hardening, безопасно переключить production, проверить все
пользовательские и операционные контуры и оставить документированный rollback.

### Обязательные работы

1. Повторно проверить все gates Iteration 1–2; stale результаты не принимать.
2. Настроить backup script/timer:
   - logical dump roles/schema/data совместимым способом;
   - compression;
   - encryption до offsite upload;
   - checksum/manifest;
   - retention;
   - alert при failure или слишком маленьком dump.
3. Не складывать plaintext DB dump в public R2 bucket.
4. Выполнить полный restore drill в disposable database и сравнить counts/checksums/API query.
5. Настроить monitoring:
   - container health/restarts;
   - disk/RAM;
   - Postgres connections/locks;
   - backup freshness;
   - site feed, RSS, pipeline backlog, Telegram;
   - TLS expiration.
6. Проверить firewall plan без потери x-ui/xray. UFW включать только с сохранением SSH и явно
   подтверждённых owner ports; открыть второй SSH session до применения.
7. Подготовить DNS rollback values и зафиксировать текущий Vercel target.
8. Переключить сначала API hostname, проверить GitHub Actions manual dispatch.
9. Обновить GitHub Actions `SUPABASE_URL`/keys без вывода values и проверить workflows.
10. Переключить `news.malakhovai.ru` на VPS только после pre-cutover green.
11. Проверить TLS, canonical, redirects, feeds, sitemap, sample articles, Telegram и health снаружи.
12. Выполнить synthetic burst/sustained smoke без разрушительной нагрузки.
13. Наблюдать минимум 30–60 минут; critical alert блокирует завершение.
14. Vercel оставить доступным для rollback минимум 48 часов.
15. Обновить canonical docs и этот task фактическими endpoints, schedules, backup path/retention,
    rollback и post-cutover evidence.
16. Составить owner follow-up на 24 часа и 7 дней.

### Rollback conditions

Немедленно возвращать DNS на Vercel либо останавливать cutover при любом из условий:

- empty homepage/feed;
- error rate >1% на synthetic smoke;
- потеря/дублирование article routes;
- TLS/canonical/redirect loop;
- service key exposure;
- DB/API port открыт публично;
- failed restore drill;
- повторная Telegram-отправка;
- x-ui/xray degradation;
- unexplained row-count/checksum mismatch;
- critical pipeline/health alert.

Rollback не должен откатывать или уничтожать новые записи Postgres. Перед DNS rollback сохранить
logical dump и зафиксировать write window.

### Definition of Done Iteration 3

- Gates B5 и C6 закрыты.
- Production domain обслуживается VPS и показывает recovered/new content.
- GitHub Actions/cron/Telegram работают без дублей.
- Restore drill доказан, offsite backup существует.
- Vercel сохранён как временный rollback.
- `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`, `docs/DECISIONS.md`
  и `CLAUDE.md` отражают реальность.
- В task записаны evidence, unresolved risks и owner checks на 24h/7d.

### Готовый промпт для нового чата — Iteration 3

```text
Заверши P0 migration по docs/task_vps_supabase_recovery_2026-08-01.md: выполни Iteration 3.
Прочитай task целиком, особенно Progress / Handoff log и все незакрытые gates; затем CLAUDE.md,
docs/INDEX.md и канонические docs, запусти npm run context, используй Supabase/Postgres skills.
SSH: root@195.245.239.84, key /Users/malast/.ssh/codex_malakhov_ai_vps,
expected fingerprint SHA256:QCYBWOPiJBAT3+AOvP2x6r5lm10KFeGMU2h1dyLQ4X4.
Сначала докажи backup restore drill и pre-cutover gates, затем делай DNS cutover с rollback.
Не удаляй Vercel и не нарушай x-ui/xray. Прогони все tests/smokes, наблюдай production минимум
30–60 минут, обнови canonical docs и закрой task только при фактическом выполнении всех gates.
```

## 9. Допустимый двухитерационный режим

Если Iteration 1 прошла без blockers, Iteration 2 может включить Iteration 3 в том же чате только
при одновременном выполнении условий:

- все S0/R1/D2/A3/P4 gates зелёные;
- доступны DNS changes и GitHub secret update;
- backup restore drill завершён до DNS;
- нет missing secret/owner decision;
- остаётся достаточно времени на 30–60 минут post-cutover monitoring.

Нельзя сокращать работу путём пропуска тестов, restore drill, security gates или rollback.

## 10. Progress / Handoff log

### 2026-08-02 — Telegram scheduler reliability follow-up

Status: PARTIAL — VPS primary live-accepted; default-branch workflow update awaits merge path

- Root cause: GitHub Actions was made the sole Telegram primary after cutover,
  but scheduled runs were delayed by 53–126 minutes; a hosted schedule is not
  an exact scheduler.
- Target architecture: VPS systemd primary at 09:30, 12:30, 15:30, 18:30,
  21:00 Europe/Moscow; GitHub delayed backup five minutes later; the existing
  conditional DB claim remains the shared duplicate guard.
- Safety boundary: enable timers only; do not manually start a delivery unit
  outside a natural slot. x-ui/xray and unrelated containers are out of scope.
- Caveat: GitHub reads scheduled workflow definitions from default `main`; a
  PR to the production release branch cannot alone activate a changed workflow
  definition on `main`.
- Implementation / commit: `codex/tg-vps-scheduler-reliability` /
  `aaaf9fd` (`fix(telegram): restore VPS primary scheduler`), draft PR #26 to
  `codex/vps-recovery-final`.
- VPS: five `malakhov-tg-channel-post-{1..5}.timer` units installed and
  enabled; `EnvironmentFile=/etc/malakhov-ai-digest/tg-channel-post.env` is
  root-owned mode 0600. `systemd-analyze verify` and calendar validation
  passed. Production has `pg_net` only; no `pg_cron` extension, `cron` schema
  or Telegram DB jobs. x-ui/xray and unrelated containers were untouched.
- Catch-up/live acceptance: after a fresh DB gate found zero rows in slot 1
  with `success`/`sending`, and GitHub had no 2026-08-02 backup run, the
  owner-authorized `systemctl start malakhov-tg-channel-post@1.service` ran at
  10:19 MSK. It completed HTTP 2xx and produced exactly one `success` row for
  `2026-08-02/slot=1`, `telegram_message_id=220`; DB count and distinct message
  ID count are both one. Slots 2–4 remain planned, slot 5 is legitimately
  `skipped_no_article`; no backup run or duplicate row appeared afterwards.
- Validation: 415/415 `npm test`, `npx tsc --noEmit`, `npm run docs:check`,
  actionlint, ShellCheck, `git diff --check`, and production build with
  protected production public build inputs passed. PR #26 CI build/quality and
  docs guard passed. Public site, RSS, sitemap and API feed returned HTTP 200;
  app/Caddy/Postgres containers were healthy.
- Remaining action: merge/reconcile the workflow file into default `main` (or
  explicitly preserve its current backup after review). Until then, the active
  `main` workflow retains its legacy manual-dispatch semantics; VPS systemd is
  the live exact primary and the PR contains the safe delayed-backup replacement.

Каждая итерация добавляет запись по шаблону, не удаляя предыдущие:

```text
### YYYY-MM-DD — Iteration N
Status: COMPLETE | PARTIAL | BLOCKED
Git branch / HEAD:
Local files changed:
VPS changes:
Pinned versions:
Recovery/DB counts and checksums:
Tests executed and exact results:
Quality gates closed:
Quality gates still open:
Production/DNS impact:
Secrets missing (names only):
Risks/blockers:
Rollback state:
Exact next action:
Docs updated: ...
```

### 2026-08-01 — Planning / connectivity audit

Status: COMPLETE

- SSH confirmed as `root@195.245.239.84` using local dedicated key.
- Expected host fingerprint recorded.
- VPS inventory recorded; no server mutation performed.
- Existing x-ui/xray ports recorded as protected scope.
- Local Supabase DNS failure confirmed.
- Next fetch-cache recovery surface measured: 3 959 snapshots, 741 complete live articles.
- Three-iteration execution contract created.
- Planning checks: `git diff --check` green.
- Pre-existing docs gate: `npm run docs:check` reports missing `docs/ARCHITECTURE.md` update caused
  by the already dirty `lib/supabase.ts`; Iteration 1 must reconcile the current local-first reader
  contract with canonical architecture before its DoD.
- Quality gates still open: S0, R1, D2, A3, P4, B5, C6.
- Production/DNS impact: none.
- Exact next action: execute Iteration 1 prompt.

Docs updated: `CLAUDE.md`, `docs/INDEX.md`,
`docs/task_vps_supabase_recovery_2026-08-01.md`

### 2026-08-01 — Iteration 1

Status: COMPLETE

- Git branch / HEAD: `codex/vps-recovery-iter1` / `66773647633711082ec54c137aa916084c2ae100` before the Iteration 1 commit.
- Local files changed: `scripts/recover-supabase-cache.ts`, its fixture-based test,
  `infra/vps/`, `docs/DECISIONS.md`, P0 additions to `docs/OPERATIONS.md`, and this task log.
  The already dirty `docs/OPERATIONS.md` is included only because the P0 runtime-script
  contract maps to that canonical document; unrelated hunks must not be staged.
- VPS changes: Docker Engine `29.7.1` / Compose `5.3.1` installed through Docker's official
  Ubuntu repository. A root-only Supabase foundation is running from
  `/srv/malakhov-ai-digest/supabase-source/docker`; recovery data is root-only in
  `/srv/malakhov-ai-digest/recovery`. No DNS, Vercel, UFW, x-ui/xray configuration,
  scheduler, schema, or recovery-data import was changed.
- Pinned versions: Supabase `v1.26.07`, commit
  `949a57d2854b7fcadc0d621cb7fffa167506d581`; PostgreSQL
  `supabase/postgres:17.6.1.136`; complete image lock is `infra/vps/LOCK.json`.
  This pinned release deliberately retains Kong before the documented 2026-08-09 default
  Envoy switch; any upgrade requires a separate review.
- Recovery/DB counts and checksums: original source cache fingerprint = 3,959 files,
  2026-06-17T12:14:45Z through 2026-06-24T14:14:15Z, Merkle SHA-256
  `83a4117f1effd24b4187120665bc1098f28e3c591c0123290251cd22838a84f0`.
  Verified safety copy has the identical fingerprint. Extractor output = 741 articles,
  no duplicate `id` / `slug` / `original_url`; `articles.jsonl` SHA-256
  `22c498dd256e21c3ffbda2a81236dc33c499a1cd771ecde6f1b574048d28364b`.
  The closed archive `recovery-export-20260801T160000Z.tar.gz` has SHA-256
  `203f28ebad455ba1340aab51c82198d4a5589e48aeb2b5842ee01e8c9aeba13f`
  in both `/Users/malast/.codex/recovery/malakhov-ai-digest-20260801/` and
  `/srv/malakhov-ai-digest/recovery/`.
- Tests executed and exact results: `npm run context` passed; extractor test passed 5/5;
  `npx tsc --noEmit` passed; `npm test` ran 438 tests with 437 pass and one pre-existing,
  non-P0 failure in `tests/node/feed-card-trim.test.ts` (`Cannot read properties of null
  (reading 'length')`). `npm run docs:check` remains blocked by the pre-existing dirty
  `lib/supabase.ts` / `docs/ARCHITECTURE.md` mismatch recorded in the planning handoff.
  VPS `docker compose config` passed; all 11 containers are healthy; restart persistence,
  private port surface, disk footprint (15G used / 42G available), root-only secrets,
  and x-ui/xray preservation passed.
- Quality gates closed: S0, R1. Iteration 1 foundation DoD closed.
- Quality gates still open: D2, A3, P4, B5, C6.
- Production/DNS impact: none. `news.malakhovai.ru` remains on Vercel.
- Secrets missing (names only): Iteration 2 still needs server-only application and GitHub
  Actions inputs (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) generated/provisioned
  from the VPS secret file without printing values, plus the existing application-only env.
- Risks/blockers: do not expose the currently private Supabase ports, import recovery rows,
  or repoint scheduler/DNS until schema/RLS parity and application staging gates are green.
  The raw source cache and verified copy must be retained through Iteration 2.
- Rollback state: `docker compose down` in
  `/srv/malakhov-ai-digest/supabase-source/docker` stops only the new foundation and leaves
  bind-mounted volumes, recovery archive, Vercel, x-ui and xray intact.
- Exact next action: In Iteration 2, verify archive checksums, apply the project schema plus
  migrations in a disposable/transactional preflight, prove RLS/API roles and query plans,
  then import the 741 JSONL rows idempotently and deploy only an internal Next.js staging runtime.

Docs updated: `docs/DECISIONS.md`, `docs/OPERATIONS.md`,
`docs/task_vps_supabase_recovery_2026-08-01.md`

### 2026-08-01 — Iteration 2

Status: COMPLETE (D2, A3 and P4 closed on private staging)

- Git branch / HEAD: `codex/vps-recovery-iter2`; commit is made after this evidence log, without
  rewriting the accepted Iteration 1 history (`98912ae`).
- Local files changed: private staging Docker/Caddy/compose and DB/API verification scripts under
  `infra/vps/`, standalone `Dockerfile`, `.dockerignore`, server/browser Supabase env separation,
  dynamic staging reads for home/category/Russia/sitemap, two versioned self-host migrations, the
  confirmed ES2017-safe schema-test repair, canonical docs and this handoff.
- VPS changes: schema and recovery import were applied only to the existing private foundation;
  `/srv/malakhov-ai-digest/app-staging` runs the standalone Next.js image behind Caddy on
  `127.0.0.1:8088` only. No Supabase DB/API/Studio port is published. x-ui/xray, UFW, DNS, Vercel,
  GitHub secrets and active production schedules were not changed.
- Pinned versions: foundation remains Supabase `v1.26.07` / PostgreSQL
  `supabase/postgres:17.6.1.136`; staging runtime uses `node:22.16.0-bookworm-slim` and
  `caddy:2.10.2-alpine`.
- Recovery/DB counts and checksums: VPS recheck matched archive
  `203f28ebad455ba1340aab51c82198d4a5589e48aeb2b5842ee01e8c9aeba13f` and JSONL
  `22c498dd256e21c3ffbda2a81236dc33c499a1cd771ecde6f1b574048d28364b`; foundation = 11/11
  healthy containers. Disposable schema preflight passed with no committed `tg-*` cron jobs.
  Import is idempotent: 741 live rows, zero duplicate `id`, `slug` and `original_url`; runtime
  proof = 14 tables, 3 RPCs and RLS on 14 tables. Home and category query plans are index scans
  (`idx_articles_verified_public` and `idx_articles_published` on this 741-row dataset); the
  dedicated `idx_articles_live_category_created` is present.
- Security/API proof: anon live read = 200, anon insert = 401, anon RPC = 401; service cleanup
  before/after = 204, service insert = 201 and service RPC = 200. The temporary fixture is removed.
  Browser static assets contain no `SUPABASE_SERVICE_KEY`/`SERVICE_ROLE_KEY` marker. Health is 401
  without its token and 200 with it; internal dashboard is 404 without the token and 200 with it.
- Application proof: `/`, `/russia`, category, one recovered article, an evergreen guide, RSS,
  sitemaps, robots and both LLM files returned 200; `/api/feed` reports 741. XML validation passed
  3/3 and a deterministic 30/30 recovered-article sample returned HTTP 200 with the production
  canonical URL. Access is only via `ssh -L 8088:127.0.0.1:8088 root@195.245.239.84`.
- Pipeline/scheduler proof: rollback-only lifecycle passed enrich claim/release, repeat-safe
  `publish_article` and `claim_weekly_report_run`; Telegram calls = 0. The documented matrix keeps
  all staging runners disabled and selects one primary per non-Telegram job; Telegram primary remains
  deliberately unselected until an owner-approved C6 dry-run.
- Tests executed and exact results: `npm run context` passed; `npm test` = 420 pass, 0 fail;
  `npx tsc --noEmit` passed; `npm run docs:check` passed; local `npm run build` with non-secret
  loopback build inputs passed (existing lint warnings only); focused migration/schema suite =
  11 pass, 0 fail. VPS `staging-db.sh preflight/import/verify/lifecycle`, API-role script, XML,
  30-URL and port checks passed. The old `schema-guard` failure reproduced on clean Iteration 1
  because the `/s` RegExp flag is unsupported by the ES2017 TypeScript target; it was minimally
  replaced with equivalent `[\\s\\S]` matching, not masked.
- Quality gates closed: S0, R1, D2, A3, P4.
- Quality gates still open: B5, C6.
- Production/DNS impact: none. `news.malakhovai.ru` remains on Vercel; staging is internal-only.
- Secrets missing (names only): owner-controlled C6 still requires the approved public hostname/TLS
  decision and the existing deployment secret inventory. No public or GitHub secret was changed;
  before C6, rotate the staging anon/service JWT pair because an early operator debug trace expanded
  them in the private work session. The committed scripts never print secret values.
- Risks/blockers: B5 still needs an owner-approved backup/restore drill. C6 needs an explicit
  cutover window, DNS/TLS/API-hostname decision, GitHub secret update and manual workflow checks;
  then enable exactly one approved Telegram scheduler only after its dry-run.
- Rollback state: `docker compose -p malakhov-digest-staging -f
  /srv/malakhov-ai-digest/app-staging/infra/vps/staging-compose.yml down` removes only the staging
  app/Caddy containers. Foundation data, recovery archive, x-ui/xray, Vercel and DNS remain intact.
- Exact next action: Iteration 3 performs B5 restore-drill evidence first. After owner approval for
  C6, provision the public Caddy hostname/TLS without publishing DB/Studio, set GitHub deployment
  inputs by name only, manually validate workflows and external monitoring, then choose one Telegram
  primary and leave its backup disabled before any real send.

Docs updated: `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`,
`docs/DECISIONS.md`, `docs/PROJECT.md`, `docs/task_vps_supabase_recovery_2026-08-01.md`

### 2026-08-01 — Iteration 3

Status: COMPLETE (B5/C6 closed; observation end `2026-08-01T16:58:58Z`)

- Git branch / HEAD: cumulative branch `codex/vps-recovery-iter3` started at accepted Iteration 2
  commit `5859e4b4c7c6a9af7206a2adc1810820d172f223`; final commit is made after this evidence log.
  History was not rewritten and no PR was opened.
- Local files changed: production Caddy/compose/deploy, atomic JWT rotation, encrypted
  backup/restore drill, monitor/systemd, GitHub secret updater and external smoke scripts under
  `infra/vps/`; scheduler-safe Telegram workflows; migration
  `20260801140646_remove_legacy_batch_apply_overload.sql`; canonical docs and this handoff.
- VPS changes: final root-owned release
  `/srv/malakhov-ai-digest/releases/iter3-20260801T162632Z-final` is the `app-current` target.
  Caddy is public only on 80/443; app and 11 foundation services share the private
  `supabase_default` network. Build uses a loopback-only temporary Caddy bridge to Kong and removes
  it before success. Production/staging schedulers remain disabled inside containers.
- Pinned versions: Supabase `v1.26.07` commit
  `949a57d2854b7fcadc0d621cb7fffa167506d581`; PostgreSQL
  `supabase/postgres:17.6.1.136`; Node `22.16.0-bookworm-slim`; Caddy `2.10.2-alpine`.
- Recovery/DB counts and checksums: 741 live rows; duplicate `id` / `slug` / `original_url` =
  0/0/0. Public boundary = 14 runtime tables with RLS 14/14, one RLS reference table, zero
  unexpected/sentinel/backup tables and exactly three service-role RPC contracts. Recovery archive
  remains `203f28ebad455ba1340aab51c82198d4a5589e48aeb2b5842ee01e8c9aeba13f`; recovered JSONL
  remains `22c498dd256e21c3ffbda2a81236dc33c499a1cd771ecde6f1b574048d28364b`.
- JWT security: `JWT_SECRET`, anon and service JWTs were rotated together. Root-only evidence is
  `/srv/malakhov-ai-digest/evidence/jwt-rotation-20260801T135934Z.log`; both previous tokens return
  401, current anon/service API matrix passes, and no value was printed or committed.
- Backup/restore: encrypted artifact
  `/srv/malakhov-ai-digest/backups/encrypted/daily/malakhov-ai-digest-20260801T145753Z.tar.age` and
  Mac offsite copy
  `/Users/malast/.codex/backups/malakhov-ai-digest/malakhov-ai-digest-20260801T145753Z.tar.age`
  share SHA-256 `f4e2e53bf6365a77c66ca27e1c40788be6d0ab6b1b4fbdd7e045477c34ef49a0`.
  Restore evidence `/srv/malakhov-ai-digest/evidence/restore-drill-20260801T145917Z.manifest`
  proves counts/checksum/schema/RLS/RPC/index parity, RTO 3 seconds and RPO age 81 seconds; the
  disposable DB/container target was removed. Retention is daily 7 / weekly 4 / monthly 6 and the
  locked daily timer is enabled.
- DNS/TLS: parent-zone `news.malakhovai.ru. 3600 A` changed in ISPmanager from Vercel
  `76.76.21.21` to VPS `195.245.239.84` at `2026-08-01T15:52:41Z`; both authoritative pools
  converged by `16:03Z`. Trusted VPS certificate is `CN=news.malakhovai.ru`, Let's Encrypt `YE2`,
  valid from `2026-08-01T15:04:49Z` through `2026-10-30T15:04:48Z`, SHA-256 fingerprint
  `78:73:D2:D0:70:52:8D:21:CC:E3:2E:27:04:A6:87:0B:53:22:6C:F2:69:A1:43:CB:1B:E9:E7:DD:03:F7:F7:1E`.
- Application/external proof: final Docker build generated 62/62 pages. Main, category, guide,
  RSS, sitemap, news sitemap and robots returned 200; feed total = 741; 30/30 sampled article
  canonical URLs matched. Sustained post-cutover samples were 100 requests / 0 failures and a final
  200 requests / one timeout (0.50%, below the >1% rollback threshold); every completed response
  resolved to `195.245.239.84`. Service-role key and JWT secret were absent from static bundles and
  app logs.
- GitHub/schedulers: endpoint and rotated key secrets were updated with `gh secret set` through
  stdin at `16:05Z`; values were not logged. Manual Site Monitor run `30707436965` passed at
  `16:07Z` on the no-send healthy path. `pg_cron` has zero jobs/extensions in production,
  `vercel.json` has no Telegram cron and application schedulers are off. Telegram channel and weekly
  report each have exactly one GitHub primary; manual validation uses `send=false` and no Telegram
  test delivery occurred.
- Monitoring/observation: `malakhov-monitor.timer` runs every five minutes and
  `malakhov-backup.timer` daily. `.cutover-complete` enables public feed/TLS checks. Checkpoints from
  `15:52:41Z` through `2026-08-01T16:58:58Z` kept app/Caddy and 11/11 foundation containers healthy,
  restart count 0, 741 rows, zero blocked locks, disk 38%, and x-ui plus ports 2096/21417 healthy.
  The monitor correctly reported `external_feed` critical at `16:15Z` and `16:18Z` while recursive
  resolver shards still cached Vercel (`total=0`) under the old 3600-second TTL; 28/28 authoritative
  nodes already returned the VPS and a forced VPS check returned 741. DNS rollback was rejected
  because it would have made the known-empty Vercel path universal. Observation continued through
  complete recursive expiry: `16:55:42Z` was 30/30 VPS, `16:56Z` was 100/100 VPS, then three
  consecutive unforced monitor runs and the corrected 30-article smoke passed. Caddy's final sample
  contained 1,195 requests, zero 5xx; the only app error line was an expected stale Server Action
  request after immutable deploy.
- Tests executed and exact results: `npm run context` passed; `npm test` = 420 pass / 0 fail;
  `npx tsc --noEmit`, `npm run docs:check`, `git diff --check`, `bash -n`, ShellCheck (SC1091
  external-source exclusion), actionlint and production `docker compose config` passed. Local and
  VPS Docker production builds both generated 62/62 pages. Disposable schema preflight, live
  schema/index verification and API role matrix passed; external smoke and encrypted restore drill
  passed.
- Quality gates closed: S0, R1, D2, A3, P4, B5, C6. Production criteria are complete.
- Production/DNS impact: `https://news.malakhovai.ru` is served by the VPS. Vercel deployment
  `dpl_Fcj75UJFatrq8cQe5aBBDj3XX6kz` remains `READY` and must be retained until at least
  `2026-08-03T15:52:41Z` as DNS rollback.
- Secrets missing (names only): none for the completed cutover. Age identity remains Mac-only and
  all runtime identities remain outside Git/evidence output.
- Risks/follow-up: DNS caches may retain the old TTL during the first hour, so both Vercel and VPS
  must remain healthy. Controller must merge the audited cumulative branch before the modified
  safe-dispatch workflow definitions become default-branch truth. Owner check at 24h: external
  HTTP/TLS, 741+ feed, scheduler runs, backup timer/age and no Telegram duplicates. Owner check at
  7d: decrypt latest offsite backup, run another disposable restore drill, inspect disk/log
  retention and review dependency warnings without an unreviewed foundation upgrade.
- Rollback state: replace only the `news` A record with `76.76.21.21`, take a fresh encrypted backup
  first if writes occurred, keep the self-hosted database private/running and never overwrite it with
  an older dump. Restore GitHub endpoint secrets only if workflows must use the old data plane.
- Exact next action: controller performs independent branch audit and merge. No production action is
  required unless a monitoring gate turns red; then execute the rollback runbook immediately.

Docs updated: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`,
`docs/OPERATIONS.md`, `docs/DECISIONS.md`, `docs/PROJECT.md`,
`docs/task_vps_supabase_recovery_2026-08-01.md`
