from __future__ import annotations

import re
from html import unescape

URL_RE = re.compile(r"https?://[^\s<>\"]+")
HTML_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")

KNOWN_ENTITIES: dict[str, tuple[str, ...]] = {
    "companies": (
        "OpenAI",
        "Anthropic",
        "Mistral",
        "Hugging Face",
        "GitHub",
        "Microsoft",
        "Google",
        "Meta",
        "Amazon",
        "NVIDIA",
        "Yandex",
        "TechCrunch",
        "DeepLearning.AI",
    ),
    "models": (
        "GPT-5",
        "GPT-4",
        "Claude",
        "Gemini",
        "Llama",
        "Mistral Large",
        "Copilot",
        "Codex",
    ),
    "products": (
        "ChatGPT",
        "Copilot",
        "API",
        "CLI",
        "IDE",
    ),
    "people": (
        "Sam Altman",
        "Dario Amodei",
        "Elon Musk",
        "Mark Zuckerberg",
    ),
    "organizations": (
        "OpenAI",
        "Anthropic",
        "GitHub",
        "DeepLearning.AI",
        "Yandex Cloud",
    ),
}


def clean_text(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = HTML_TAG_RE.sub(" ", value)
    cleaned = unescape(cleaned)
    cleaned = WHITESPACE_RE.sub(" ", cleaned).strip()
    return cleaned or None


def extract_links(*values: str | None) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value:
            continue
        for match in URL_RE.findall(value):
            normalized = match.rstrip(".,)")
            if normalized not in seen:
                seen.add(normalized)
                links.append(normalized)
    return links


def detect_language(text: str | None, fallback: str | None) -> str | None:
    if not text:
        return fallback

    cyrillic_chars = sum(1 for char in text if "\u0400" <= char <= "\u04FF")
    latin_chars = sum(1 for char in text if ("a" <= char.lower() <= "z"))
    if cyrillic_chars > latin_chars and cyrillic_chars > 0:
        return "ru"
    if latin_chars > 0:
        return "en"
    return fallback


def extract_entities(*values: str | None) -> dict[str, list[str]]:
    merged_text = " ".join(filter(None, values))
    lowered_text = merged_text.lower()
    entities: dict[str, list[str]] = {}

    for entity_type, known_values in KNOWN_ENTITIES.items():
        matches = sorted({value for value in known_values if value.lower() in lowered_text})
        entities[entity_type] = matches

    return entities


def entity_count(entities: dict[str, list[str]]) -> int:
    return sum(len(values) for values in entities.values())


def tokenize(value: str | None) -> set[str]:
    if not value:
        return set()
    return {
        token
        for token in re.findall(r"[a-zA-Z0-9_+-]+", value.lower())
        if len(token) > 2
    }
