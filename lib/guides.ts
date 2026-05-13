import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_URL } from './site'

export interface GuideImage {
  src: string
  width: number
  height: number
  alt: string
  caption: string
}

export interface GuideRelatedLink {
  title: string
  description: string
  href: string
}

export interface GuideFaqItem {
  question: string
  answer: string
}

export interface Guide {
  slug: string
  path: string
  title: string
  seoTitle: string
  description: string
  ogDescription: string
  category: string
  tags: string[]
  publishedAt: string
  updatedAt: string
  readingMinutes: number
  heroLead: string
  cover: GuideImage
  inlineImagesByHeading: Record<string, GuideImage>
  relatedLinks: GuideRelatedLink[]
  relatedArticleCategories: string[]
  faq: GuideFaqItem[]
  markdown: string
}

const GUIDE_SLUG = 'kak-vnedrit-ii-v-biznes-2026'
const GUIDE_PATH = `/guides/${GUIDE_SLUG}`
const IMAGE_BASE = `/images/guides/${GUIDE_SLUG}`

const markdownCache = new Map<string, string>()

function readGuideMarkdown(slug: string): string {
  const cached = markdownCache.get(slug)
  if (cached) return cached

  const markdown = readFileSync(
    join(process.cwd(), 'content', 'guides', `${slug}.md`),
    'utf8',
  )
  markdownCache.set(slug, markdown)
  return markdown
}

const faq: GuideFaqItem[] = [
  {
    question: 'С чего начать внедрение ИИ в бизнес?',
    answer:
      'Начните с карты процессов: найдите повторяющиеся заявки, документы, сообщения, отчеты, звонки или таблицы, затем выберите один процесс с понятной метрикой.',
  },
  {
    question: 'Какой AI-проект лучше выбрать первым?',
    answer:
      'Лучший первый проект частый, измеримый и контролируемый: AI-бот поддержки, квалификация лидов, подготовка коммерческих предложений, анализ звонков или обработка документов.',
  },
  {
    question: 'Можно ли внедрить ИИ без разработчиков?',
    answer:
      'Да, если задача простая: генерация контента, работа с базой знаний, связки через no-code или AI-функции внутри CRM. Разработка нужна для внутренних данных, действий в системах, логов и сложных правил доступа.',
  },
  {
    question: 'Какие данные нужны для внедрения ИИ?',
    answer:
      'Минимально нужны примеры входа и выхода процесса: обращения и ответы, лиды и статусы, документы и поля, рекламные кампании и результаты, база знаний и правила.',
  },
  {
    question: 'Сколько стоит внедрение ИИ?',
    answer:
      'Стоимость зависит от типа решения: быстрый пилот может стоить десятки тысяч рублей с учетом времени команды, а кастомная система с интеграциями, безопасностью и аналитикой обычно требует бюджета от сотен тысяч рублей.',
  },
  {
    question: 'Как быстро ИИ окупается?',
    answer:
      'Для малого и среднего бизнеса хороший первый проект желательно проверять на горизонте 2-6 месяцев. Стратегические проекты могут окупаться дольше, если создают инфраструктуру для следующих внедрений.',
  },
  {
    question: 'Какие процессы лучше не брать первыми?',
    answer:
      'Для первого проекта лучше отложить процессы с высоким риском ошибки: финальные юридические решения, медицинские рекомендации, кредитные решения, увольнения и критические финансовые операции.',
  },
  {
    question: 'Что важнее: выбрать модель или подготовить процесс?',
    answer:
      'Для бизнеса важнее процесс. Модель можно заменить быстрее, чем исправить плохо выбранный процесс, хаотичные данные, отсутствие владельца и размытые метрики.',
  },
]

const guideMeta = {
  slug: GUIDE_SLUG,
  path: GUIDE_PATH,
  title: 'Как внедрить ИИ в бизнес в 2026 году: пошаговый план для руководителя',
  seoTitle: 'Как внедрить ИИ в бизнес в 2026 году: пошаговый план',
  description:
    'Пошаговый план внедрения ИИ в бизнес: выбор первого AI-проекта, данные, инструменты, экономика, риски, ошибки, план 30/60/90 дней и критерии окупаемости.',
  ogDescription:
    'Практический гайд для руководителя: процесс, метрика, данные, инструмент, контроль и экономика AI-проекта.',
  category: 'ИИ для бизнеса',
  tags: ['ИИ для бизнеса', 'внедрение ИИ', 'AI implementation', 'AI-агенты', 'автоматизация бизнеса'],
  publishedAt: '2026-05-13T00:00:00+03:00',
  updatedAt: '2026-05-13T00:00:00+03:00',
  readingMinutes: 18,
  heroLead:
    'Практический evergreen-гайд для руководителя: как выбрать первый AI-проект, подготовить данные, посчитать экономику и довести пилот до рабочего процесса.',
  cover: {
    src: `${IMAGE_BASE}/cover.webp`,
    width: 1200,
    height: 675,
    alt: 'Руководитель изучает карту бизнес-процессов и AI-слой на экране',
    caption: 'Внедрение ИИ начинается с процесса, метрики и зоны ответственности, а не с выбора модели.',
  },
  inlineImagesByHeading: {
    'что-значит-внедрить-ии-в-бизнес': {
      src: `${IMAGE_BASE}/ai-process-layer.webp`,
      width: 1200,
      height: 800,
      alt: 'Схема: ИИ как слой над процессами бизнеса',
      caption: 'ИИ работает как управляемый слой над процессами: продажи, маркетинг, поддержка, документы, интеграции и метрики.',
    },
    'как-выбрать-первый-ai-проект': {
      src: `${IMAGE_BASE}/ai-project-matrix.webp`,
      width: 1200,
      height: 800,
      alt: 'Матрица выбора первого AI-проекта для бизнеса',
      caption: 'Первый проект лучше выбирать в зоне высокого эффекта и контролируемой сложности.',
    },
    'как-оценить-экономику-внедрения': {
      src: `${IMAGE_BASE}/ai-economics.webp`,
      width: 1200,
      height: 800,
      alt: 'Схема экономики внедрения ИИ и расчета ROI',
      caption: 'Экономика AI-проекта складывается из расходов, эффекта, поддержки и срока окупаемости.',
    },
    'план-внедрения-ии-на-306090-дней': {
      src: `${IMAGE_BASE}/ai-implementation-roadmap.webp`,
      width: 1200,
      height: 800,
      alt: 'План внедрения ИИ на 30, 60 и 90 дней',
      caption: 'Дорожная карта помогает не застрять на демо и перейти к рабочему процессу.',
    },
  },
  relatedLinks: [
    {
      title: 'ИИ в России',
      description: 'Новости российского рынка ИИ, государственные инициативы, модели и кейсы компаний.',
      href: '/russia',
    },
    {
      title: 'Индустрия ИИ',
      description: 'Бизнес-новости: продукты, партнерства, рыночные тренды и релизы компаний.',
      href: '/categories/ai-industry',
    },
    {
      title: 'ИИ и разработка',
      description: 'Практические материалы про AI-инструменты, библиотеки и разработку.',
      href: '/categories/coding',
    },
  ],
  relatedArticleCategories: ['ai-industry', 'ai-startups', 'ai-russia', 'coding'],
  faq,
}

export function getAllGuides(): Guide[] {
  return [
    {
      ...guideMeta,
      markdown: readGuideMarkdown(guideMeta.slug),
    },
  ]
}

export function getGuideBySlug(slug: string): Guide | null {
  const guide = getAllGuides().find((item) => item.slug === slug)
  return guide ?? null
}

export function getGuideAbsoluteUrl(guide: Pick<Guide, 'path'>): string {
  return `${SITE_URL}${guide.path}`
}
