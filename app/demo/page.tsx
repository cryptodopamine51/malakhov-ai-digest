import type { Metadata } from 'next'
import Link from 'next/link'
import ReadingProgress from '../../src/components/ReadingProgress'
import TelegramCTA from '../../src/components/TelegramCTA'
import {
  EditorialStatGrid,
  EditorialTimeline,
  EditorialEntityGrid,
  EditorialThesis,
  EditorialPullQuote,
  EditorialSignal,
  EditorialComparison,
} from '../../src/components/EditorialBlocks'

export const metadata: Metadata = {
  title: 'Агентная экономика: кто пишет правила',
  description: 'Демо-статья с редакционными блоками',
  robots: { index: false },
}

export default function DemoPage() {
  return (
    <>
      <ReadingProgress />
      <article className="mx-auto max-w-3xl px-4 py-8 md:py-10">

        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
          <span>→</span>
          <span>Демо-статья</span>
        </nav>

        {/* Topic badge — без картинки, она будет добавлена позже */}
        <div className="mb-5">
          <span className="inline-flex rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            AI-индустрия
          </span>
        </div>

        {/* Headline */}
        <h1 className="mb-4 font-serif text-[28px] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink md:text-[38px]">
          Агентная экономика: кто пишет правила в эпоху AI-агентов
        </h1>

        {/* Meta */}
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>Malakhov AI Дайджест</span>
          <span>·</span>
          <span>19 апреля 2026</span>
          <span>·</span>
          <span>6 мин</span>
          <span>·</span>
          <span className="text-accent">Demo</span>
        </div>

        {/* Lead */}
        <p className="mb-6 text-[19px] font-semibold leading-relaxed text-ink">
          Когда автономный агент закрывает сделку, пишет код и меняет подрядчика — кто несёт ответственность?
          Рынок ставит на AI-агентов $300 млрд к 2028 году, но правила игры ещё не написаны.
        </p>

        {/* Summary box */}
        <section className="mb-8 rounded border border-line bg-surface p-5">
          <h3 className="mb-3 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Кратко
          </h3>
          <ul className="space-y-2">
            {[
              'Агентный AI переходит от демо-режима к реальным корпоративным workflow',
              'Microsoft, Salesforce и ServiceNow строят инфраструктуру агентских платформ',
              'В корпоративной архитектуре появляется новая роль — Agent Orchestrator',
              'Главный риск пока не технический, а юридический: кто отвечает за решения агента',
            ].map((bullet, i) => (
              <li key={i} className="flex gap-2 text-[15px] text-ink">
                <span className="mt-0.5 shrink-0 text-accent">—</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* === STAT GRID === */}
        <EditorialStatGrid
          kicker="Сигналы рынка"
          title="Агентный AI в цифрах"
          items={[
            {
              label: 'Объём рынка к 2028',
              value: '$300B',
              trend: 'up',
              note: 'Прогноз McKinsey по корпоративному сегменту агентных AI-систем. Для сравнения: весь рынок CRM сегодня — $96 млрд.',
            },
            {
              label: 'Forbes 500 тестируют',
              value: '67%',
              trend: 'up',
              note: 'Доля крупнейших корпораций, запустивших хотя бы один пилот с AI-агентами в 2026 году. В 2024-м было 18%.',
            },
            {
              label: 'Рост вызовов Agent API',
              value: '8×',
              trend: 'up',
              note: 'Кратный рост числа обращений к agent-ориентированным API за последние 12 месяцев по данным Anthropic и OpenAI.',
            },
          ]}
        />

        {/* Body paragraph 1 */}
        <div className="article-body mb-8">
          <p className="mb-5">
            В 2022 году мир обсуждал, может ли AI писать стихи. В 2026-м AI-агент
            может провести тендер среди поставщиков, выбрать победителя и оформить
            договор — без единого письма от человека. Это не фантастика: Walmart,
            JP Morgan и Deutsche Telekom уже развернули автономные агентные системы
            в production-среде.
          </p>
          <p className="mb-5">
            Переход от «AI как инструмента» к «AI как исполнителя» меняет не только
            технологическую архитектуру компаний, но и их организационную структуру,
            операционные риски и, в конечном счёте, бизнес-модели.
          </p>
        </div>

        {/* === TIMELINE === */}
        <EditorialTimeline
          title="Как мы дошли до агентов"
          items={[
            {
              year: '2022',
              title: 'ChatGPT делает LLM массовыми',
              description: 'Первый триггер спроса. Компании начинают понимать, что текстовые интерфейсы к AI могут быть продуктом, а не академическим экспериментом.',
            },
            {
              year: '2023',
              title: 'LangChain и AutoGPT — первые цепочки',
              description: 'Появляются первые автономные pipeline. Они хрупкие, часто ломаются, но демонстрируют концепцию: AI может принимать решения в многошаговых задачах.',
            },
            {
              year: '2024',
              title: 'Tool use становится стандартом',
              description: 'Claude с tool use, GPT-4 Actions, Gemini function calling — агенты получают реальные инструменты. Стабильность наконец позволяет строить production-системы.',
            },
            {
              year: '2025',
              title: 'Платформы входят в мейнстрим',
              description: 'Microsoft Copilot Studio, Salesforce Agentforce, ServiceNow AI Agents — корпоративные платформы делают агентов доступными без кастомной разработки.',
            },
            {
              year: '2026',
              title: 'Агенты заменяют функции, а не задачи',
              description: 'Специализированные агенты начинают брать на себя целые операционные функции. Рынок переходит от «пилотов» к «deployment at scale».',
            },
          ]}
        />

        {/* === PULL QUOTE === */}
        <EditorialPullQuote
          text="Вопрос не в том, будут ли агенты. Вопрос в том, кто из вендоров захватит middleware-слой между моделью и вашим бизнесом."
          author="Malakhov AI Дайджест · Редакционная позиция"
        />

        {/* Body paragraph 2 */}
        <div className="article-body mb-8">
          <p className="mb-5">
            Middleware-слой — это оркестрация: какие инструменты вызвать, в каком порядке,
            как обрабатывать ошибки, куда логировать решения агента. Кто контролирует
            этот слой, тот определяет, какие модели, данные и интеграции доступны
            конечному агенту.
          </p>
        </div>

        {/* === COMPARISON === */}
        <EditorialComparison
          title="Корпоративная архитектура: до и после"
          before={{
            label: 'Классическая модель',
            items: [
              'Сотрудник получает задачу через тикет',
              'Использует инструменты вручную',
              'Согласует решение с менеджером',
              'Исполняет и отчитывается',
              'Цикл: дни и недели',
            ],
          }}
          after={{
            label: 'Агентная модель',
            items: [
              'Агент принимает задачу через API',
              'Оркестрирует инструменты автономно',
              'Логирует решения для аудита',
              'Эскалирует только исключения к человеку',
              'Цикл: минуты, часы',
            ],
          }}
        />

        {/* === SIGNALS === */}
        <EditorialSignal variant="opportunity">
          Компании, внедрившие агентов в 2026 году, получат 2–3-летнее операционное
          преимущество. Эффект накопится в процессах, данных для обучения и скорости
          итераций — конкуренты с нуля его не повторят быстро.
        </EditorialSignal>

        <EditorialSignal variant="risk">
          Регуляторный вакуум вокруг «решений агента» — главный юридический риск.
          До первых громких прецедентов остаются месяцы: кто несёт ответственность,
          если агент принял ошибочное бизнес-решение с финансовыми последствиями?
        </EditorialSignal>

        <EditorialSignal variant="neutral">
          EU AI Act 2026 не даёт прямого ответа на вопрос об автономных агентах:
          большинство корпоративных deployment попадут в «high risk» категорию,
          но конкретные обязательства ещё в разработке.
        </EditorialSignal>

        {/* === ENTITY GRID === */}
        <EditorialEntityGrid
          title="Ключевые игроки платформенного слоя"
          intro="Кто строит инфраструктуру, на которой будут работать корпоративные агенты следующего поколения."
          items={[
            {
              name: 'Microsoft Copilot Studio',
              role: 'Platform',
              note: 'Крупнейший корпоративный охват через M365. Агенты нативно интегрируются в Teams, SharePoint и весь Office-стек — это главное конкурентное преимущество.',
            },
            {
              name: 'Salesforce Agentforce',
              role: 'CRM Layer',
              note: 'Ставка на CRM как точку входа в корпоративные данные. Агенты знают клиента лучше, чем продавец, потому что видят всю историю взаимодействий.',
            },
            {
              name: 'ServiceNow AI Agents',
              role: 'ITSM',
              note: 'Экспозиция на IT Service Management и корпоративные процессы. Сильный кейс: автономное разрешение инцидентов до эскалации к человеку.',
            },
            {
              name: 'Anthropic Claude',
              role: 'Foundation',
              note: 'Модель с наилучшим следованием сложным инструкциям и работой с инструментами — ключевые характеристики для enterprise agent deployment.',
            },
          ]}
        />

        {/* === THESIS === */}
        <EditorialThesis title="Контроль оркестрации — новая операционная система">
          В агентной экономике ценность создаётся не в точке генерации контента,
          а в точке оркестрации. Тот, кто контролирует middleware-слой, определяет,
          какие модели, инструменты и данные используются. Это новая операционная
          система для бизнеса — и битва за неё уже идёт между Microsoft, Salesforce
          и пока менее заметными специализированными платформами.
        </EditorialThesis>

        {/* Body paragraph 3 */}
        <div className="article-body mb-8">
          <p className="mb-5">
            Для российского рынка ситуация двойственная: с одной стороны, санкционные
            ограничения закрывают доступ к ряду западных платформ. С другой — это
            создаёт окно для отечественных решений: GigaChat Agents, Яндекс AI Suite
            и ряд стартапов активно заходят в корпоративный сегмент.
          </p>
          <p className="mb-5">
            Компании, которые в 2026 году ещё только обсуждают пилоты, рискуют
            оказаться в позиции «компаний без интернета» образца 2005 года.
            Агентная трансформация — это не следующий цикл, это происходит прямо сейчас.
          </p>
        </div>

        <TelegramCTA />

        {/* Footer */}
        <footer className="mt-8 border-t border-line pt-5 text-[13px] text-muted">
          <p>
            Демо-статья Malakhov AI Дайджест · Редакционный контент ·{' '}
            <Link href="/" className="text-accent hover:underline">На главную</Link>
          </p>
        </footer>
      </article>
    </>
  )
}
