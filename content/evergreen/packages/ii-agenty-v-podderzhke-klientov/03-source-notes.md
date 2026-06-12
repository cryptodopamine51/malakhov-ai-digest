# Source Notes: ИИ-агенты в поддержке клиентов

Checked date: 2026-06-12

## Внешние источники (использованы в статье)

1. **Gartner, пресс-релиз 2025-03-05.** «Agentic AI will autonomously resolve 80% of common customer service issues without human intervention by 2029», прогноз снижения операционных затрат ~30%. Используется как factual anchor лида, с явной маркировкой «прогноз».
   URL: https://www.gartner.com/en/newsroom/press-releases/2025-03-05-gartner-predicts-agentic-ai-will-autonomously-resolve-80-percent-of-common-customer-service-issues-without-human-intervention-by-2029
2. **McKinsey, 2023.** «The economic potential of generative AI»: потенциал genAI в customer operations — 30–45% текущих затрат функции; customer operations — одна из четырёх функций с ~75% всей ценности.
   URL: https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights/the-economic-potential-of-generative-ai-the-next-productivity-frontier
3. **TAdviser / CNews Analytics** (white-list Tier 1) — фон для редакционного кейса: публичные внедрения ИИ в российском e-commerce и клиентском сервисе. Конкретные компании не цитируются.
4. **GigaChat / Yandex AI Studio тарифы** — ссылки в «Источники», конкретные цены в тексте не называются (волатильны).
5. **152-ФЗ / Роскомнадзор** — требование российского контура для персональных данных.

## Редакционные оценки (наши, маркированы в тексте)

- Доля автономно закрываемых обращений в зрелых внедрениях: 30–50% (консервативный диапазон по публичным кейсам вендоров и интеграторов; в лиде не утверждается как факт исследования).
- Стоимость запуска агента первой линии: 300–600 тыс ₽; сопровождение 30–50 тыс ₽/мес — редакционные диапазоны, консистентны с гайдом о стоимости внедрения.
- Ставка оператора 600 ₽/час с налогами, 8 мин на обращение — типовые значения для расчётного примера.
- Порог окупаемости ~2 000 обращений/мес — следует из расчёта в worked example.

## Кейс

`caseSourcing: editorial` — редакционный пример, собран из мотивов публичных обзоров TAdviser/CNews, маркирован в заголовке и в блоке источника. Цифры внутренне согласованы: 18 000 обращений/мес, 38% автономных решений, запуск 450 тыс ₽, сопровождение 35 тыс ₽/мес.
