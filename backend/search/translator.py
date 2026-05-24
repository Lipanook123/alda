"""Multilingual query keyword translation using the configured LLM."""
from __future__ import annotations

import json
import logging
import re

from backend import config as _config

log = logging.getLogger(__name__)

# Languages to query in addition to English, keyed by source name.
TARGET_LANGUAGES: dict[str, list[str]] = {
    "scielo":       ["Spanish", "Portuguese"],
    "jstage":       ["Japanese"],
    "cyberleninka": ["Russian"],
    "base":         ["Chinese (Simplified)", "Russian", "Korean", "Arabic"],
    "core":         ["Chinese (Simplified)", "French", "German"],
    "doaj":         ["Chinese (Simplified)", "Spanish", "Portuguese", "French", "Arabic"],
    "who_iris":     ["Arabic", "French", "Spanish", "Russian", "Chinese (Simplified)"],
}

_TRANSLATE_PROMPT = """\
Translate the following English search keywords into {language}.
Return ONLY a JSON array of translated strings, one per keyword, in the same order.
If a term has no direct translation or is a proper noun, keep it as-is.

Keywords: {keywords}

Return only the JSON array, no explanation."""


def translate_keywords(keywords: list[str], language: str) -> list[str]:
    """Translate a keyword list to the target language via LLM.

    Returns the original list unchanged on any failure or if LLM is not configured.
    """
    if not keywords or not _config.is_llm_configured():
        return keywords
    try:
        import litellm  # noqa: PLC0415

        response = litellm.completion(
            model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
            messages=[{
                "role": "user",
                "content": _TRANSLATE_PROMPT.format(
                    language=language,
                    keywords=json.dumps(keywords, ensure_ascii=False),
                ),
            }],
            api_key=_config.get_llm_api_key() or None,
            max_tokens=300,
        )
        content = response.choices[0].message.content
        match = re.search(r"\[.*?\]", content, re.DOTALL)
        if match:
            translated = json.loads(match.group())
            if isinstance(translated, list) and len(translated) == len(keywords):
                return [str(t) for t in translated]
    except Exception as e:
        log.debug("Keyword translation to %s failed: %s", language, e)
    return keywords


def build_translated_query(keywords: list[str], language: str, max_terms: int = 6) -> str | None:
    """Translate keywords and build a query string.

    Returns None if translation produces no change (avoids duplicate English queries).
    """
    subset = keywords[:max_terms]
    translated = translate_keywords(subset, language)
    if translated == subset:
        return None
    return " ".join(translated[:max_terms])
