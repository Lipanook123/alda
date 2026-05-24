import json
import re

from backend.api.models import StructuredBrief
from backend import config as _config

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "through", "during",
    "this", "that", "these", "those", "its", "it", "is", "are", "was",
    "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "will", "would", "could", "should", "may", "might", "shall",
    "can", "need", "dare", "ought", "used", "able",
    # Common brief verbs/nouns that aren't search terms
    "conduct", "focus", "exclude", "include", "review", "studies", "study",
    "literature", "research", "papers", "paper", "sources", "source",
    "based", "using", "only", "also", "such", "both", "whether", "well",
}

_LLM_PROMPT = """\
Parse the following research mission brief and extract structured information.
Return ONLY a JSON object with these fields:
- topic (string): the main research topic/question in one sentence
- keywords (array of strings): 5-15 key search terms and concepts
- inclusion_criteria (array of strings): what should be included (empty if not specified)
- exclusion_criteria (array of strings): what should be excluded (empty if not specified)
- date_range (array of two integers [start_year, end_year] or null): publication date range
- source_types (array): one or more of ["academic", "grey", "both"]
- max_results (integer): suggested maximum results, default 200

Mission brief:
{text}

Return only the JSON object, no explanation."""


def parse(text: str) -> StructuredBrief:
    if _config.is_llm_configured():
        try:
            return _parse_with_llm(text)
        except Exception:
            pass
    return _parse_heuristic(text)


def _parse_with_llm(text: str) -> StructuredBrief:
    import litellm  # noqa: PLC0415

    response = litellm.completion(
        model=f"{_config.get_llm_provider()}/{_config.get_llm_model()}",
        messages=[{"role": "user", "content": _LLM_PROMPT.format(text=text)}],
        api_key=_config.get_llm_api_key() or None,
        max_tokens=1000,
    )
    content = response.choices[0].message.content
    # Extract JSON block
    json_match = re.search(r"\{.*\}", content, re.DOTALL)
    if not json_match:
        raise ValueError("No JSON in LLM response")
    data = json.loads(json_match.group())

    date_range = data.get("date_range")
    if isinstance(date_range, list) and len(date_range) == 2:
        date_range = tuple(date_range)
    else:
        date_range = None

    return StructuredBrief(
        topic=data.get("topic", text[:100]),
        keywords=data.get("keywords", []),
        inclusion_criteria=data.get("inclusion_criteria", []),
        exclusion_criteria=data.get("exclusion_criteria", []),
        date_range=date_range,
        source_types=data.get("source_types", ["both"]),
        max_results=data.get("max_results", 200),
        raw_text=text,
    )


def _parse_heuristic(text: str) -> StructuredBrief:
    # Topic: first sentence
    first_sentence = re.split(r"(?<=[.!?])\s", text.strip())[0]
    topic = first_sentence.strip()[:200]

    keywords: list[str] = []

    # Quoted phrases
    quoted = re.findall(r'"([^"]+)"', text)
    keywords.extend(quoted)

    # Capitalized multi-word phrases (2-3 words)
    cap_phrases = re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b", text)
    for p in cap_phrases:
        if p.lower() not in _STOPWORDS and p not in keywords:
            keywords.append(p)

    # Single capitalized technical-looking words (skip sentence starts)
    lines = text.split("\n")
    for line in lines:
        words = line.split()
        for i, word in enumerate(words):
            clean = re.sub(r"[^a-zA-Z]", "", word)
            if (
                i > 0
                and len(clean) > 4
                and clean[0].isupper()
                and clean.lower() not in _STOPWORDS
                and clean not in keywords
            ):
                keywords.append(clean)

    # Limit and deduplicate
    seen: set[str] = set()
    unique_kw: list[str] = []
    for k in keywords:
        k_lower = k.lower()
        if k_lower not in seen:
            seen.add(k_lower)
            unique_kw.append(k)
    keywords = unique_kw[:20]

    # Fallback: split text into significant words
    if not keywords:
        words = re.findall(r"\b[a-zA-Z]{4,}\b", text)
        keywords = [w for w in words if w.lower() not in _STOPWORDS][:10]

    # Inclusion / exclusion criteria
    inclusion: list[str] = []
    exclusion: list[str] = []
    for sent in re.split(r"[.;]\s*", text):
        s = sent.strip().lower()
        if not s:
            continue
        if any(w in s for w in ("include", "focus on", "limit to", "restrict to", "cover")):
            if len(sent.strip()) > 10:
                inclusion.append(sent.strip())
        elif any(w in s for w in ("exclude", "not include", "omit", "ignore", "except", "avoid")):
            if len(sent.strip()) > 10:
                exclusion.append(sent.strip())

    # Date range
    years = re.findall(r"\b(?:19|20)\d{2}\b", text)
    date_range: tuple[int, int] | None = None
    if len(years) >= 2:
        year_ints = [int(y) for y in years]
        date_range = (min(year_ints), max(year_ints))
    elif len(years) == 1:
        date_range = (int(years[0]), 2025)

    # Source types
    text_lower = text.lower()
    has_grey = any(w in text_lower for w in ("grey", "gray", "policy", "government", "ngo", "report", "guidelines"))
    has_academic = any(w in text_lower for w in ("paper", "journal", "peer-reviewed", "study", "research", "article"))
    if has_grey and not has_academic:
        source_types = ["grey"]
    elif has_academic and not has_grey:
        source_types = ["academic"]
    else:
        source_types = ["both"]

    return StructuredBrief(
        topic=topic,
        keywords=keywords,
        inclusion_criteria=inclusion,
        exclusion_criteria=exclusion,
        date_range=date_range,
        source_types=source_types,
        max_results=200,
        raw_text=text,
    )
