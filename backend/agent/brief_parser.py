import json
import re

from backend.api.models import StructuredBrief
from backend import config as _config


class LLMNotConfiguredError(Exception):
    pass


_LLM_PROMPT = """\
You are an expert research librarian. Your job is to build a comprehensive literature \
search strategy from the query below.

Do NOT just extract words from the query. You must EXPAND the search strategy using \
domain knowledge, exactly as a specialist librarian would when building a PubMed or \
Scopus search.

Rules for keywords (8-20 terms):
- Include ALL core concepts, synonyms, abbreviations, and related field-specific terminology
- Expand abbreviations in both directions:
    "WBE" -> also add "wastewater-based epidemiology"; "COVID-19" -> also add "SARS-CoV-2"
    "wastewater epidemiology" -> also add "WBE", "WBE surveillance"
- Add synonyms the user did NOT write:
    "wastewater" -> also "sewage", "effluent"; "norovirus" -> also "calicivirus", "NoV"
    "heart attack" -> also "myocardial infarction", "MI", "acute coronary syndrome"
- Add field-specific terminology experts would search for:
    WBE context -> "environmental surveillance", "wastewater monitoring", "sewage monitoring"
    drug resistance context -> "antimicrobial resistance", "AMR", "antibiotic resistance genes"

Rules for search_queries (2-4 Boolean strings):
- Query 1: Most specific - phrase-quoted core concept AND primary target
- Query 2: Abbreviation + synonym expansion with OR groups
- Query 3 (optional): Broader catch-all using related terminology
- Syntax: AND between required concept clusters; OR within synonym groups; \
  "quotes" for multi-word phrases
- Example output for "wastewater epidemiology for norovirus":
  1. "wastewater-based epidemiology" AND norovirus
  2. WBE AND (norovirus OR calicivirus OR NoV)
  3. (wastewater OR sewage) AND (epidemiology OR surveillance OR monitoring) AND norovirus

Rules for exclusion_criteria - INFER implicit exclusions from topic focus:
- If topic is "WBE for norovirus": infer exclusions like "norovirus studies without \
  wastewater component", "WBE studies for other pathogens only"
- If topic is narrowly defined, infer what nearby-but-off-topic papers should be excluded
- Also include any explicit exclusions stated in the query

Strip task instructions from topic: ignore phrases like "conduct a review of", \
"perform a systematic search on", "find papers about", "identify studies of" - \
extract only the actual research subject.

Return ONLY this JSON (no other text):
{{
  "topic": "<actual research subject - no task instructions>",
  "keywords": ["<8-20 terms: core concepts + synonyms + abbreviations + related terms>"],
  "search_queries": ["<2-4 Boolean query strings>"],
  "inclusion_criteria": ["<must-haves - explicit or inferred from topic specificity>"],
  "exclusion_criteria": ["<disqualifiers - explicit or inferred from topic focus>"],
  "date_range": [start_year, end_year] or null,
  "source_types": ["academic" or "grey" or "both"],
  "max_results": <integer, default 500>
}}

Research query:
{text}"""


def parse(text: str) -> StructuredBrief:
    if not _config.is_llm_configured():
        raise LLMNotConfiguredError(
            "No AI provider configured. Please set up an AI provider to parse research briefs."
        )
    return _parse_with_llm(text)


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
        raise ValueError("Model returned no JSON. Try rephrasing your query.")
    data = json.loads(json_match.group())

    date_range = data.get("date_range")
    if isinstance(date_range, list) and len(date_range) == 2:
        date_range = tuple(date_range)
    else:
        date_range = None

    source_types = data.get("source_types", ["both"])
    if isinstance(source_types, str):
        source_types = [source_types]

    return StructuredBrief(
        topic=data.get("topic", text[:100]),
        keywords=data.get("keywords", []),
        search_queries=_clean_queries(data.get("search_queries", [])),
        inclusion_criteria=data.get("inclusion_criteria", []),
        exclusion_criteria=data.get("exclusion_criteria", []),
        date_range=date_range,
        source_types=source_types,
        max_results=data.get("max_results", 500),
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
