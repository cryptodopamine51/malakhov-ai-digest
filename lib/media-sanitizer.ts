export interface ArticleImageCandidate {
  src: string
  alt?: string | null
  title?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
  parentClassName?: string | null
  parentId?: string | null
  parentHref?: string | null
  nearestFigureClassName?: string | null
  nearestFigureId?: string | null
  source?: 'og' | 'inline' | 'generated' | 'unknown'
}

export interface MediaSanitizerContext {
  sourceName: string
  originalUrl: string
  originalTitle: string
  ruTitle?: string | null
  lead?: string | null
  summary?: string[] | null
  originalText?: string | null
}

export interface MediaReject {
  src: string
  reason: string
  alt?: string | null
}

export interface SanitizedMedia {
  coverImageUrl: string | null
  articleImages: { src: string; alt: string }[]
  rejects: MediaReject[]
}

export interface SanitizeArticleMediaInput {
  coverImageUrl?: string | null
  articleImages?: ArticleImageCandidate[] | { src: string; alt?: string | null }[] | null
  context: MediaSanitizerContext
}

const HARD_URL_RE =
  /(?:adfox|doubleclick|googlesyndication|yabs|yandex\/direct|career\.habr\.com|habr\.com\/ru\/companies\/habr_career|\/ads?\/|\/advert|\/banner|\/promo)/i

const UI_ICON_URL_RE =
  /(?:\/icons?\/|\/sprites?\/|\/share[-_]?icon|\/social[-_]?icon|\/arrow[-_.]|\/btn[-_]|\/button[-_]|share[-_.]svg|social[-_.]svg|arrow[-_.]svg|(?:^|[\/_.-])btn(?:[\/_.-]|$)|(?:^|[\/_.-])button(?:[\/_.-]|$))/i

const PROMO_TEXT_RE =
  /(?:\bads?\b|\badvert(?:isement|ising)?\b|\bbanner\b|\bpromo(?:ted|tion)?\b|\bsponsor(?:ed)?\b|\bpartner\b|\bcareer\b|\bjobs?\b|\bvacanc(?:y|ies)\b|\bcourses?\b|реклама|промо|партн[её]рск|карьер|ваканси|(?:^|[^а-яё])работа(?:$|[^а-яё])|(?:^|[^а-яё])курс(?:ы|а|ов)?(?:$|[^а-яё]))/i

const AUTHOR_TEXT_RE =
  /(?:\bauthor\b|\bbyline\b|\bbio\b|\bavatar\b|\bcontributor\b|\bheadshot\b|\bportrait\b|\bprofile\s*(?:pic|picture|photo|image)\b|^photo of\b|^portrait of\b|author photo|фото автора|^автор\b|автор:)/i

const GENERIC_CAPTION_RE =
  /^(?:image|photo|picture|illustration|source|источник|изображение|фото|иллюстрация|скриншот|screenshot|img|pic)(?:\s*[:#.-]?\s*\d*)?$/i

const IMAGE_FILE_RE = /^[\w./:%-]+\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i

const TEXT_COVER_SOURCE_NAMES = new Set(['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews'])

const CONTEXTUAL_IMAGE_SOURCE_RE =
  /(?:404 media|ars technica|aws machine learning blog|cnet|mit technology review|the verge|techcrunch|venturebeat|wired|zdnet|openai|anthropic|google deepmind|deepmind|nvidia|microsoft|google|meta|habr|the decoder)/i

const AUTHOR_URL_RE =
  /(?:\/authors?\/|\/author\/|\/byline\/|\/bio\/|\/profiles?\/|\/staff\/|\/people\/|author(?:[-_.?/]|$)|byline(?:[-_.?/]|$)|bio(?:[-_.?/]|$)|profile(?:[-_.?/]|$)|avatar(?:[-_.?/]|$)|headshot(?:[-_.?/]|$)|portrait(?:[-_.?/]|$))/i

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'amid', 'among', 'because', 'being', 'between', 'from', 'have',
  'into', 'more', 'over', 'said', 'that', 'their', 'there', 'this', 'will', 'with', 'without', 'while',
  'для', 'или', 'как', 'что', 'это', 'его', 'она', 'они', 'при', 'над', 'под', 'после', 'пока', 'уже',
  'об', 'про', 'без', 'все', 'всё', 'новый', 'новая', 'новые', 'который', 'которая', 'которые',
  'компания', 'рынок', 'модель', 'модели', 'искусственный', 'интеллект',
  'image', 'images', 'photo', 'static', 'assets', 'upload', 'uploads', 'filearchive', 'cnews', 'habr',
  'jpg', 'jpeg', 'webp', 'png', 'svg',
])

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function stripCaption(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function combinedCandidateText(candidate: ArticleImageCandidate): string {
  return [
    candidate.alt,
    candidate.title,
    candidate.caption,
    candidate.parentClassName,
    candidate.parentId,
    candidate.parentHref,
    candidate.nearestFigureClassName,
    candidate.nearestFigureId,
  ].filter(Boolean).join(' ')
}

function normalizedUrl(value: string | null | undefined): string {
  return normalizeText(value).replace(/%2f/g, '/')
}

function looksLikeTextCover(url: string, sourceName: string): boolean {
  if (!TEXT_COVER_SOURCE_NAMES.has(sourceName)) return false
  return /(?:\/share\/|\/social\/|\/cover\/|\/covers\/|og[-_]?image|share[-_]?image|card[-_]?image|default[-_]?cover|placeholder|no[-_]?image|noimage)/i.test(url)
}

function getDisplayAlt(candidate: ArticleImageCandidate): string {
  return stripCaption(candidate.caption || candidate.alt || candidate.title || '').slice(0, 240)
}

function getCaptionForRelevance(candidate: ArticleImageCandidate): string {
  return stripCaption(candidate.caption || candidate.alt || candidate.title || '')
}

function isGenericCaption(value: string): boolean {
  const text = stripCaption(value)
  if (!text) return true
  if (/^https?:\/\//i.test(text)) return true
  if (IMAGE_FILE_RE.test(text)) return true
  if (GENERIC_CAPTION_RE.test(text)) return true
  if (/^(?:source|источник)\s*[:·-]\s*[\w .-]{2,40}$/i.test(text)) return true
  return false
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((token) => token.replace(/^[.#-]+|[.#-]+$/g, ''))
    .filter((token) => {
      if (!token) return false
      if (STOP_WORDS.has(token)) return false
      if (/^\d+$/.test(token)) return token.length >= 4
      if (['ai', 'ии', 'gpt', 'llm', 'agi', 'api', 'gpu', 'xai'].includes(token)) return true
      return token.length >= 4
    })
}

function buildArticleTokens(context: MediaSanitizerContext): Set<string> {
  const source = [
    context.originalTitle,
    context.ruTitle,
    context.lead,
    ...(context.summary ?? []).slice(0, 2),
    (context.originalText ?? '').slice(0, 900),
  ].filter(Boolean).join(' ')

  return new Set(tokenize(source))
}

function hasArticleToken(value: string, articleTokens: Set<string>): boolean {
  if (articleTokens.size === 0) return false
  for (const token of tokenize(value)) {
    if (articleTokens.has(token)) return true
  }
  return false
}

function hasUrlArticleToken(value: string, articleTokens: Set<string>): boolean {
  if (articleTokens.size === 0) return false
  for (const token of tokenize(value)) {
    if (/^\d+$/.test(token)) continue
    if (/[a-zа-яё]/i.test(token) && articleTokens.has(token)) return true
  }
  return false
}

function hasStrongSubjectMatch(candidate: ArticleImageCandidate, articleTokens: Set<string>): boolean {
  return hasArticleToken(getCaptionForRelevance(candidate), articleTokens) ||
    hasUrlArticleToken(candidate.src, articleTokens)
}

function getAspectRatio(candidate: ArticleImageCandidate): number | null {
  const width = Number(candidate.width ?? 0)
  const height = Number(candidate.height ?? 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width / height
}

function isLikelyEditorialInlineImage(candidate: ArticleImageCandidate, context: MediaSanitizerContext): boolean {
  if (!CONTEXTUAL_IMAGE_SOURCE_RE.test(context.sourceName)) return false

  const urlText = normalizedUrl(candidate.src)
  if (/habr/i.test(context.sourceName)) return /habrastorage\.org/i.test(urlText)

  return true
}

function rejectReasonForCandidate(
  candidate: ArticleImageCandidate,
  context: MediaSanitizerContext,
  articleTokens: Set<string>,
  mode: 'cover' | 'inline',
): string | null {
  const src = candidate.src
  const urlText = [candidate.src, candidate.parentHref].map(normalizedUrl).join(' ')
  const candidateText = combinedCandidateText(candidate)
  const normalizedCandidateText = normalizeText(candidateText)
  const caption = getCaptionForRelevance(candidate)
  const ratio = getAspectRatio(candidate)
  const isSvg = /\.svg(?:[?#]|$)/i.test(src)

  if (!src || /^data:/i.test(src) || /^javascript:/i.test(src)) return 'invalid_url'
  if (HARD_URL_RE.test(urlText)) return 'ad_url'
  if (UI_ICON_URL_RE.test(urlText) || UI_ICON_URL_RE.test(normalizedCandidateText)) return 'ui_icon'
  if (PROMO_TEXT_RE.test(normalizedCandidateText)) return 'promo_text'
  if (AUTHOR_TEXT_RE.test(normalizedCandidateText) || AUTHOR_URL_RE.test(urlText)) return 'author_photo'
  if (/ars technica/i.test(context.sourceName) && /^photo of\s+[A-ZА-Я]/.test(caption) && !hasArticleToken(caption, articleTokens)) {
    return 'author_photo'
  }
  if (/habr/i.test(context.sourceName) && /habrastorage\.org\/getpro\/habr\/branding\//i.test(urlText)) {
    return 'ui_icon'
  }
  if (/habr/i.test(context.sourceName) && /(?:career|courses?|карьера|курсы|вакансии)/i.test(urlText + ' ' + normalizedCandidateText)) {
    return 'promo_text'
  }

  if (mode === 'cover') {
    if (isSvg) return 'svg_cover'
    if (looksLikeTextCover(src, context.sourceName)) return 'text_cover'
    if (ratio !== null && ratio >= 2.8 && !hasStrongSubjectMatch(candidate, articleTokens)) return 'banner_ratio'
    return null
  }

  const width = Number(candidate.width ?? 0)
  const height = Number(candidate.height ?? 0)
  if ((width > 0 && width < 80) || (height > 0 && height < 80)) return 'small_image'
  if (isSvg && !hasArticleToken(getCaptionForRelevance(candidate), articleTokens)) return 'ui_icon'
  if (ratio !== null && ratio >= 2.8 && !hasStrongSubjectMatch(candidate, articleTokens)) return 'banner_ratio'
  if (ratio !== null && ratio <= 0.6 && AUTHOR_TEXT_RE.test(normalizedCandidateText)) return 'author_photo'

  if (candidate.source === 'generated') return null

  if (hasStrongSubjectMatch(candidate, articleTokens)) return null
  if (isGenericCaption(caption)) {
    if (isLikelyEditorialInlineImage(candidate, context)) return null
    return 'generic_caption'
  }
  if (CONTEXTUAL_IMAGE_SOURCE_RE.test(context.sourceName) && tokenize(caption).length >= 3) return null

  return 'irrelevant_caption'
}

function normalizeCandidate(candidate: ArticleImageCandidate | { src: string; alt?: string | null }): ArticleImageCandidate | null {
  if (!candidate || typeof candidate.src !== 'string') return null
  const src = candidate.src.trim()
  if (!src) return null
  return {
    ...candidate,
    src,
    alt: 'alt' in candidate ? candidate.alt ?? '' : '',
    source: 'source' in candidate ? candidate.source ?? 'unknown' : 'unknown',
  }
}

export function sanitizeArticleMedia({
  coverImageUrl,
  articleImages,
  context,
}: SanitizeArticleMediaInput): SanitizedMedia {
  const articleTokens = buildArticleTokens(context)
  const rejects: MediaReject[] = []
  let sanitizedCover = coverImageUrl?.trim() || null

  if (sanitizedCover) {
    const coverCandidate: ArticleImageCandidate = {
      src: sanitizedCover,
      alt: context.ruTitle ?? context.originalTitle,
      source: 'og',
    }
    const reason = rejectReasonForCandidate(coverCandidate, context, articleTokens, 'cover')
    if (reason) {
      rejects.push({ src: sanitizedCover, reason, alt: coverCandidate.alt })
      sanitizedCover = null
    }
  }

  const seen = new Set<string>()
  const sanitizedImages: { src: string; alt: string }[] = []

  for (const rawCandidate of articleImages ?? []) {
    const candidate = normalizeCandidate(rawCandidate)
    if (!candidate || seen.has(candidate.src)) continue
    seen.add(candidate.src)

    const reason = rejectReasonForCandidate(candidate, context, articleTokens, 'inline')
    if (reason) {
      rejects.push({ src: candidate.src, reason, alt: getDisplayAlt(candidate) })
      continue
    }

    sanitizedImages.push({
      src: candidate.src,
      alt: getDisplayAlt(candidate),
    })
  }

  return {
    coverImageUrl: sanitizedCover,
    articleImages: sanitizedImages,
    rejects,
  }
}

export function sanitizeArticleImagesForRender(
  articleImages: ArticleImageCandidate[] | { src: string; alt?: string | null }[] | null | undefined,
  context: MediaSanitizerContext,
  limit = 2,
): { src: string; alt: string }[] {
  return sanitizeArticleMedia({
    articleImages,
    coverImageUrl: null,
    context,
  }).articleImages.slice(0, limit)
}
