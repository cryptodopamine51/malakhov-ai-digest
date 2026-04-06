from __future__ import annotations

from dataclasses import dataclass
import re

from app.db.models import Event, EventSection, RawItem
from app.services.normalization.utils import clean_text

_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")
_ENGLISH_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+./_-]*")
_ENGLISH_GLUE_RE = re.compile(r"\b(?:the|and|for|with|from|into|company|says|said|now|only|not|will|larger|support)\b", re.IGNORECASE)
_QUOTE_RE = re.compile(r"[\"«“](.+?)[\"»”]")
_NUMBER_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:%|x|млрд|млн|тыс\.?|секунд[а-я]*|минут[а-я]*|час[а-я]*|дней|day|days|million|billion)?\b", re.IGNORECASE)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_SPACE_RE = re.compile(r"\s+")
_VAGUE_OPENING_RE = re.compile(
    r"\b(?:на рынке появился заметный новый сдвиг|фокус быстро смещается|в центре обсуждения оказал[аи]сь|в центре внимания уже не только|появился новый сигнал|история сводится к тому)\b[^.!?]*",
    re.IGNORECASE,
)


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
class EvidenceUnit:
    kind: str
    text: str
    source_role: str
    source_title: str | None = None


@dataclass(frozen=True, slots=True)
class SourcePack:
    facts: list[str]
    entities: list[str]
    context: list[str]
    quotes: list[str]
    numbers: list[str]
    signals: list[str]
    details: list[str]
    disagreements: list[str]
    evidence_units: list[EvidenceUnit]
    richness_score: float


@dataclass(frozen=True, slots=True)
class ArticlePayload:
    mode: str
    depth: str
    paragraphs: list[str]
    nut_graf: str
    source_pack: SourcePack


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
        article = self.build_article(
            title=title,
            short_summary=short_summary,
            long_summary=value,
            section=section,
        )
        return " ".join(article.paragraphs)

    def build_event_source_pack(
        self,
        *,
        title: str | None,
        short_summary: str | None,
        long_summary: str | None,
        section: str | None = None,
        primary_source_title: str | None = None,
        categories: list[str] | None = None,
        tags: list[str] | None = None,
        supporting_source_count: int = 0,
        source_documents: list[dict[str, object]] | None = None,
    ) -> SourcePack:
        documents = list(source_documents or [])
        summary_inputs = [title or "", short_summary or "", long_summary or ""]
        facts: list[str] = []
        context: list[str] = []
        details: list[str] = []
        quotes: list[str] = []
        numbers: list[str] = []
        disagreements: list[str] = []
        entities: list[str] = []
        evidence_units: list[EvidenceUnit] = []
        seen_signatures: set[str] = set()
        target_signatures: dict[str, set[str]] = {
            "facts": set(),
            "context": set(),
            "details": set(),
            "disagreements": set(),
        }

        def collect_sentence(sentence: str, *, target: list[str], kind: str, source_role: str = "summary", source_title_value: str | None = None) -> None:
            cleaned = self.clean_generated_article(sentence, title=title).strip()
            signature = self._sentence_signature(cleaned)
            if not cleaned or not signature:
                return
            target_key = (
                "facts" if target is facts else
                "context" if target is context else
                "details" if target is details else
                "disagreements"
            )
            if signature in target_signatures[target_key]:
                return
            target_signatures[target_key].add(signature)
            if target is facts and signature in seen_signatures:
                return
            seen_signatures.add(signature)
            target.append(cleaned.rstrip(".!?"))
            if not any(unit.kind == kind and self._sentence_signature(unit.text) == signature for unit in evidence_units):
                evidence_units.append(
                    EvidenceUnit(
                        kind=kind,
                        text=cleaned.rstrip(".!?"),
                        source_role=source_role,
                        source_title=source_title_value,
                    )
                )

        primary_docs = [doc for doc in documents if str(doc.get("role") or "") == "primary"]
        secondary_docs = [doc for doc in documents if str(doc.get("role") or "") != "primary"]

        for doc in [*primary_docs, *secondary_docs]:
            quotes.extend(self._extract_document_quotes(doc))
            numbers.extend(self._extract_document_numbers(doc))
            disagreements.extend(self._extract_source_differences(doc))

        for doc in [*primary_docs, *secondary_docs]:
            for sentence in self._extract_source_sentences(str(doc.get("text") or "")):
                collect_sentence(
                    sentence,
                    target=facts,
                    kind="fact",
                    source_role=str(doc.get("role") or "supporting"),
                    source_title_value=str(doc.get("source_title") or doc.get("title") or ""),
                )
                if len(facts) >= 6:
                    break
            if len(facts) >= 6:
                break

        for value in summary_inputs:
            for part in _SENTENCE_SPLIT_RE.split(self._normalize(self._de_aiify_text(self._rewrite_common_english(self._strip_internal_phrases(value))))):
                collect_sentence(part, target=facts, kind="fact")
                if len(facts) >= 6:
                    break
            if len(facts) >= 6:
                break

        for doc in [*primary_docs, *secondary_docs]:
            for sentence in self._extract_context_sentences(str(doc.get("text") or "")):
                collect_sentence(
                    sentence,
                    target=context,
                    kind=self._classify_context_kind(sentence),
                    source_role=str(doc.get("role") or "supporting"),
                    source_title_value=str(doc.get("source_title") or doc.get("title") or ""),
                )
                if len(context) >= 5:
                    break
            if len(context) >= 5:
                break

        for sentence in facts[1:]:
            if len(context) >= 5:
                break
            if len(sentence.split()) >= 7:
                collect_sentence(sentence, target=context, kind="context_now")

        for doc in [*primary_docs, *secondary_docs]:
            source_role = str(doc.get("role") or "supporting")
            source_title_value = str(doc.get("source_title") or doc.get("title") or "")
            for sentence in self._extract_detail_sentences(str(doc.get("text") or "")):
                collect_sentence(
                    sentence,
                    target=details,
                    kind=self._classify_detail_kind(sentence),
                    source_role=source_role,
                    source_title_value=source_title_value,
                )
                if len(details) >= 8:
                    break
            if len(details) >= 8:
                break

        for candidate in [title or "", primary_source_title or ""] + list(tags or []):
            entities.extend(self._extract_entities_from_text(candidate))
        for doc in documents:
            entities.extend(self._extract_document_entities(doc))
        for category in categories or []:
            entities.append(self.public_section_label(category))
        entities = self._dedupe_preserve_order(entities)[:8]

        combined = " ".join(
            filter(
                None,
                [
                    *summary_inputs,
                    *(str(doc.get("title") or "") for doc in documents),
                    *(str(doc.get("text") or "") for doc in documents),
                ],
            )
        ).lower()
        signals: list[str] = []
        signal_patterns = (
            (("рын", "market", "competition", "конкур", "цена", "доля"), "market"),
            (("launch", "release", "запуск", "релиз", "model", "продукт", "обнов"), "product"),
            (("infra", "compute", "gpu", "cloud", "sdk", "api", "cli", "платформ", "инфраструкт"), "infra"),
            (("funding", "investment", "invest", "раунд", "инвест", "сделк", "партнер"), "competition"),
            (("regulation", "law", "policy", "compliance", "закон", "регулир", "требован"), "consequence"),
            (("said", "says", "заявил", "заявила", "по словам", "считает", "отметил", "comment"), "opinion"),
        )
        for keywords, label in signal_patterns:
            if any(keyword in combined for keyword in keywords) and label not in signals:
                signals.append(label)
        if len(documents) > 1 or supporting_source_count > 0:
            signals.append("multi_source")
        if primary_source_title:
            signals.append("primary_source")
        if quotes:
            signals.append("quote")
        if numbers:
            signals.append("numbers")
        if details:
            signals.append("detail")
        if disagreements:
            signals.append("source_difference")
        if any(unit.kind == "regulation_signal" for unit in evidence_units):
            signals.append("regulation_detail")
        if any(unit.kind == "infrastructure_signal" for unit in evidence_units):
            signals.append("infrastructure_detail")
        if any(unit.kind == "competitive_signal" for unit in evidence_units):
            signals.append("competitive_detail")

        richness_score = round(
            len(facts) * 1.25
            + len(signals) * 1.05
            + len(context) * 0.9
            + min(len(details), 5) * 0.8
            + min(len(quotes), 2) * 0.8
            + min(len(numbers), 3) * 0.55
            + min(len(entities), 5) * 0.4
            + min(len(documents), 4) * 0.9
            + min(len(disagreements), 2) * 0.75
            + min(supporting_source_count, 3) * 0.45,
            2,
        )
        return SourcePack(
            facts=facts[:6],
            entities=entities[:6],
            context=context[:5],
            details=self._dedupe_preserve_order(details)[:6],
            quotes=self._dedupe_preserve_order(quotes)[:3],
            numbers=self._dedupe_preserve_order(numbers)[:4],
            signals=self._dedupe_preserve_order(signals),
            disagreements=self._dedupe_preserve_order(disagreements)[:3],
            evidence_units=self._dedupe_evidence_units(evidence_units)[:18],
            richness_score=richness_score,
        )

    def compute_article_depth(self, *, source_pack: SourcePack) -> str:
        meaningful_detail_count = len(source_pack.details)
        supporting_evidence_count = len(
            [
                unit
                for unit in source_pack.evidence_units
                if unit.kind in {"detail", "number", "quote", "competitive_signal", "regulation_signal", "infrastructure_signal", "consequence"}
            ]
        )
        has_strong_secondary = len(source_pack.disagreements) > 0 or "source_difference" in source_pack.signals
        if (
            source_pack.richness_score >= 18
            and len(source_pack.facts) >= 5
            and "multi_source" in source_pack.signals
            and "quote" in source_pack.signals
            and "numbers" in source_pack.signals
            and meaningful_detail_count >= 3
            and len(source_pack.context) >= 3
            and supporting_evidence_count >= 7
        ):
            return "D4"
        if (
            source_pack.richness_score >= 11.5
            and len(source_pack.facts) >= 3
            and len(source_pack.context) >= 2
            and "multi_source" in source_pack.signals
            and (
                "numbers" in source_pack.signals
                or "quote" in source_pack.signals
                or meaningful_detail_count >= 2
                or has_strong_secondary
            )
            and supporting_evidence_count >= 4
        ):
            return "D3"
        return "D2"

    def classify_article_mode(self, *, source_pack: SourcePack, section: str | None = None) -> str:
        if "consequence" in source_pack.signals:
            return "regulation_impact"
        if "quote" in source_pack.signals and source_pack.quotes:
            return "quote_led"
        if section == "investments" or "investment" in source_pack.signals or "competition" in source_pack.signals and "numbers" in source_pack.signals:
            return "investment_signal"
        if "market" in source_pack.signals and "competition" in source_pack.signals:
            return "market_move"
        if "product" in source_pack.signals and ("infra" in source_pack.signals or len(source_pack.context) >= 2):
            return "product_deepening"
        return "straight_news"

    def build_nut_graf(self, *, source_pack: SourcePack, section: str | None = None) -> str:
        mode = self.classify_article_mode(source_pack=source_pack, section=section)
        subject = self._article_subject(source_pack=source_pack, title="") or "игроки рынка"
        evidence = self._article_supporting_detail(source_pack=source_pack)
        if mode == "regulation_impact":
            return f"Это решение меняет прикладные правила для поставщиков и заказчиков: {subject} придется закладывать новые требования в продукт, документы и цикл запуска."
        if mode == "quote_led":
            return f"Сюжет важен не формулировкой из пресс-релиза, а сдвигом в требованиях к продукту: {evidence or 'покупатели и партнеры начали оценивать платформы по управляемости и качеству внедрения'}."
        if mode == "investment_signal":
            return f"Капитал в этой истории важен как рыночный индикатор: деньги идут туда, где инвесторы ждут более быстрый рост выручки, партнерств и распределения долей."
        if mode == "market_move":
            return f"Для рынка это означает более жесткое сравнение платформ по цене, скорости ответа и качеству поставки, а не по одному громкому анонсу."
        if mode == "product_deepening":
            return f"Сейчас значение задает не сам релиз, а его прикладной эффект: {evidence or 'командам придется оценивать стоимость внедрения, контроль над инфраструктурой и скорость интеграции'}."
        return f"Дальше рынок будет смотреть на прикладной результат: насколько быстро {subject} превратят этот шаг в контракт, рабочий сценарий или новый стандарт закупки."

    def build_article(
        self,
        *,
        title: str | None,
        short_summary: str | None,
        long_summary: str | None,
        section: str | None = None,
        primary_source_title: str | None = None,
        categories: list[str] | None = None,
        tags: list[str] | None = None,
        supporting_source_count: int = 0,
        source_documents: list[dict[str, object]] | None = None,
    ) -> ArticlePayload:
        public_title = self.public_title(title, fallback="Событие в AI")
        source_pack = self.build_event_source_pack(
            title=public_title,
            short_summary=short_summary,
            long_summary=long_summary,
            section=section,
            primary_source_title=primary_source_title,
            categories=categories,
            tags=tags,
            supporting_source_count=supporting_source_count,
            source_documents=source_documents,
        )
        depth = self.compute_article_depth(source_pack=source_pack)
        mode = self.classify_article_mode(source_pack=source_pack, section=section)
        lead = self._article_opening(source_pack=source_pack, title=public_title, section=section, mode=mode)
        nut_graf = self.build_nut_graf(source_pack=source_pack, section=section)
        development = self._article_development_sentences(source_pack=source_pack, title=public_title, limit=4 if depth == "D4" else 3)
        consequence = self._article_consequence(source_pack=source_pack, section=section)
        market = self._article_market_line(source_pack=source_pack, section=section)
        support = self._article_support_fact(source_pack=source_pack, title=public_title)
        quote_line = self._article_quote_line(source_pack=source_pack)
        number_line = self._article_numbers_line(source_pack=source_pack)
        evidence_line = self._article_evidence_line(source_pack=source_pack, mode=mode, title=public_title)
        detail_lines = self._article_detail_lines(source_pack=source_pack, title=public_title, limit=3 if depth == "D4" else 2)
        context_line = self._article_context_line(source_pack=source_pack, title=public_title)
        disagreement_line = self._article_difference_line(source_pack=source_pack)

        if depth == "D2":
            paragraphs = [
                self._combine_article_sentences(lead, support),
                self._combine_article_sentences(nut_graf, detail_lines[0] if detail_lines else evidence_line, number_line or context_line),
                self._combine_article_sentences(development[0] if development else "", disagreement_line, consequence, market),
            ]
        elif depth == "D3":
            paragraphs = [
                self._combine_article_sentences(lead, support),
                self._combine_article_sentences(nut_graf, context_line),
                self._combine_article_sentences(evidence_line, detail_lines[0] if detail_lines else "", number_line),
                self._combine_article_sentences(detail_lines[1] if len(detail_lines) > 1 else "", development[0] if development else "", quote_line),
                self._combine_article_sentences(development[1] if len(development) > 1 else "", disagreement_line, consequence, market),
            ]
        else:
            paragraphs = self._build_d4_outline(
                lead=lead,
                nut_graf=nut_graf,
                evidence_line=evidence_line,
                detail_lines=detail_lines,
                context_line=context_line,
                quote_line=quote_line,
                number_line=number_line,
                development=development,
                disagreement_line=disagreement_line,
                consequence=consequence,
                market=market,
            )

        final = [self.clean_generated_article(paragraph, title=public_title) for paragraph in paragraphs]
        final = [paragraph for paragraph in final if paragraph]
        return ArticlePayload(mode=mode, depth=depth, paragraphs=final[:8], nut_graf=nut_graf, source_pack=source_pack)

    def clean_generated_article(self, text: str | None, *, title: str | None = None) -> str:
        if not text:
            return ""
        cleaned = self._strip_internal_phrases(text)
        cleaned = self._rewrite_common_english(cleaned)
        cleaned = self._de_aiify_text(self._normalize(cleaned))
        cleaned = re.sub(r"\b(?:почему это важно|что это меняет|кто выигрывает ?/ ?проигрывает)\b:?", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\bв AI\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(
            r"\b(?:это важно для|история важна не только|смысл события шире|сделала ход, после которого|это показывает|это позволяет|это помогает понять|это может|данное|повестка)\b[^.!?]*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = _VAGUE_OPENING_RE.sub("", cleaned)
        cleaned = re.sub(r"\bне [^,.!?;:]{1,50}, а ([^.!?]{1,80})", r"\1", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r":\s*:", ":", cleaned)
        cleaned = re.sub(r"\b([A-ZА-Я][^.!?]{0,120})\s+\1\b", r"\1", cleaned)
        cleaned = re.sub(r"\b(?:гонка за рынок ускоряется|конкуренция за клиентов обостряется|рынок быстрее делит влияние|темп внедрения растет|команды ускоряют переход в прод|рынок быстрее меняет рабочий стек|рынок быстро смещается|расстановка сил меняется|сектор уходит в новый баланс)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
        if title:
            cleaned = self._trim_title_overlap(cleaned, title=title)
        sentences = [part.strip().rstrip(".!?") for part in _SENTENCE_SPLIT_RE.split(cleaned) if part.strip()]
        deduped: list[str] = []
        seen_signatures: set[str] = set()
        for sentence in sentences:
            signature = self._sentence_signature(sentence)
            if signature and signature not in seen_signatures:
                deduped.append(sentence)
                seen_signatures.add(signature)
        if not deduped and cleaned:
            deduped = [cleaned.rstrip(".!?")]
        return " ".join(f"{sentence.rstrip('.!?')}." for sentence in deduped if sentence.strip())

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
            (r"\bEuropean Union\b", "ЕС"),
            (r"\bEU\b", "ЕС"),
            (r"\bnew\b", "новый"),
            (r"\bfunding round\b", "раунд финансирования"),
            (r"\braises\b", "привлекает"),
            (r"\braised\b", "привлекла"),
            (r"\bseries [abc]\b", "раунд"),
            (r"\brollout\b", "запуск"),
            (r"\brelease\b", "релиз"),
            (r"\bships\b", "выпускает"),
            (r"\bshipped\b", "выпустила"),
            (r"\bsets\b", "вводит"),
            (r"\bset new\b", "вводит новые"),
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
            (r"\bobligations\b", "обязательства"),
            (r"\btransparency rules\b", "правила прозрачности"),
            (r"\btransparency\b", "прозрачность"),
            (r"\bproviders\b", "поставщики"),
            (r"\bprovider\b", "поставщик"),
            (r"\bdeployment teams\b", "команды внедрения"),
            (r"\breporting\b", "отчетность"),
            (r"\bdocumentation\b", "документация"),
            (r"\benforcement timelines\b", "сроки контроля"),
            (r"\badaptation window\b", "срок адаптации"),
            (r"\bcompliance costs\b", "затраты на комплаенс"),
            (r"\bdocument processing\b", "обработка документов"),
            (r"\bdocument parsing layer\b", "слой разбора документов"),
            (r"\bdistribution deals\b", "дистрибуционные сделки"),
            (r"\bproduct hiring\b", "наем в продуктовые команды"),
            (r"\banswer engines\b", "поисковые ИИ-сервисы"),
            (r"\bgovernance\b", "управление"),
            (r"\bcontrols\b", "контроли"),
            (r"\boperating discipline\b", "операционная дисциплина"),
            (r"\bfewer demos\b", "меньше демонстраций"),
            (r"\bworkflow\b", "сценарий"),
            (r"\bworkflows\b", "сценарии"),
            (r"\btools\b", "инструменты"),
            (r"\bservices\b", "сервисы"),
            (r"\bstack\b", "стек"),
            (r"\bwith\b", "с"),
            (r"\bfor developers\b", "для разработчиков"),
            (r"\bfor enterprises?\b", "для корпоративных команд"),
            (r"\bproduction\b", "прод"),
        )
        for pattern, replacement in replacements:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        text = re.sub(r"\$?\s?(\d+(?:[.,]\d+)?)\s+million\b", r"$\1 млн", text, flags=re.IGNORECASE)
        text = re.sub(r"\$?\s?(\d+(?:[.,]\d+)?)\s+billion\b", r"$\1 млрд", text, flags=re.IGNORECASE)
        text = re.sub(r"\bvaluation of \$?(\d+(?:[.,]\d+)?)\s*(?:million|billion|млн|млрд)\b", r"при оценке в $\1", text, flags=re.IGNORECASE)
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
            (r"^([A-Za-z0-9 .+/_-]+?) ships ([A-Za-z0-9 .+/_-]+)$", r"\1 выпускает \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) adds ([A-Za-z0-9 .+/_-]+)$", r"\1 добавляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) updates ([A-Za-z0-9 .+/_-]+)$", r"\1 обновляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) announces ([A-Za-z0-9 .+/_-]+)$", r"\1 объявляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) introduces ([A-Za-z0-9 .+/_-]+)$", r"\1 представляет \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) raises ([A-Za-z0-9 .+/_-]+)$", r"\1 привлекает \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) sets ([A-Za-z0-9 .+/_-]+)$", r"\1 вводит \2"),
            (r"^([A-Za-z0-9 .+/_-]+?) expands ([A-Za-z0-9 .+/_-]+)$", r"\1 расширяет \2"),
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
        return fallback

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
        text = re.sub(r"\bв AI\b", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\bAI\b", "ИИ", text)
        text = re.sub(r"\bEU\b", "ЕС", text)
        text = re.sub(r"\b([0-9]+(?:[.,][0-9]+)?)\s+million\b", r"$\1 млн", text, flags=re.IGNORECASE)
        text = re.sub(r"\b([0-9]+(?:[.,][0-9]+)?)\s+billion\b", r"$\1 млрд", text, flags=re.IGNORECASE)
        text = re.sub(r"\bне [^,.!?;:]{1,50}, а ([^.!?]{1,80})", r"\1", text, flags=re.IGNORECASE)
        return self._normalize(text)

    def _trim_title_overlap(self, value: str, *, title: str) -> str:
        normalized = value.strip()
        title_text = self.public_title(title, fallback=title).rstrip(".!?")
        title_signature = self._sentence_signature(title_text)
        if not title_signature:
            return normalized
        if self._sentence_signature(normalized) == title_signature:
            return ""
        return normalized

    def _article_opening(self, *, source_pack: SourcePack, title: str, section: str | None, mode: str) -> str:
        lead = self._article_lead_fact(source_pack=source_pack, title=title, section=section)
        if mode == "regulation_impact":
            return self._article_regulation_lede(source_pack=source_pack, title=title) or lead
        if mode == "investment_signal":
            return self._article_investment_lede(source_pack=source_pack, title=title) or lead
        if mode == "market_move":
            return self._article_market_lede(source_pack=source_pack, title=title) or lead
        if mode == "product_deepening":
            return self._article_product_lede(source_pack=source_pack, title=title) or lead
        if mode == "quote_led":
            quote_fact = self._article_quote_support(source_pack=source_pack)
            return self._combine_article_sentences(lead, quote_fact) if quote_fact else lead
        return lead

    def _article_lead_fact(self, *, source_pack: SourcePack, title: str, section: str | None) -> str:
        title_text = self.public_title(title, fallback=title).rstrip(".!?")
        title_inspection = self.inspect_text(title_text)
        if (
            title_text
            and title_inspection.has_cyrillic
            and len(title_text.split()) >= 3
            and title_inspection.english_token_count - len(title_inspection.preserved_terms) <= 1
        ):
            expanded = self._expand_title_lede(title_text=title_text, source_pack=source_pack, section=section)
            if expanded:
                return expanded
        for fact in source_pack.facts:
            trimmed = self._trim_title_overlap(fact, title=title)
            if trimmed and self._is_public_sentence_ready(trimmed):
                return trimmed
        detail = self._article_best_evidence(source_pack=source_pack, title=title)
        if detail:
            return detail
        fallback_map = {
            "coding": "Поставщики инструментов меняют рабочие сценарии для команд разработки",
            "investments": "Компании привлекли новый капитал и усилили давление на соседние сегменты рынка",
            "russia": "Регуляторы и компании меняют правила работы на локальном рынке ИИ",
        }
        return fallback_map.get((section or "").lower(), "Компании меняют продуктовые и рыночные условия вокруг ИИ")

    def _article_support_fact(self, *, source_pack: SourcePack, title: str) -> str:
        for sentence in source_pack.facts[1:]:
            trimmed = self._trim_title_overlap(sentence, title=title)
            if trimmed and len(trimmed.split()) >= 6 and self._is_public_sentence_ready(trimmed):
                return trimmed
        if source_pack.context:
            for sentence in source_pack.context:
                trimmed = self._trim_title_overlap(sentence, title=title)
                if trimmed and self._is_public_sentence_ready(trimmed):
                    return trimmed
        detail = self._article_supporting_detail(source_pack=source_pack)
        if detail:
            return detail
        if "infra" in source_pack.signals:
            return "Следующим предметом сравнения станут стоимость запуска, интеграция в существующий стек и контроль над инфраструктурой."
        if "competition" in source_pack.signals or "market" in source_pack.signals:
            return "Для конкурентов здесь важен не сам анонс, а то, как быстро им придется отвечать продуктом, ценой или дистрибуцией."
        return "Практическое значение новости определят сроки внедрения, условия закупки и способность команды довести релиз до production."

    def _article_development_sentences(self, *, source_pack: SourcePack, title: str, limit: int) -> list[str]:
        selected: list[str] = []
        seen: set[str] = set()
        for sentence in [*source_pack.details, *source_pack.context, *source_pack.facts]:
            trimmed = self._trim_title_overlap(sentence, title=title)
            signature = self._sentence_signature(trimmed)
            if not trimmed or not signature or signature in seen:
                continue
            if len(trimmed.split()) < 5:
                continue
            if not self._is_public_sentence_ready(trimmed):
                continue
            selected.append(trimmed)
            seen.add(signature)
            if len(selected) >= limit:
                return selected
        fallbacks = []
        if "infra" in source_pack.signals:
            fallbacks.append("Дальше компании будут спорить о стоимости запуска, доступе к вычислительным ресурсам и контроле над инфраструктурой.")
        if "competition" in source_pack.signals:
            fallbacks.append("Дальше рынок будет сравнивать, кто быстрее превратит этот шаг в контракт, снижение цены или новое преимущество в поставке.")
        if "product" in source_pack.signals:
            fallbacks.append("Практический эффект проявится в том, как быстро релиз дойдет до коммерческих сценариев, дистрибуции и закупок.")
        fallbacks.append("Дальше компании будут смотреть на сроки внедрения, качество интеграции и реальное влияние на продуктовую экономику.")
        for fallback in fallbacks:
            signature = self._sentence_signature(fallback)
            if signature not in seen:
                selected.append(fallback.rstrip("."))
                seen.add(signature)
            if len(selected) >= limit:
                break
        return selected[:limit]

    def _build_d4_outline(
        self,
        *,
        lead: str,
        nut_graf: str,
        evidence_line: str,
        detail_lines: list[str],
        context_line: str,
        quote_line: str,
        number_line: str,
        development: list[str],
        disagreement_line: str,
        consequence: str,
        market: str,
    ) -> list[str]:
        return [
            self._combine_article_sentences(lead),
            self._combine_article_sentences(nut_graf),
            self._combine_article_sentences(evidence_line, detail_lines[0] if detail_lines else ""),
            self._combine_article_sentences(number_line, detail_lines[1] if len(detail_lines) > 1 else ""),
            self._combine_article_sentences(quote_line, development[0] if development else ""),
            self._combine_article_sentences(context_line, development[1] if len(development) > 1 else "", disagreement_line),
            self._combine_article_sentences(development[2] if len(development) > 2 else "", consequence, market),
        ]

    def _article_consequence(self, *, source_pack: SourcePack, section: str | None) -> str:
        if "consequence" in source_pack.signals:
            return "Практическое следствие здесь прямое: поставщикам придется пересобрать документацию, юридический контур и требования к выпуску продукта."
        if "competition" in source_pack.signals or "market" in source_pack.signals:
            return "Следом изменятся переговорные позиции игроков: одним придется снижать цену, другим ускорять релизы, третьим доказывать зрелость корпоративного контура."
        if "infra" in source_pack.signals:
            return "Для рынка это означает новый торг вокруг вычислений, стоимости запуска и того, кто контролирует базовую платформу."
        return self._consequence_from_section(section)

    def _article_market_line(self, *, source_pack: SourcePack, section: str | None) -> str:
        if "market" in source_pack.signals and "product" in source_pack.signals:
            return "Из-за этого заказчики будут сравнивать игроков по готовности к внедрению, глубине продукта и скорости поставки."
        if "multi_source" in source_pack.signals and "competition" in source_pack.signals:
            return "Сюжет быстро вышел за пределы одного анонса: на него уже смотрят как на сигнал для цен, партнерств и корпоративных закупок."
        if "opinion" in source_pack.signals:
            return "Когда вокруг новости сразу появляются комментарии и разборы, это обычно означает сдвиг в том, как рынок оценивает зрелость продукта и риски внедрения."
        return self._consequence_from_section(section)

    def _article_quote_line(self, *, source_pack: SourcePack) -> str:
        if not source_pack.quotes:
            return ""
        quote = self._normalize(source_pack.quotes[0]).strip(" .")
        if len(quote.split()) < 4:
            return ""
        if self._quote_is_publishable(quote):
            return f"В исходных материалах это сформулировано коротко: «{quote}»."
        paraphrase = self._paraphrase_quote(quote)
        return paraphrase

    def _article_numbers_line(self, *, source_pack: SourcePack) -> str:
        if not source_pack.numbers:
            return ""
        values = ", ".join(self._normalize_number_token(value) for value in source_pack.numbers[:2])
        return f"В материалах фигурируют конкретные ориентиры: {values}."

    def _article_detail_lines(self, *, source_pack: SourcePack, title: str, limit: int) -> list[str]:
        selected: list[str] = []
        seen: set[str] = set()
        for sentence in source_pack.details:
            trimmed = self._trim_title_overlap(sentence, title=title)
            signature = self._sentence_signature(trimmed)
            if not trimmed or not signature or signature in seen:
                continue
            if not self._is_public_sentence_ready(trimmed):
                continue
            selected.append(trimmed)
            seen.add(signature)
            if len(selected) >= limit:
                break
        return selected

    def _article_context_line(self, *, source_pack: SourcePack, title: str) -> str:
        for sentence in source_pack.context:
            trimmed = self._trim_title_overlap(sentence, title=title)
            if trimmed and self._is_public_sentence_ready(trimmed):
                return trimmed
        return ""

    def _article_difference_line(self, *, source_pack: SourcePack) -> str:
        if not source_pack.disagreements:
            return ""
        return source_pack.disagreements[0]

    def _article_evidence_line(self, *, source_pack: SourcePack, mode: str, title: str) -> str:
        evidence = self._article_best_evidence(source_pack=source_pack, title=title)
        if not evidence:
            return ""
        if mode == "quote_led":
            return self._article_supporting_detail(source_pack=source_pack) or evidence
        if mode == "regulation_impact":
            return f"Эта деталь сразу переводит новость в операционный контур: {evidence[0].lower() + evidence[1:] if len(evidence) > 1 else evidence.lower()}."
        if mode == "investment_signal":
            return f"Для рынка важна именно эта конкретика: {evidence[0].lower() + evidence[1:] if len(evidence) > 1 else evidence.lower()}."
        return evidence

    def _article_best_evidence(self, *, source_pack: SourcePack, title: str) -> str:
        for sentence in [*source_pack.facts, *source_pack.context]:
            trimmed = self._trim_title_overlap(sentence, title=title)
            if trimmed and self._is_public_sentence_ready(trimmed):
                return trimmed
        if source_pack.numbers:
            values = ", ".join(self._normalize_number_token(value) for value in source_pack.numbers[:2])
            return f"В новости сразу появились конкретные ориентиры: {values}"
        return ""

    def _article_supporting_detail(self, *, source_pack: SourcePack) -> str:
        for sentence in [*source_pack.context, *source_pack.facts]:
            if not self._is_public_sentence_ready(sentence):
                continue
            if any(token in sentence.lower() for token in ("контрол", "стоим", "цена", "migration", "срок", "deploy", "дистриб", "compliance", "закуп", "security", "доступ", "инфраструкт")):
                return sentence.rstrip(".!?")
        if source_pack.numbers:
            return f"В новости сразу обозначены параметры {', '.join(self._normalize_number_token(value) for value in source_pack.numbers[:2])}"
        return ""

    def _article_market_lede(self, *, source_pack: SourcePack, title: str) -> str:
        lead = self._article_lead_fact(source_pack=source_pack, title=title, section=None)
        consequence = self._specific_market_consequence(source_pack=source_pack)
        if consequence:
            return f"{lead}, и {consequence}"
        return lead

    def _article_product_lede(self, *, source_pack: SourcePack, title: str) -> str:
        lead = self._article_lead_fact(source_pack=source_pack, title=title, section=None)
        detail = self._article_supporting_detail(source_pack=source_pack)
        if detail and self._sentence_signature(detail) != self._sentence_signature(lead):
            return f"{lead}. {detail}"
        return lead

    def _article_investment_lede(self, *, source_pack: SourcePack, title: str) -> str:
        lead = self._article_lead_fact(source_pack=source_pack, title=title, section=None)
        if "$" in lead:
            return lead
        if source_pack.numbers:
            amount = self._normalize_number_token(source_pack.numbers[0])
            return f"{lead}, а сумма {amount} задает новый ориентир для инвесторов и конкурентов"
        consequence = self._specific_market_consequence(source_pack=source_pack)
        if consequence:
            return f"{lead}, и {consequence}"
        return lead

    def _article_regulation_lede(self, *, source_pack: SourcePack, title: str) -> str:
        lead = self._article_lead_fact(source_pack=source_pack, title=title, section=None)
        subject = self._article_subject(source_pack=source_pack, title=title) or "компаниям"
        if "придется" in lead.lower():
            return lead
        return f"{lead}, и {subject.lower()} придется закладывать новые требования в продукт и документы"

    def _article_quote_support(self, *, source_pack: SourcePack) -> str:
        if not source_pack.quotes:
            return ""
        quote = self._normalize(source_pack.quotes[0]).strip(" .")
        if self._quote_is_publishable(quote):
            return f"В одном из материалов это сформулировано коротко: «{quote}»"
        return self._paraphrase_quote(quote).rstrip(".")

    def _quote_is_publishable(self, quote: str) -> bool:
        if not quote:
            return False
        if len(quote.split()) > 12:
            return False
        inspection = self.inspect_text(quote)
        return inspection.has_cyrillic and inspection.english_leakage_ratio <= 0.15

    def _paraphrase_quote(self, quote: str) -> str:
        rewritten = self._de_aiify_text(self._rewrite_common_english(quote)).strip(" .")
        if not rewritten:
            return ""
        inspection = self.inspect_text(rewritten)
        if inspection.has_cyrillic and inspection.english_leakage_ratio <= 0.15:
            return f"По сути, источник описывает сдвиг так: {rewritten[0].lower() + rewritten[1:] if len(rewritten) > 1 else rewritten.lower()}."
        return "По сути, источник говорит о переходе от демонстраций к более жестким требованиям по управлению, качеству внедрения и экономике продукта."

    def _specific_market_consequence(self, *, source_pack: SourcePack) -> str:
        text = " ".join([*source_pack.facts, *source_pack.context]).lower()
        if any(token in text for token in ("price", "цена", "pricing", "стоим")):
            return "это меняет переговоры о цене и условиях корпоративных контрактов"
        if any(token in text for token in ("procurement", "закуп", "buyer", "покупател")):
            return "это меняет требования покупателей к закупке и запуску"
        if any(token in text for token in ("migration", "migrations", "переход")):
            return "это ускоряет переход клиентов от более слабых поставщиков"
        if any(token in text for token in ("cloud", "gpu", "compute", "инфраструкт")):
            return "это обостряет спор за вычисления, дистрибуцию и инфраструктурный контроль"
        if any(token in text for token in ("compliance", "регулир", "требован")):
            return "это заставляет поставщиков быстрее перестраивать комплаенс и продуктовый контур"
        return ""

    def _normalize_number_token(self, value: str) -> str:
        normalized = self._de_aiify_text(self._rewrite_common_english(value)).strip(" .")
        normalized = re.sub(r"\b([0-9]+(?:[.,][0-9]+)?)\s+million\b", r"$\1 млн", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\b([0-9]+(?:[.,][0-9]+)?)\s+billion\b", r"$\1 млрд", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\b([0-9]+)\s+percent\b", r"\1%", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\bq([1-4])\s+(20[0-9]{2})\b", self._replace_quarter, normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\b([0-9]+)\s+day\b", r"\1 дней", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\b([0-9]+)\s+days\b", r"\1 дней", normalized, flags=re.IGNORECASE)
        return normalized

    def _expand_title_lede(self, *, title_text: str, source_pack: SourcePack, section: str | None) -> str:
        lowered = title_text.lower()
        consequence = self._specific_market_consequence(source_pack=source_pack)
        if any(token in lowered for token in ("вводит", "требован", "правил", "прозрачност")):
            return f"{title_text}, и поставщикам придется пересобрать продуктовые требования, документы и сроки запуска"
        if any(token in lowered for token in ("привлекает", "финансирован", "раунд")) and source_pack.numbers:
            amount = self._normalize_number_token(source_pack.numbers[0])
            return f"{title_text}, а сумма {amount} задает новый ориентир для инвесторов и конкурентов"
        if any(token in lowered for token in ("выпускает", "запускает", "представляет", "обновляет", "добавляет")):
            detail = self._article_supporting_detail(source_pack=source_pack)
            if detail:
                return f"{title_text}, {detail[0].lower() + detail[1:] if len(detail) > 1 else detail.lower()}"
            if consequence:
                return f"{title_text}, и {consequence}"
        if consequence:
            return f"{title_text}, и {consequence}"
        if (section or "").lower() == "coding":
            return f"{title_text}, и командам придется пересматривать стек, стоимость интеграции и скорость запуска"
        return title_text

    def _replace_quarter(self, match: re.Match[str]) -> str:
        mapping = {
            "1": "первый квартал",
            "2": "второй квартал",
            "3": "третий квартал",
            "4": "четвертый квартал",
        }
        return f"{mapping.get(match.group(1), 'квартал')} {match.group(2)} года"

    def _combine_article_sentences(self, *sentences: str) -> str:
        parts = [self._normalize(sentence).rstrip(".!?") for sentence in sentences if self._normalize(sentence)]
        if not parts:
            return ""
        return " ".join(f"{part}." for part in parts)

    def _article_subject(self, *, source_pack: SourcePack, title: str) -> str:
        for entity in source_pack.entities:
            if entity in {
                "Главные события",
                "Новости ИИ",
                "Инструменты",
                "Инвестиции",
                "Альфа",
                "ИИ в России",
                "Newsroom",
                "Commission",
                "Statement",
                "Analysis",
                "Regional",
                "Partner",
            }:
                continue
            return entity
        tokens = [token for token in self.public_title(title, fallback=title).split() if token]
        return tokens[0] if tokens else ""

    def _article_focus(self, *, source_pack: SourcePack) -> str:
        preferred = [entity for entity in source_pack.entities if entity not in {"OpenAI", "Anthropic", "Meta", "Google", "NVIDIA"}]
        if preferred:
            return preferred[0]
        if "infra" in source_pack.signals:
            return "инфраструктурный стек"
        if "product" in source_pack.signals:
            return "новый продукт"
        return "этот шаг"

    def _is_public_sentence_ready(self, sentence: str) -> bool:
        inspection = self.inspect_text(sentence)
        if not inspection.has_cyrillic:
            return False
        if _ENGLISH_GLUE_RE.search(sentence):
            return False
        if inspection.english_token_count > max(len(inspection.preserved_terms) + 1, 2):
            return False
        return inspection.english_leakage_ratio <= 0.2

    def _extract_source_sentences(self, value: str) -> list[str]:
        cleaned = self._de_aiify_text(self._rewrite_common_english(self._strip_internal_phrases(value)))
        sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(self._normalize(cleaned)) if part.strip()]
        result: list[str] = []
        for sentence in sentences:
            if len(sentence.split()) < 5:
                continue
            lowered = sentence.lower()
            if any(token in lowered for token in ("subscribe", "cookie", "newsletter", "читать далее")):
                continue
            result.append(sentence.rstrip(".!?"))
        return result

    def _extract_context_sentences(self, value: str) -> list[str]:
        context_markers = (
            "на фоне",
            "после",
            "при этом",
            "параллельно",
            "на рынке",
            "для компаний",
            "для рынка",
            "это важно",
            "because",
            "amid",
            "following",
            "while",
        )
        sentences = self._extract_source_sentences(value)
        selected = [sentence for sentence in sentences if any(marker in sentence.lower() for marker in context_markers)]
        if selected:
            return selected
        return sentences[1:4]

    def _extract_detail_sentences(self, value: str) -> list[str]:
        markers = (
            "контрол",
            "цена",
            "стоим",
            "budget",
            "procurement",
            "закуп",
            "cloud",
            "gpu",
            "compute",
            "инфраструкт",
            "deployment",
            "migration",
            "security",
            "compliance",
            "reporting",
            "документац",
            "timeline",
            "target",
            "partner",
            "valuation",
        )
        sentences = self._extract_source_sentences(value)
        return [sentence for sentence in sentences if any(marker in sentence.lower() for marker in markers)]

    def _extract_source_differences(self, document: dict[str, object]) -> list[str]:
        text = self._normalize(str(document.get("text") or ""))
        sentences = self._extract_source_sentences(text)
        source_role = str(document.get("role") or "")
        differences: list[str] = []
        for sentence in sentences:
            lowered = sentence.lower()
            if source_role in {"supporting", "reaction"} and any(
                token in lowered for token in ("analyst", "coverage", "partner", "investor", "по словам", "said", "noted", "described")
            ):
                differences.append(sentence.rstrip(".!?"))
        return differences[:2]

    def _classify_context_kind(self, sentence: str) -> str:
        lowered = sentence.lower()
        if any(token in lowered for token in ("после", "на фоне", "following", "amid")):
            return "context_before"
        if any(token in lowered for token in ("сейчас", "теперь", "now", "currently")):
            return "context_now"
        return "context_now"

    def _classify_detail_kind(self, sentence: str) -> str:
        lowered = sentence.lower()
        if any(token in lowered for token in ("закон", "регулир", "compliance", "reporting", "документац", "transparency")):
            return "regulation_signal"
        if any(token in lowered for token in ("cloud", "gpu", "compute", "инфраструкт", "deployment", "migration")):
            return "infrastructure_signal"
        if any(token in lowered for token in ("price", "цена", "contract", "закуп", "buyer", "партнер", "vendor", "competition", "конкур")):
            return "competitive_signal"
        if _NUMBER_RE.search(sentence):
            return "number"
        return "detail"

    def _extract_document_quotes(self, document: dict[str, object]) -> list[str]:
        text = self._normalize(str(document.get("text") or ""))
        quotes = [self._normalize(match) for match in _QUOTE_RE.findall(text)]
        if quotes:
            return [quote for quote in quotes if len(quote.split()) >= 4]
        lines = self._extract_source_sentences(text)
        return [line for line in lines if any(token in line.lower() for token in ("по словам", "заявил", "заявила", "отметил", "считает"))][:2]

    def _extract_document_numbers(self, document: dict[str, object]) -> list[str]:
        text = self._normalize(" ".join([str(document.get("title") or ""), str(document.get("text") or "")]))
        values = [self._normalize(match) for match in _NUMBER_RE.findall(text)]
        cleaned = []
        for value in values:
            lowered = value.lower()
            if not value or value in {"1", "2", "3", "4", "5", "6", "7", "8", "9"}:
                continue
            if re.search(r"[a-zа-яё]-\d+$", text.lower()):
                pass
            if lowered in {"2024", "2025", "2026"}:
                continue
            cleaned.append(value)
        return cleaned[:4]

    def _extract_entities_from_text(self, value: str) -> list[str]:
        entities: list[str] = []
        normalized = self._normalize(value)
        for term in self.preserve_terms:
            if term.lower() in normalized.lower():
                entities.append(term)
        for match in re.findall(r"\b[А-ЯA-Z][А-Яа-яA-Za-z0-9.+-]{1,}\b", normalized):
            if len(match) > 2:
                entities.append(match)
        return entities

    def _extract_document_entities(self, document: dict[str, object]) -> list[str]:
        entities: list[str] = []
        raw_entities = document.get("entities")
        if isinstance(raw_entities, dict):
            for values in raw_entities.values():
                if isinstance(values, list):
                    for value in values:
                        if isinstance(value, str):
                            entities.append(value)
        entities.extend(self._extract_entities_from_text(str(document.get("title") or "")))
        entities.extend(self._extract_entities_from_text(str(document.get("source_title") or "")))
        return entities

    def _dedupe_preserve_order(self, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            cleaned = self._normalize(value).strip(" .,:;")
            if not cleaned:
                continue
            signature = cleaned.lower()
            if signature in seen:
                continue
            seen.add(signature)
            result.append(cleaned)
        return result

    def _dedupe_evidence_units(self, values: list[EvidenceUnit]) -> list[EvidenceUnit]:
        result: list[EvidenceUnit] = []
        seen: set[tuple[str, str]] = set()
        for value in values:
            text = self._normalize(value.text).strip(" .,:;")
            if not text:
                continue
            signature = (value.kind, text.lower())
            if signature in seen:
                continue
            seen.add(signature)
            result.append(EvidenceUnit(kind=value.kind, text=text, source_role=value.source_role, source_title=value.source_title))
        return result

    def _consequence_from_section(self, section: str | None) -> str:
        key = (section or "").lower()
        if key == "coding":
            return "Для команд это быстро превращается в вопрос скорости разработки, а для поставщиков инструментов — в вопрос удержания пользователей."
        if key == "investments":
            return "Для рынка это становится сигналом о том, куда дальше пойдут капитал, оценки и новые альянсы."
        if key == "russia":
            return "Для локального рынка это меняет бюджетные решения, инфраструктурные приоритеты и требования к поставщикам."
        return "Для бизнеса это меняет решения о платформе, бюджете и скорости внедрения AI-функций."

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
