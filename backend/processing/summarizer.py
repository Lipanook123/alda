"""LLM-based relevance scoring and summarization (BYOK, gracefully skipped if not configured)."""
from __future__ import annotations

import json
import logging
import re

from backend.api.models import SourceIn, StructuredBrief
from backend import config as _config

log = logging.getLogger(__name__)

_BATCH_SIZE = 5

_RELEVANCE_PROMPT = """\
Research topic: {topic}

Rate the relevance of each source below to this research topic on a scale of 0.0 to 1.0.
Return ONLY a JSON array: [{{"id": "<id>", "score": <float>, "reasoning": "<one sentence>"}}]

Sources:
{sources}"""


def score_relevance(
    sources: list[SourceIn], brief: StructuredBrief
) -> tuple[list[SourceIn], int]:
    """Score relevance for each source. Returns (updated_sources, total_tokens_used)."""
    if not _config.is_llm_configured():
        return sources, 0

    updated: list[SourceIn] = []
    total_tokens = 0
    for i in range(0, len(sources), _BATCH_SIZE):
        batch = sources[i : i + _BATCH_SIZE]
        try:
            batch, batch_tokens = _score_batch(batch, brief)
            total_tokens += batch_tokens
        except Exception as e:
            log.warning("Relevance scoring failed for batch: %s", e)
        updated.extend(batch)
    return updated, total_tokens


def _score_batch(
    batch: list[SourceIn], brief: StructuredBrief
) -> tuple[list[SourceIn], int]:
    import litellm  # noqa: PLC0415

    src_texts = "\n\n".join(
        f"ID: {src.id or i}\nTitle: {src.title}\nAbstract: {(src.abstract or '')[:300]}"
        for i, src in enumerate(batch)
    )

    response = litellm.completion(
        model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
        messages=[
            {
                "role": "user",
                "content": _RELEVANCE_PROMPT.format(topic=brief.topic, sources=src_texts),
            }
        ],
        api_key=_config.get_llm_api_key() or None,
        max_tokens=500,
    )
    tokens_used = 0
    if hasattr(response, "usage") and response.usage:
        tokens_used = getattr(response.usage, "total_tokens", 0) or 0

    content = response.choices[0].message.content
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return batch, tokens_used

    scores: list[dict] = json.loads(match.group())
    id_to_score = {str(item["id"]): float(item["score"]) for item in scores if "id" in item and "score" in item}

    result: list[SourceIn] = []
    for i, src in enumerate(batch):
        key = src.id or str(i)
        score = id_to_score.get(key)
        if score is not None:
            src = src.model_copy(update={"relevance": max(0.0, min(1.0, score))})
        result.append(src)
    return result, tokens_used


_SUMMARY_PROMPT = """\
Research topic: {topic}

Write a 2-3 sentence summary of how the following source relates to the research topic.
Be specific about what findings or information are relevant.

Title: {title}
Abstract: {abstract}

Summary:"""


def generate_summary(src: SourceIn, brief: StructuredBrief) -> str | None:
    if not _config.is_llm_configured():
        return None
    try:
        import litellm  # noqa: PLC0415

        response = litellm.completion(
            model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
            messages=[
                {
                    "role": "user",
                    "content": _SUMMARY_PROMPT.format(
                        topic=brief.topic,
                        title=src.title,
                        abstract=(src.abstract or "")[:500],
                    ),
                }
            ],
            api_key=_config.get_llm_api_key() or None,
            max_tokens=200,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        log.warning("Summary generation failed: %s", e)
        return None
