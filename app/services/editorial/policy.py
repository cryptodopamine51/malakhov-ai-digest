from __future__ import annotations

from dataclasses import dataclass
import re

from app.db.models import Event, EventSection, RawItem
from app.services.normalization.utils import clean_text

_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")
_ENGLISH_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+./_-]*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class TextInspection:
    language_default: str
    has_cyrillic: bool
    english_token_count: int
    english_leakage_ratio: float
    preserved_terms: list[str]


@dataclass(frozen=True, slots=True)
class EditorializedText:
    title: str
    short_summary: str
    long_summary: str


@dataclass(frozen=True, slots=True)
class RuEditorialPolicy:
    output_language_default: str
    preserve_terms: tuple[str, ...]
    discouraged_english_phrases: tuple[str, ...]
    banned_public_phrases: tuple[str, ...]

    def prompt_rules_text(self) -> str:
        preserved = ", ".join(self.preserve_terms)
        return (
            "Пиши по умолчанию на русском языке. "
            "Не переводи бренды, продукты, модели и технические термины из этого списка: "
            f"{preserved}. "
            "Карточка должна быть редакторской: первое предложение — что произошло, второе — почему это важно. "
            "Избегай канцелярита, воды и англоязычных формулировок вроде 'it matters', 'market impact', 'developer workflows'."
        )

    def inspect_text(self, text: str | None) -> TextInspection:
        normalized = clean_text(text) or ""
        preserved_terms = [term for term in self.preserve_terms if term.lower() in normalized.lower()]
        protected = self._protect_terms(normalized)[0]
        english_tokens = _ENGLISH_TOKEN_RE.findall(protected)
        alpha_tokens = re.findall(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9+./_-]*", protected)
        leakage_ratio = round(len(english_tokens) / max(len(alpha_tokens), 1), 3)
        return TextInspection(
            language_default=self.output_language_default,
            has_cyrillic=bool(_CYRILLIC_RE.search(normalized)),
            english_token_count=len(english_tokens),
            english_leakage_ratio=leakage_ratio,
            preserved_terms=preserved_terms,
        )

    def editorialize_payload(self, *, event: Event, raw_items: list[RawItem], title: str, short_summary: str, long_summary: str) -> EditorializedText:
        fallback = self.build_fallback_payload(event=event, raw_items=raw_items)
        title = self._sanitize_title(title, fallback=fallback.title, event=event, raw_items=raw_items)
        short_summary = self._sanitize_summary(
            short_summary,
            fallback=fallback.short_summary,
            event=event,
            raw_items=raw_items,
            require_two_sentences=True,
        )
        long_summary = self._sanitize_summary(
            long_summary,
            fallback=fallback.long_summary,
            event=event,
            raw_items=raw_items,
            require_two_sentences=True,
        )
        return EditorializedText(title=title, short_summary=short_summary, long_summary=long_summary)

    def public_title(self, value: str | None, *, fallback: str = "Событие в AI") -> str:
        text = self._strip_internal_phrases(value or "")
        text = self._translate_title_patterns(self._rewrite_common_english(text))
        text = self._de_aiify_text(self._normalize(text)).strip(" .")
        if not text:
            text = fallback
        inspection = self.inspect_text(text)
        if not inspection.has_cyrillic:
            text = self._force_russian_title(text, fallback=fallback)
        return text[0].upper() + text[1:] if text else fallback

    def public_summary(self, value: str | None, *, title: str | None = None, section: str | None = None) -> str:
        text = self._strip_internal_phrases(value or "")
        text = self._rewrite_common_english(text)
        text = self._de_aiify_text(self._normalize(text))
        sentences = [part.strip().rstrip(".!?") for part in _SENTENCE_SPLIT_RE.split(text) if part.strip()]
        title_signature = self._sentence_signature(title or "")
        title_sentence = self.public_title(title, fallback="Событие в AI") if title else None
        cleaned: list[str] = []
        for sentence in sentences:
            if self._sentence_signature(sentence) == title_signature:
                continue
            if not sentence:
                continue
            cleaned.append(sentence)
        result: list[str] = []
        if title_sentence:
            result.append(self._hook_first_sentence(title_sentence, title=title, section=section))
        if cleaned:
            result.append(cleaned[0])
        if len(result) == 1:
            result.append(self._public_why_matters(section))
        return self._ensure_sentence_endings(" ".join(sentence for sentence in result[:2] if sentence))

    def public_long_summary(self, value: str | None, *, title: str | None = None, short_summary: str | None = None, section: str | None = None) -> str:
        text = self._strip_internal_phrases(value or "")
        text = self._rewrite_common_english(text)
        text = self._de_aiify_text(self._normalize(text))
        sentences = [part.strip().rstrip(".!?") for part in _SENTENCE_SPLIT_RE.split(text) if part.strip()]
        if not sentences and short_summary:
            return self.public_summary(short_summary, title=title, section=section)
        if not sentences and title:
            return self.public_summary(title, title=title, section=section)
        cleaned: list[str] = []
        title_signature = self._sentence_signature(title or "")
        title_sentence = self.public_title(title, fallback="Событие в AI") if title else None
        for sentence in sentences:
            if self._sentence_signature(sentence) == title_signature and cleaned:
                continue
            cleaned.append(sentence)
            if len(cleaned) == 2:
                break
        result: list[str] = []
        if title_sentence:
            result.append(self._hook_first_sentence(title_sentence, title=title, section=section))
        for sentence in cleaned:
            if title_signature and self._sentence_signature(sentence) == title_signature:
                continue
            result.append(sentence)
            if len(result) == 2:
                break
        if len(result) == 1:
            result.append(self._public_why_matters(section))
        return self._ensure_sentence_endings(" ".join(sentence for sentence in result[:2] if sentence))

    def public_section_label(self, section: str | None) -> str:
        mapping = {
            "important": "Главные события",
            "ai_news": "Новости ИИ",
            "coding": "Инструменты",
            "investments": "Инвестиции",
            "alpha": "Альфа",
            "all": "Все материалы",
            "russia": "ИИ в России",
        }
        return mapping.get((section or "").lower(), section or "Материалы")

    def build_fallback_payload(self, *, event: Event, raw_items: list[RawItem]) -> EditorializedText:
        title = self._build_russian_headline(event=event, raw_items=raw_items)
        why_matters = self._why_it_matters(event=event)
        consequences = self._consequence_line(event=event)
        short_summary = f"{title.rstrip('.!?')}. {why_matters}"
        long_summary = f"{title.rstrip('.!?')}. {why_matters} {consequences}"
        return EditorializedText(
            title=title.rstrip(".!?"),
            short_summary=short_summary,
            long_summary=long_summary,
        )

    def _sanitize_title(self, value: str | None, *, fallback: str, event: Event, raw_items: list[RawItem]) -> str:
        text = self._rewrite_common_english(value or "")
        text = self._de_aiify_text(self._normalize(text)).strip(" .")
        if not text:
            return fallback
        inspection = self.inspect_text(text)
        if not inspection.has_cyrillic and inspection.english_leakage_ratio > 0.35:
            return fallback
        return text[0].upper() + text[1:] if text else fallback

    def _sanitize_summary(
        self,
        value: str | None,
        *,
        fallback: str,
        event: Event,
        raw_items: list[RawItem],
        require_two_sentences: bool,
    ) -> str:
        text = self._rewrite_common_english(value or "")
        text = self._de_aiify_text(self._normalize(text))
        if not text:
            text = fallback

        inspection = self.inspect_text(text)
        if not inspection.has_cyrillic and inspection.english_leakage_ratio > 0.35:
            text = fallback

        sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(text) if part.strip()]
        if not sentences:
            text = fallback
            sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(text) if part.strip()]

        if require_two_sentences and len(sentences) < 2:
            why_matters = self._why_it_matters(event=event)
            first_sentence = sentences[0].rstrip(".!?") if sentences else fallback.rstrip(".!?")
            text = f"{first_sentence}. {why_matters}"
        normalized = self._ensure_sentence_endings(self._de_aiify_text(text))
        parts = [part.strip().rstrip(".!?") for part in _SENTENCE_SPLIT_RE.split(normalized) if part.strip()]
        if parts:
            section = next((category.section.value for category in event.categories if category.is_primary_section), None)
            parts[0] = self._hook_first_sentence(parts[0], title=event.title, section=section)
        if len(parts) == 1:
            parts.append(self._why_it_matters(event=event))
        result = self._ensure_sentence_endings(" ".join(parts[:2]))
        if result.count(".") < 2:
            lead = parts[0] if parts else fallback.rstrip(".!?")
            result = self._ensure_sentence_endings(f"{lead}. {self._why_it_matters(event=event)}")
        return result

    def _build_russian_headline(self, *, event: Event, raw_items: list[RawItem]) -> str:
        source_title = event.title or (raw_items[0].normalized_title if raw_items else "") or (raw_items[0].raw_title if raw_items else "")
        text = " ".join(filter(None, [source_title, event.short_summary, event.long_summary] + [item.raw_title for item in raw_items[:3]])).lower()
        subject = self._detect_subject(event=event, raw_items=raw_items)
        object_name = self._detect_object(raw_items=raw_items, text=text)

        if any(keyword in text for keyword in ("funding", "series a", "series b", "series c", "round")):
            return f"{subject} привлекла новый раунд финансирования"
        if any(keyword in text for keyword in ("acquisition", "acquire", "merger", "m&a")):
            return f"{subject} объявила о стратегической сделке"
        if any(keyword in text for keyword in ("partnership", "partner")):
            return f"{subject} объявила о новом партнерстве"
        if any(keyword in text for keyword in ("benchmark", "eval", "evaluation")):
            return "Новый бенчмарк задает планку для оценки AI-систем"
        if any(keyword in text for keyword in ("framework", "tooling", "workflow", "sdk", "api", "cli")):
            if object_name:
                return f"{subject} обновила {object_name}"
            return f"{subject} обновила инструменты для разработчиков"
        if any(keyword in text for keyword in ("launch", "launched", "release", "released", "ship", "shipped", "introduce", "announced", "unveiled")):
            if object_name:
                return f"{subject} представила {object_name}"
            return f"{subject} представила новое AI-обновление"
        if any(keyword in text for keyword in ("security", "vulnerability", "secret", "credentials")):
            return "Рынок получил новый повод пересмотреть безопасность AI-инфраструктуры"
        if any(keyword in text for keyword in ("voice", "speech-to-speech", "speech")):
            return "Voice AI выходит на новый уровень практического применения"
        return self._sanitize_title(source_title, fallback="Рынок получил новый заметный AI-сигнал", event=event, raw_items=raw_items)

    def _support_phrase(self, *, event: Event, raw_items: list[RawItem]) -> str:
        if not raw_items:
            return ""
        source_count = len(raw_items)
        primary_source = event.primary_source.title if event.primary_source is not None else "сильный источник"
        if source_count == 1:
            return f"Инфоповод подтверждает {primary_source}."
        return f"Инфоповод подтверждают {source_count} источника, включая {primary_source}."

    def _why_it_matters(self, *, event: Event) -> str:
        text = " ".join(filter(None, [event.title, event.short_summary, event.long_summary])).lower()
        primary_section = next((category.section for category in event.categories if category.is_primary_section), None)
        if primary_section is EventSection.CODING:
            if any(keyword in text for keyword in ("security", "secret", "credentials", "vulnerability")):
                return "Для команд в проде это прямой вопрос риска: утечки и уязвимости быстро превращаются в простой, потери и пересмотр стека."
            if any(keyword in text for keyword in ("benchmark", "eval", "agent", "testing")):
                return "Команды получают более жесткий стандарт оценки качества, а рынок поднимает планку для агентных и production-систем."
            return "Решение меняет рабочие сценарии команд и напрямую влияет на скорость вывода AI-функций в продукт."
        if primary_section is EventSection.INVESTMENTS:
            return "Сделка показывает, куда смещаются капитал и стратегический интерес, а значит влияет на оценки компаний и темп консолидации сектора."
        if primary_section is EventSection.IMPORTANT:
            return "Сигнал задает направление для рынка: после таких шагов компании пересматривают продуктовые планы, бюджеты и конкурентные ответы."
        if any(keyword in text for keyword in ("security", "supply chain", "model security")):
            return "Рынок жестче оценивает безопасность моделей и инфраструктуры, а значит меняются требования к поставщикам и закупкам."
        if any(keyword in text for keyword in ("browser", "webgpu", "transformers.js")):
            return "AI-функции уходят ближе к браузеру, и это меняет требования к продуктам, производительности и контролю над клиентским слоем."
        if any(keyword in text for keyword in ("voice", "speech")):
            return "Voice AI выходит в практический контур, а компании получают новые сценарии для продаж, поддержки и автоматизации."
        return "Событие влияет на рынок, продуктовые решения и ставки компаний, которые строят или покупают AI-инструменты."

    def _consequence_line(self, *, event: Event) -> str:
        text = " ".join(filter(None, [event.title, event.short_summary, event.long_summary])).lower()
        primary_section = next((category.section for category in event.categories if category.is_primary_section), None)
        if primary_section is EventSection.INVESTMENTS:
            return "Дальше рынок ждет новые сделки, рост конкуренции за капитал и более жесткий отбор направлений с понятной экономикой."
        if primary_section is EventSection.CODING:
            return "Следом команды будут пересматривать стек, процессы разработки и требования к качеству интеграции."
        if any(keyword in text for keyword in ("regulation", "law", "policy", "compliance")):
            return "Следом компании будут пересобирать процессы комплаенса, а поставщики — доказывать соответствие новым требованиям."
        if any(keyword in text for keyword in ("infra", "compute", "gpu", "cloud", "webgpu", "browser")):
            return "Дальше компании будут выбирать между скоростью, стоимостью и контролем над инфраструктурой."
        return "Следом компании будут пересматривать продуктовые планы, партнерства и темп внедрения."

    def _detect_subject(self, *, event: Event, raw_items: list[RawItem]) -> str:
        for raw_item in raw_items:
            for key in ("companies", "organizations", "products", "models"):
                values = (raw_item.entities_json or {}).get(key) or []
                if values:
                    return values[0]
        if event.primary_source is not None:
            for term in self.preserve_terms:
                if term.lower() in event.primary_source.title.lower():
                    return term
        return "Компания"

    def _detect_object(self, *, raw_items: list[RawItem], text: str) -> str | None:
        for raw_item in raw_items:
            for key in ("models", "products"):
                values = (raw_item.entities_json or {}).get(key) or []
                if values:
                    return values[0]
        for term in self.preserve_terms:
            if term.lower() in text:
                return term
        if "sdk" in text:
            return "SDK"
        if "api" in text:
            return "API"
        if "cli" in text:
            return "CLI-инструменты"
        return None

    def _rewrite_common_english(self, value: str) -> str:
        text, placeholders = self._protect_terms(value)
        replacements = (
            (r"\bfunding round\b", "раунд финансирования"),
            (r"\bseries [abc]\b", "раунд"),
            (r"\brollout\b", "запуск"),
            (r"\brelease\b", "релиз"),
            (r"\bbenchmark\b", "бенчмарк"),
            (r"\benterprise adoption\b", "внедрение в корпоративный контур"),
            (r"\benterprise\b", "корпоративный"),
            (r"\bdeveloper workflows?\b", "workflow разработчиков"),
            (r"\bdeveloper tooling\b", "инструменты для разработчиков"),
            (r"\bwhat happened\b", "что произошло"),
            (r"\bwhy it matters\b", "почему это важно"),
            (r"\bit matters\b", "это важно"),
            (r"\bcompetition\b", "конкуренция"),
            (r"\bmarket impact\b", "влияние на рынок"),
            (r"\bacquires\b", "покупает"),
            (r"\bacquired\b", "купила"),
            (r"\bbuys\b", "покупает"),
            (r"\bbought\b", "купила"),
            (r"\blaunches\b", "запускает"),
            (r"\blaunch\b", "запуск"),
            (r"\blaunched\b", "запустила"),
            (r"\breleases\b", "выпускает"),
            (r"\breleased\b", "выпустила"),
            (r"\bannounces\b", "объявляет"),
            (r"\bannounced\b", "объявила"),
            (r"\bintroduces\b", "представляет"),
            (r"\bintroduced\b", "представила"),
            (r"\bexpands\b", "расширяет"),
            (r"\bexpanded\b", "расширила"),
            (r"\bupdates\b", "обновляет"),
            (r"\bupdated\b", "обновила"),
            (r"\badds\b", "добавляет"),
            (r"\badded\b", "добавила"),
            (r"\bworkflow\b", "сценарий"),
            (r"\bworkflows\b", "сценарии"),
            (r"\btools\b", "инструменты"),
            (r"\bservices\b", "сервисы"),
            (r"\bstack\b", "стек"),
            (r"\bwith\b", "с"),
            (r"\bfor developers\b", "для разработчиков"),
            (r"\bfor enterprises?\b", "для корпоративных команд"),
        )
        for pattern, replacement in replacements:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        text = self._restore_terms(text, placeholders)
        return self._normalize(text)

    def _protect_terms(self, value: str) -> tuple[str, dict[str, str]]:
        text = value
        placeholders: dict[str, str] = {}
        for index, term in enumerate(sorted(self.preserve_terms, key=len, reverse=True)):
            pattern = re.compile(re.escape(term), re.IGNORECASE)
            placeholder = f"§{index}§"
            if pattern.search(text):
                text = pattern.sub(placeholder, text)
                placeholders[placeholder] = term
        return text, placeholders

    def _restore_terms(self, value: str, placeholders: dict[str, str]) -> str:
        text = value
        for placeholder, term in placeholders.items():
            text = text.replace(placeholder, term)
        return text

    def _normalize(self, value: str) -> str:
        return _SPACE_RE.sub(" ", clean_text(value) or "").strip()

    def _ensure_sentence_endings(self, value: str) -> str:
        sentences = [part.strip().rstrip(".!?") for part in _SENTENCE_SPLIT_RE.split(value) if part.strip()]
        if not sentences:
            return value
        return " ".join(f"{sentence}." for sentence in sentences)

    def _strip_internal_phrases(self, value: str) -> str:
        text = value
        for phrase in self.banned_public_phrases:
            text = re.sub(re.escape(phrase), "", text, flags=re.IGNORECASE)
        sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(text) if part.strip()]
        keep: list[str] = []
        banned_tokens = (
            "инфоповод подтверж",
            "событие собрано",
            "основной источник",
            "источника",
            "источников",
        )
        for sentence in sentences:
            lowered = sentence.lower()
            if any(token in lowered for token in banned_tokens):
                continue
            keep.append(sentence)
        return " ".join(keep)

    def _translate_title_patterns(self, value: str) -> str:
        text = value
        patterns = (
            (r"^([A-Za-z0-9 .+/_-]+?) acquires ([A-Za-z0-9 .+/_-]+)$", r"\1 покупает \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) buys ([A-Za-z0-9 .+/_-]+)$", r"\1 покупает \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) launches ([A-Za-z0-9 .+/_-]+)$", r"\1 запускает \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) adds ([A-Za-z0-9 .+/_-]+)$", r"\1 добавляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) updates ([A-Za-z0-9 .+/_-]+)$", r"\1 обновляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) announces ([A-Za-z0-9 .+/_-]+)$", r"\1 объявляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) introduces ([A-Za-z0-9 .+/_-]+)$", r"\1 представляет \2"),
        )
        for pattern, replacement in patterns:
            if re.match(pattern, text, flags=re.IGNORECASE):
                return re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        return text

    def _force_russian_title(self, value: str, *, fallback: str) -> str:
        text = self._translate_title_patterns(value)
        text = self._rewrite_common_english(text)
        if self.inspect_text(text).has_cyrillic:
            return text
        return f"{text} в AI" if text else fallback

    def _public_why_matters(self, section: str | None) -> str:
        key = (section or "").lower()
        if key == "coding":
            return "Команды меняют рабочие сценарии, а продукты получают новый темп вывода AI-функций."
        if key == "investments":
            return "Капитал идет туда, где рынок ждет следующий рост, и это влияет на оценки компаний и силу новых альянсов."
        if key == "russia":
            return "Для локального рынка это означает пересмотр бюджетов, инфраструктуры и позиции крупных заказчиков."
        if key == "important":
            return "Крупные платформы и их конкуренты будут отвечать на этот шаг изменением стратегии, продукта и ценового давления."
        return "Событие влияет на конкурентную среду, продуктовые решения и бизнес-ставки вокруг AI."

    def _hook_first_sentence(self, sentence: str, *, title: str | None, section: str | None) -> str:
        cleaned = self._de_aiify_text(sentence).rstrip(".!?")
        if not cleaned:
            return cleaned
        lowered = cleaned.lower()
        if any(
            token in lowered
            for token in (
                "гонка за",
                "давление на",
                "рынок быстро",
                "темп внедрения",
                "конкуренция за",
                "давление в отрасли",
            )
        ):
            return cleaned
        hook_type = self._classify_hook_type(cleaned, title=title, section=section)
        prefix = self._hook_prefix(hook_type, signature_source=title or cleaned)
        return f"{prefix}: {cleaned}"

    def _classify_hook_type(self, sentence: str, *, title: str | None, section: str | None) -> str:
        text = " ".join(filter(None, [title, sentence, section])).lower()
        if any(token in text for token in ("регулир", "закон", "требован", "compliance", "безопасност", "security", "pressure")):
            return "pressure"
        if any(token in text for token in ("acquire", "merger", "m&a", "покупает", "сделк", "рынок", "конкур", "funding", "investment", "инвест")):
            return "market_shift"
        if any(token in text for token in ("copilot", "sdk", "api", "cli", "tool", "workflow", "инструмент", "developer", "разработ")):
            return "acceleration"
        return "competition"

    def _hook_prefix(self, hook_type: str, *, signature_source: str) -> str:
        variants = {
            "competition": (
                "Гонка за рынок ускоряется",
                "Конкуренция за клиентов обостряется",
                "Рынок быстрее делит влияние",
            ),
            "acceleration": (
                "Темп внедрения растет",
                "Команды ускоряют переход в прод",
                "Рынок быстрее меняет рабочий стек",
            ),
            "market_shift": (
                "Рынок быстро смещается",
                "Расстановка сил меняется",
                "Сектор уходит в новый баланс",
            ),
            "pressure": (
                "Давление на компании усиливается",
                "Правила для рынка становятся жестче",
                "Игроки получают новый источник давления",
            ),
        }
        options = variants.get(hook_type, variants["competition"])
        index = sum(ord(ch) for ch in signature_source) % len(options)
        return options[index]

    def _de_aiify_text(self, value: str) -> str:
        text = value
        substitutions = (
            (r"\bданное\s+", ""),
            (r"\bЭто может повлиять на\b", "Это влияет на"),
            (r"\bэто может повлиять на\b", "это влияет на"),
            (r"\bЭто помогает понять\b", "Рынок уже показывает"),
            (r"\bэто помогает понять\b", "рынок уже показывает"),
            (r"\bЭто позволяет\b", "Это ускоряет"),
            (r"\bэто позволяет\b", "это ускоряет"),
            (r"\bAI-повестк[аеиуы]\b", "AI-рынок"),
        )
        for pattern, replacement in substitutions:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        text = re.sub(r"\bне [^,.!?;:]{1,50}, а ([^.!?]{1,80})", r"\1", text, flags=re.IGNORECASE)
        return self._normalize(text)

    def _sentence_signature(self, value: str) -> str:
        text = self._normalize(value).lower()
        text = re.sub(r"[^a-zа-яё0-9]+", " ", text)
        return " ".join(text.split())


_DEFAULT_POLICY = RuEditorialPolicy(
    output_language_default="ru",
    preserve_terms=(
        "OpenAI",
        "Anthropic",
        "GPT-5",
        "GPT-4",
        "Claude",
        "Gemini",
        "GitHub Copilot",
        "ChatGPT",
        "CUDA",
        "API",
        "SDK",
        "CLI",
        "NVIDIA",
        "Meta",
        "Google",
        "GitHub",
        "Hugging Face",
        "Llama",
        "Mistral",
        "WebGPU",
        "Transformers.js",
    ),
    discouraged_english_phrases=(
        "it matters",
        "market impact",
        "developer workflow",
        "what happened",
        "why it matters",
    ),
    banned_public_phrases=(
        "Инфоповод подтвержден",
        "Инфоповод подтверждает",
        "Инфоповод подтверждают",
        "Событие собрано по",
        "основной источник",
    ),
)


def get_ru_editorial_policy() -> RuEditorialPolicy:
    return _DEFAULT_POLICY
