"""Language detection and English translation for non-English source content."""
from __future__ import annotations

import logging

from backend import config as _config

log = logging.getLogger(__name__)

# Unicode block ranges for major non-Latin scripts.
# Format: language_name -> (block_start, block_end)
_SCRIPT_RANGES: dict[str, tuple[int, int]] = {
    "Russian":  (0x0400, 0x04FF),   # Cyrillic
    "Arabic":   (0x0600, 0x06FF),   # Arabic
    "Chinese":  (0x4E00, 0x9FFF),   # CJK Unified Ideographs (basic block)
    "Japanese": (0x3040, 0x30FF),   # Hiragana + Katakana
    "Korean":   (0xAC00, 0xD7AF),   # Hangul Syllables
}

# Fraction of non-whitespace characters that must fall in a block to trigger detection.
_DETECT_THRESHOLD = 0.15


def detect_language(text: str) -> str | None:
    """Return a language name if text is predominantly in a non-Latin script, else None."""
    if not text:
        return None
    chars = [c for c in text if not c.isspace()]
    total = len(chars)
    if total == 0:
        return None
    for lang, (lo, hi) in _SCRIPT_RANGES.items():
        count = sum(1 for c in chars if lo <= ord(c) <= hi)
        if count / total >= _DETECT_THRESHOLD:
            return lang
    return None


_TRANSLATE_PROMPT = """\
Translate the following {source_language} text to English.
Return ONLY the translated text, with no explanation and no quotation marks.

Text: {text}"""


def translate_to_english(text: str, source_language: str | None = None) -> str | None:
    """Translate text to English using the configured LLM.

    Returns None if LLM is not configured, text is empty, or translation fails.
    Caps input at 800 characters to limit token cost.
    """
    if not text or not _config.is_llm_configured():
        return None
    try:
        import litellm  # noqa: PLC0415

        response = litellm.completion(
            model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
            messages=[{
                "role": "user",
                "content": _TRANSLATE_PROMPT.format(
                    source_language=source_language or "the source language",
                    text=text[:800],
                ),
            }],
            api_key=_config.get_llm_api_key() or None,
            max_tokens=400,
        )
        result = response.choices[0].message.content.strip()
        return result or None
    except Exception as e:
        log.debug("Translation from %s failed: %s", source_language, e)
        return None
