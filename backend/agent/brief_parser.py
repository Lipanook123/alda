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
You are an expert research librarian. Your job is to build a comprehensive literature \
search strategy from the query below.

Do NOT just extract words from the query. You must EXPAND the search strategy using \
domain knowledge, exactly as a specialist librarian would when building a PubMed or \
Scopus search.

Rules for keywords (8-20 terms):
- Include ALL core concepts, synonyms, abbreviations, and related field-specific terminology
- Expand abbreviations in both directions:
    "WBE" → add "wastewater-based epidemiology"; "COVID-19" → add "SARS-CoV-2", "coronavirus"
    "wastewater epidemiology" → add "WBE", "WBE surveillance"
- Add synonyms the user did NOT write:
    "wastewater" → also "sewage", "effluent"; "norovirus" → also "calicivirus", "NoV"
    "heart attack" → also "myocardial infarction", "MI", "acute coronary syndrome"
- Add field-specific terminology experts would search for:
    WBE context → "environmental surveillance", "wastewater monitoring", "sewage monitoring"
    drug resistance context → "antimicrobial resistance", "AMR", "antibiotic resistance genes"

Rules for search_queries (2-4 Boolean strings):
- Query 1: Most specific — phrase-quoted core concept AND primary target
- Query 2: Abbreviation + synonym expansion with OR groups
- Query 3 (optional): Broader catch-all using related terminology
- Syntax: AND between required concept clusters; OR within synonym groups; \
  "quotes" for phrases
- Example output for "wastewater epidemiology for norovirus":
  1. "wastewater-based epidemiology" AND norovirus
  2. WBE AND (norovirus OR calicivirus OR NoV)
  3. (wastewater OR sewage) AND (epidemiology OR surveillance OR monitoring) AND (norovirus OR "gastric virus")

Rules for exclusion_criteria — INFER implicit exclusions from topic focus:
- If topic is "WBE for norovirus": infer exclusions like "norovirus studies without \
  wastewater component", "WBE studies for other pathogens only"
- If topic is narrowly defined, infer what nearby-but-off-topic papers should be excluded
- Also include any explicit exclusions stated in the query

Strip task instructions from topic: ignore phrases like "conduct a review of", \
"perform a systematic search on", "find papers about", "identify studies of" — \
extract only the actual research subject.

Return ONLY this JSON (no other text):
{{
  "topic": "<actual research subject — no task instructions>",
  "keywords": ["<8-20 terms: core concepts + synonyms + abbreviations + related terms>"],
  "search_queries": ["<2-4 Boolean query strings>"],
  "inclusion_criteria": ["<must-haves — explicit or inferred from topic specificity>"],
  "exclusion_criteria": ["<disqualifiers — explicit or inferred from topic focus>"],
  "date_range": [start_year, end_year] or null,
  "source_types": ["academic" | "grey" | "both"],
  "max_results": <integer, default 500>
}}

Research query:
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
        max_tokens=1400,
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
        parsed_with_llm=True,
        raw_text=text,
    )


def _clean_queries(queries: list) -> list[str]:
    """Validate and clean LLM-generated search queries."""
    result = []
    for q in queries:
        if isinstance(q, str) and q.strip():
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

    # No search_queries — heuristic has no semantic knowledge to generate reliable queries.
    # _build_query() in the search layer falls back to AND-joining filtered keywords.
    return StructuredBrief(
        topic=topic,
        keywords=keywords,
        search_queries=[],
        inclusion_criteria=inclusion,
        exclusion_criteria=exclusion,
        date_range=date_range,
        source_types=source_types,
        max_results=500,
        parsed_with_llm=False,
        raw_text=text,
    )
