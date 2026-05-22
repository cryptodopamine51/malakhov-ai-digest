# SEO Brief: ИИ для малого бизнеса: с чего начать

## Topic

- Topic ID: `3`
- Cluster: ИИ для бизнеса
- Status: planned → drafted
- Publication mode: create
- Target URL: `/guides/ii-dlya-malogo-biznesa-s-chego-nachat`
- Primary keyword: ИИ для малого бизнеса
- Supporting keywords: нейросети для малого бизнеса, как использовать ИИ в малом бизнесе, ИИ инструменты для малого бизнеса, автоматизация малого бизнеса с ИИ
- Intent: practical
- Audience: предприниматель, владелец малого бизнеса, руководитель отдела, маркетолог
- CTA: honest CTA-set (см. §9 spec_2026-05-21) — заявка на разбор + Telegram-дайджест + личный Telegram

## Anti-Cannibalization Decision

- Decision: **create** (новый материал, не дублирует существующие)
- Existing guide/article conflicts:
  - `/guides/kak-vnedrit-ii-v-biznes-2026` — обобщающий гайд для любого бизнеса. Здесь — конкретно сегмент малого: меньше денег, нет ИТ-отдела, нет аналитика, нет бюджета на индивидуальную разработку.
  - `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu` — отдельный угол про бюджет. Здесь даём калькулятор пилота на 50–80 тыс ₽ как один блок, не дублируя весь cost-гайд.
- Future topic conflicts from `content/evergreen/topics.json`:
  - id=4 «Какие бизнес-процессы автоматизировать с помощью ИИ» — широкий хаб про матрицу процессов. Здесь — четыре конкретных сценария (продажи, поддержка, маркетинг, документы) для малого бизнеса. Не дублируем матрицу.
  - id=5 «Лучшие нейросети для малого бизнеса» — отдельный обзор инструментов. Здесь даём короткий список «что взять на первом шаге», не разворачивая обзор тарифов.
- Internal links used in body:
  - `/guides/kak-vnedrit-ii-v-biznes-2026`
  - `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`
  - `/categories/ai-industry`
  - `/russia`

## Search Intent

What the reader wants to solve:

- Понять, реально ли малому бизнесу (1–50 человек) что-то получить от ИИ за месяц, не вкладывая 1+ млн ₽ в разработку.
- Получить короткий список сценариев, которые реально работают на малом масштабе.
- Узнать, сколько стоит первый пилот: разовый запуск и месяц поддержки.
- Понять, какие задачи отдавать ИИ нельзя (риск 152-ФЗ, регуляторика, ниши, где ждут человека).

What the article must answer in the first screen:

- Где сегодня малый бизнес реально применяет ИИ (4 сценария: продажи, поддержка, маркетинг, документы).
- Какой бюджет нужен для первого пилота (диапазон 50–250 тыс ₽ запуск + 8–25 тыс ₽/мес).
- За какой срок реально получить первый бизнес-результат (30–45 дней).

What the article must not duplicate:

- Полный калькулятор стоимости (он в cost-гайде).
- Полная матрица процессов (она будет в id=4).
- Обзор всех инструментов (он будет в id=5).
- Базовая теория «как внедрять» (она в id=1).

## SEO Package Draft

- SEO title: ИИ для малого бизнеса: с чего начать в 2026 году
- Meta description: Практический гайд для малого бизнеса: четыре сценария ИИ за месяц, бюджет первого пилота 50–250 тыс ₽, кейс окупаемости и риски по 152-ФЗ. Актуальность проверена 22 мая 2026.
- H1: ИИ для малого бизнеса: с чего начать
- Slug: `ii-dlya-malogo-biznesa-s-chego-nachat`
- Canonical: `https://news.malakhovai.ru/guides/ii-dlya-malogo-biznesa-s-chego-nachat`

## Unique Malakhov AI Angle

- Practical business mechanism: первый пилот за 30 дней без разработки — на GigaChat/YandexGPT + конструкторах. Конкретные диапазоны бюджета по сегменту.
- Cost/risk/process angle: counter-strategy блок «Когда малому бизнесу ИИ не окупится» — шесть критериев отказа от пилота. На рынке этого почти нет, везде «давайте быстрее внедрим».
- Local Russia/CIS context where useful: GigaChat и YandexGPT как локальные тарифы без VPN, 152-ФЗ для клиентских данных, маркетинг через ВКонтакте/OK/Авито/Telegram.
- What competitors usually miss:
  - реалистичные диапазоны бюджета именно для малого бизнеса, а не для крупных проектов;
  - честный счёт времени владельца (часто это решающая статья бюджета на МСБ);
  - критерии остановки пилота (когда лучше закрыть, а не доделывать).

## Planned Structure

- Required tables: сравнение четырёх сценариев, таблица бюджета пилота, таблица инструментов по задачам.
- Required checklists: 7 шагов первого пилота за 30 дней, критерии «когда не окупится».
- Required examples: развёрнутый кейс «онлайн-школа английского», numerical worked example «пекарня + Telegram-бот».
- Required FAQ: 8 вопросов (стоимость, GigaChat/ChatGPT, 152-ФЗ, время владельца, маркетинг, поддержка, окупаемость, выбор первого процесса).
- Required images: cover + 3 inline (сценарии, бюджет пилота, риски).

## Fact Boundaries

Claims that need source verification:

- 257 млрд ₽ — оценка Дмитрия Григоренко на Data Fusion 2026 (источник CNews, апрель 2026, уже использован в cost-гайде).
- Gartner 30% PoC abandoned by end of 2025 (источник Gartner, July 2024 — уже использован в cost-гайде).
- Тарифы GigaChat и YandexGPT — ссылки на актуальные публичные тарифные страницы.
- Тарифы Make, n8n — ссылки на публичные страницы.
- Конкретные числа кейса/калькулятора — редакционный пример, явная пометка «Редакционный пример».

## Editorial Quality Bar checklist

- [x] Lead anchor: 257 млрд ₽ / Григоренко / Data Fusion 2026 в первом предложении.
- [x] `verifiedAt: 2026-05-22` в meta.
- [x] Numerical worked example: «пекарня + Telegram-бот» в калькуляторном блоке.
- [x] Развёрнутый кейс «онлайн-школа английского (Редакционный пример)».
- [x] Counter-strategy H2 «Когда внедрение ИИ малому бизнесу не окупится».
- [x] 152-ФЗ + GigaChat/YandexGPT в российском контексте.
- [x] ≥ 2 inline-ссылок в теле: `/guides/kak-vnedrit-ii-v-biznes-2026`, `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`, `/categories/ai-industry`, `/russia`.
- [x] CTA cap: 2 inline + 1 final блок с 3 карточками (Telegram-дайджест, заявка, личный TG).
- [x] caseSourcing: editorial.
