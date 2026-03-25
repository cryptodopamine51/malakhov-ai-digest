from __future__ import annotations

from scripts.seed_sources import DEFAULT_SEED_CSV_PATH, load_source_seeds


def test_new_seed_csv_supports_website_and_official_blog_rows():
    supported, skipped = load_source_seeds(DEFAULT_SEED_CSV_PATH)

    supported_titles = {row.title for row in supported}
    skipped_titles = {row.title for row in skipped}

    assert "OpenAI News" in supported_titles
    assert "TechCrunch AI" in supported_titles
    assert "GitHub Copilot Changelog" in supported_titles
    assert "Ben's Bites" in supported_titles
    assert not skipped_titles


def test_seed_sanitizes_unknown_section_bias_values():
    supported, _ = load_source_seeds(DEFAULT_SEED_CSV_PATH)
    ben = next(row for row in supported if row.title == "Ben's Bites")
    assert ben.section_bias == "ai_news"
