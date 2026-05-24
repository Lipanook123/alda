import re
from collections import Counter

from backend.api.models import StructuredBrief
from backend import config as _config
from backend.config import settings

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "this", "that", "these", "those", "its",
    "it", "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "also", "which", "who", "their", "they", "we", "our", "study",
    "research", "paper", "article", "journal", "results", "findings", "show",
    "shown", "shows", "however", "although", "while", "using", "used", "new",
    "based", "found", "data", "analysis", "method", "methods", "approach",
}

_EXPAND_PROMPT = """\
You are helping expand a literature search. The original research topic is:
{topic}

Original keywords: {keywords}

Based on the following sample of abstracts from sources found so far, suggest 8 NEW search terms
or synonyms not already in the keyword list. Focus on terminology, concepts, or related areas
that would help find additional relevant sources.

Abstracts sample:
{abstracts}

Return ONLY a JSON array of strings (the new search terms), no explanation."""


def expand_query(brief: StructuredBrief, abstracts: list[str]) -> list[str]:
    """Return additional search terms for the next iteration."""
    if _config.is_llm_configured() and abstracts:
        try:
            return _expand_with_llm(brief, abstracts)
        except Exception:
            pass
    return _expand_heuristic(brief, abstracts)


def _expand_with_llm(brief: StructuredBrief, abstracts: list[str]) -> list[str]:
    import json
    import litellm  # noqa: PLC0415

    sample = "\n---\n".join(abstracts[:10])[:3000]
    response = litellm.completion(
        model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
        messages=[
            {
                "role": "user",
                "content": _EXPAND_PROMPT.format(
                    topic=brief.topic,
                    keywords=", ".join(brief.keywords),
                    abstracts=sample,
                ),
            }
        ],
        api_key=_config.get_llm_api_key() or None,
        max_tokens=300,
    )
    content = response.choices[0].message.content
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return []
    terms = json.loads(match.group())
    existing = {k.lower() for k in brief.keywords}
    return [t for t in terms if isinstance(t, str) and t.lower() not in existing][:8]


def _expand_heuristic(brief: StructuredBrief, abstracts: list[str]) -> list[str]:
    """Extract frequent bigrams from abstracts not already in keywords."""
    existing = {k.lower() for k in brief.keywords}
    all_text = " ".join(abstracts)
    words = [w.lower() for w in re.findall(r"\b[a-zA-Z]{3,}\b", all_text) if w.lower() not in _STOPWORDS]
    bigrams = Counter(
        f"{words[i]} {words[i+1]}"
        for i in range(len(words) - 1)
        if words[i] not in _STOPWORDS and words[i + 1] not in _STOPWORDS
    )
    new_terms: list[str] = []
    for bigram, _ in bigrams.most_common(20):
        if bigram not in existing:
            new_terms.append(bigram)
        if len(new_terms) >= 5:
            break
    return new_terms


def check_saturation(iteration_new_counts: list[int], total: int) -> bool:
    """Return True if the search has saturated (diminishing returns)."""
    if total == 0:
        return False
    if len(iteration_new_counts) < settings.saturation_min_iterations:
        return False
    recent = iteration_new_counts[-settings.saturation_min_iterations:]
    return all(c / max(total, 1) < settings.saturation_threshold for c in recent)
