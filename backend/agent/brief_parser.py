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
    # Task/meta words — NOT substantive research terms
    "conduct", "perform", "execute", "carry", "undertake", "run",
    "find", "identify", "search", "look", "examine", "investigate",
    "assess", "evaluate", "determine", "analyse", "analyze",
    "systematic", "comprehensive", "thorough", "complete", "full",
    "focus", "exclude", "include", "review", "studies", "study",
    "literature", "research", "papers", "paper", "sources", "source",
    "based", "using", "only", "also", "such", "both", "whether", "well",
    "relevant", "related", "following", "including", "regarding",
    "please", "want", "need", "looking",
}

_LLM_PROMPT = """\
You are a research librarian. Parse the research brief below and return a JSON object.

IMPORTANT:
- The brief may start with task instructions like "perform a systematic search of", \
"conduct a literature review on", "find papers about" — IGNORE these instructions and \
extract only the actual research subject.
- Keywords must be SUBSTANTIVE scientific terms only — topics, methods, organisms, \
populations, settings, outcomes. Never include task verbs like "conduct", "systematic", \
"search", "review", "find", "identify", "analyse".
- search_queries are ready-to-use Boolean database queries. Use AND/OR to express \
required combinations precisely. Prefer phrase-quoted multi-word terms.

Return ONLY this JSON (no other text):
{{
  "topic": "<the actual research subject in one sentence, no task instructions>",
  "keywords": ["<5-12 substantive search terms — no meta-words>"],
  "search_queries": [
    "<primary Boolean query — most specific, e.g. \\"wastewater-based epidemiology\\" AND norovirus>",
    "<secondary query — synonyms/related terms, e.g. WBE AND (norovirus OR \\"norovirus surveillance\\")>",
    "<tertiary query — broader but still targeted, optional>"
  ],
  "inclusion_criteria": ["<what MUST be present for a result to be relevant>"],
  "exclusion_criteria": ["<what disqualifies a result>"],
  "date_range": [start_year, end_year] or null,
  "source_types": ["academic" | "grey" | "both"],
  "max_results": <integer, default 500>
}}

Research brief:
{text}"""


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
        max_tokens=1200,
    )
    content = response.choices[0].message.content
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
        search_queries=_clean_queries(data.get("search_queries", [])),
        inclusion_criteria=data.get("inclusion_criteria", []),
        exclusion_criteria=data.get("exclusion_criteria", []),
        date_range=date_range,
        source_types=data.get("source_types", ["both"]),
        max_results=data.get("max_results", 500),
        raw_text=text,
    )


def _clean_queries(queries: list) -> list[str]:
    """Validate and clean LLM-generated search queries."""
    result = []
    for q in queries:
        if isinstance(q, str) and q.strip():
            # Reject queries that are just meta-descriptions
            lower = q.lower()
            if any(p in lower for p in ("focus on", "include papers", "this query")):
                continue
            result.append(q.strip())
    return result[:4]


def _parse_heuristic(text: str) -> StructuredBrief:
    # Strip leading task instructions before extracting topic
    task_prefix_re = re.compile(
        r"^(?:please\s+)?(?:conduct|perform|execute|carry\s+out|do|run|undertake)\s+"
        r"(?:a\s+)?(?:systematic\s+|comprehensive\s+|thorough\s+)?(?:literature\s+)?"
        r"(?:search|review|analysis|survey)\s+(?:of|on|for|about|into)\s*",
        re.IGNORECASE,
    )
    cleaned_text = task_prefix_re.sub("", text.strip())

    # Topic: first sentence of cleaned text
    first_sentence = re.split(r"(?<=[.!?])\s", cleaned_text)[0]
    topic = first_sentence.strip()[:200]

    keywords: list[str] = []

    # Quoted phrases (highest quality)
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

    # Fallback: significant words from cleaned text
    if not keywords:
        words = re.findall(r"\b[a-zA-Z]{4,}\b", cleaned_text)
        keywords = [w for w in words if w.lower() not in _STOPWORDS][:10]

    # Deduplicate
    seen: set[str] = set()
    unique_kw: list[str] = []
    for k in keywords:
        k_lower = k.lower()
        if k_lower not in seen:
            seen.add(k_lower)
            unique_kw.append(k)
    keywords = unique_kw[:20]

    # Build heuristic search queries (AND-based for precision)
    search_queries = _build_heuristic_queries(keywords, cleaned_text)

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
        search_queries=search_queries,
        inclusion_criteria=inclusion,
        exclusion_criteria=exclusion,
        date_range=date_range,
        source_types=source_types,
        max_results=500,
        raw_text=text,
    )


def _build_heuristic_queries(keywords: list[str], cleaned_text: str) -> list[str]:
    """Build 1-2 AND-based search queries from keywords."""
    if not keywords:
        return []

    # Multi-word quoted phrases are highest priority
    phrases = [k for k in keywords if " " in k]
    single_words = [k for k in keywords if " " not in k]

    queries: list[str] = []

    if phrases and single_words:
        # Primary: quoted phrase AND top single term
        primary_parts = [f'"{phrases[0]}"'] + single_words[:2]
        queries.append(" AND ".join(primary_parts))
        # Secondary: remaining single words
        if len(single_words) > 2:
            secondary_parts = single_words[:4]
            queries.append(" AND ".join(secondary_parts))
    elif phrases:
        queries.append(" AND ".join(f'"{p}"' for p in phrases[:3]))
    else:
        # AND the top keywords (precision over recall)
        core = single_words[:4]
        queries.append(" AND ".join(core))
        if len(single_words) > 4:
            queries.append(" ".join(single_words[:6]))

    return queries
