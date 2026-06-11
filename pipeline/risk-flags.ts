import type { ArticleRoutingContext } from './editorial-routing'

export type EditorialRiskFlag = 'money' | 'legal_regulation' | 'research' | 'medical' | 'geopolitics' | 'high_score'

function unicodeWord(pattern: string, flags = 'iu'): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${pattern})(?=$|[^\\p{L}\\p{N}_])`, flags)
}

const MONEY_RE = new RegExp([
  '\\$',
  'млн',
  'млрд',
  'оценк(?:а|и|у|ой|е)?',
  'инвестиц(?:ии|ий|ию|иями|ионн\\p{L}*)?',
  'раунд(?:а|е|ом|ы|ов)?',
  'выручк(?:а|и|у|ой|е)?',
  'капитализац(?:ия|ии|ию|ией)?',
  'акци(?:я|и|й|ями|ях)?',
  'IPO',
].join('|'), 'iu')

const LEGAL_RE = unicodeWord([
  'регулирован(?:ие|ия|ию|ием|ный|ная|ные|ных|ным|ными)?',
  'закон(?:а|у|ом|е|ы|ов|ами|ам|одатель\\p{L}*|опроект\\p{L}*)?',
  'иск(?:а|и|ов|ом|е|овое|овый|овым|овыми)?',
  'судебн\\p{L}*',
  'правов\\p{L}*',
  'антимонопол\\p{L}*',
  'санкци\\p{L}*',
  'конфиденциальн\\p{L}*',
  'персональн(?:ые|ых|ыми|ым|ого|ая|ой)?\\s+данн(?:ые|ых|ыми|ым|ого|ыми)?',
  'авторск\\p{L}*',
  'EU AI Act',
  'AI Act',
].join('|'))

const RESEARCH_TOPIC_RE = unicodeWord('ai-research|исследован\\p{L}*')
const MEDICAL_RE = unicodeWord([
  'медицин\\p{L}*',
  'диагноз\\p{L}*',
  'пациент\\p{L}*',
  'лекарств\\p{L}*',
  'клиник(?:а|и|е|ах|ой|у|ами)?',
  'врач\\p{L}*',
].join('|'))

const GEOPOLITICS_RE = unicodeWord([
  'войн(?:а|ы|е|ой|у|ами)?',
  'геополит\\p{L}*',
  'выбор(?:ы|ах|ами|ов|ам)',
  'государств(?:о|а|у|ом|е|енный|енная|енные|енных|енными)?',
  'разведк\\p{L}*',
  'оборон\\p{L}*',
  'военн\\p{L}*',
].join('|'))

export function detectRiskFlagsFromText(params: {
  text: string
  topics?: string[] | null
  primaryCategory?: string | null
  score?: number | null
}): EditorialRiskFlag[] {
  const flags: EditorialRiskFlag[] = []

  if (MONEY_RE.test(params.text)) flags.push('money')
  if (LEGAL_RE.test(params.text)) flags.push('legal_regulation')
  if (
    params.primaryCategory === 'ai-research' ||
    (params.topics ?? []).some((topic) => RESEARCH_TOPIC_RE.test(topic))
  ) {
    flags.push('research')
  }
  if (MEDICAL_RE.test(params.text)) flags.push('medical')
  if (GEOPOLITICS_RE.test(params.text)) flags.push('geopolitics')
  if ((params.score ?? 0) >= 8) flags.push('high_score')

  return [...new Set(flags)]
}

export function detectEditorialRiskFlags(context: ArticleRoutingContext): EditorialRiskFlag[] {
  const text = [
    context.originalTitle,
    context.originalText,
    ...(context.topics ?? []),
    context.primaryCategory ?? '',
    ...(context.secondaryCategories ?? []),
  ].join('\n')

  return detectRiskFlagsFromText({
    text,
    topics: context.topics,
    primaryCategory: context.primaryCategory,
    score: context.score,
  })
}
