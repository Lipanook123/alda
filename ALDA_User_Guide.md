# ALDA User Guide

## What is ALDA?

ALDA (Autonomous Literature Discovery Agent) is a free, open-source tool that automates the most time-consuming part of a literature review: finding the sources.

You describe your research question in plain English. ALDA turns that into a search strategy, queries over 16 academic databases and grey literature sources simultaneously, removes duplicates, and hands you a clean, filtered list of results — ready to export.

It is designed for researchers, students, policy analysts, journalists, and anyone else who needs to systematically gather published evidence on a topic without spending days searching databases by hand.

---

## What ALDA Does (and Does Not Do)

**ALDA does:**
- Turn a plain-language research question into structured search queries automatically
- Search academic databases (Semantic Scholar, PubMed, arXiv, CrossRef, OpenAlex, and more) simultaneously
- Search grey literature sources (Google, Bing, DuckDuckGo)
- Remove duplicate results using DOI matching and fuzzy title matching
- Detect and translate non-English titles and abstracts into English
- Optionally score each result for relevance using an AI language model
- Group results into themes
- Export results as CSV or JSON, including PRISMA flow statistics for systematic reviews
- Allow you to upload your own reference lists for deduplication and scoring

**ALDA does not:**
- Read full-text PDFs and extract findings for you (it works with titles and abstracts)
- Make access-controlled articles available to you
- Write your literature review
- Replace critical appraisal of individual studies

---

## The Workflow at a Glance

```
Your question → Parsed brief → Search → Deduplicate → (Score) → Browse & Export
```

There are three main steps you work through in the interface:

1. **Brief** — describe your research question
2. **Search** — run the search and wait for results
3. **Results** — browse, filter, theme, and export

---

## Step-by-Step Walkthrough

### Step 1: Write Your Research Brief

Type your research question into the brief box and click **Parse Brief**.

ALDA sends your question to a language model (if you have one configured), which produces a structured search strategy including:

- A cleaned topic statement
- 8–20 keywords covering synonyms, abbreviations, and related concepts
- 2–4 Boolean search queries (e.g. `"wastewater-based epidemiology" AND norovirus`)
- Inferred inclusion and exclusion criteria
- A suggested date range and maximum result count

You can review and adjust these before searching. If you do not have a language model configured, ALDA uses keyword extraction rules instead.

### Step 2: Run the Search

Select which databases to search (all are checked by default), whether to use AI relevance scoring, and click **Start Search**.

ALDA queries all selected sources in parallel. The interface shows live progress: how many results have been found, which sources are responding, and which (if any) are returning errors.

The search runs in iterations:

1. ALDA searches with your initial Boolean queries
2. It deduplicates incoming results against each other and against anything already in the database
3. It checks whether the search is "saturating" — if the last three rounds each added fewer than 5% new unique results, it stops automatically
4. If not saturated, it expands the keyword list (from frequent terms in the abstracts found) and runs another round

This continues for up to five iterations, or until the result limit you set is reached.

When the search finishes, ALDA shows you a breakdown table: how many raw results each source returned, and how many unique results it contributed after deduplication.

### Step 3: Relevance Scoring (Optional)

If you have a language model configured and opted into scoring, ALDA rates each result on a 0–100% relevance scale relative to your research question. It works through results in batches, assigning a score and a one-line reason for each.

You can skip this step if you prefer to screen results manually.

### Step 4: Browse, Filter, and Export

The results panel shows all sources found. You can:

- Filter by source type (academic, grey literature, uploaded)
- Filter by relevance score (e.g. show only sources scoring above 70%)
- Sort by relevance, publication date, or title
- Expand abstracts inline
- Click DOI links to open sources

To export, choose CSV or JSON. You can apply your current filters to export only the results you care about. The export includes PRISMA flow statistics (records identified, duplicates removed, screened, included) for use in systematic review reporting.

The **Themes** tab runs a clustering analysis on your results and groups them by topic, displayed as a word cloud. Clicking a theme filters the results list to that group.

---

## Example Use Cases

### 1. Public Health Policy Brief

**Scenario:** A public health analyst needs to summarize the evidence on whether sugar-sweetened beverage taxes reduce consumption.

**How it flows through ALDA:**

1. The analyst types: *"What is the evidence that taxes on sugar-sweetened beverages reduce consumption?"*
2. ALDA parses this into keywords like `sugar-sweetened beverage tax`, `SSB levy`, `fiscal policy obesity`, `soda tax effectiveness`, and generates Boolean queries combining these terms.
3. ALDA searches PubMed, Semantic Scholar, OpenAlex, CrossRef, and grey literature sources (Google, Bing) simultaneously.
4. After two iterations, the search saturates at around 340 unique results. Duplicates from different databases are automatically removed.
5. With an LLM configured, ALDA scores each result. The analyst filters to results scoring above 75%, leaving around 80 highly relevant sources.
6. The analyst exports as CSV and imports it into their reference manager.
7. PRISMA statistics are included in the export for the methods section of the policy brief.

---

### 2. Graduate Student Systematic Review

**Scenario:** A PhD student in education is conducting a systematic review on peer tutoring outcomes in secondary schools.

**How it flows through ALDA:**

1. The student types: *"What are the effects of peer tutoring on academic achievement in secondary school students?"*
2. ALDA generates keywords including `peer tutoring`, `peer-assisted learning`, `cross-age tutoring`, `secondary education`, `academic performance`.
3. ALDA searches ERIC (education-focused), Semantic Scholar, OpenAlex, CrossRef, and PubMed.
4. The student already has a Zotero library with 40 sources from manual searching. They upload this as a CSV. ALDA deduplicates the uploaded sources against the newly found results.
5. After scoring, the student uses the 60% relevance threshold to produce a shortlist for full-text screening.
6. They export the shortlist with PRISMA statistics and continue with manual full-text review outside ALDA.

---

### 3. Journalist Investigating a Health Claim

**Scenario:** A science journalist wants to quickly understand what the research says about long COVID cognitive symptoms.

**How it flows through ALDA:**

1. The journalist types: *"What does the research say about cognitive symptoms in long COVID?"*
2. ALDA generates queries like `"long COVID" AND "cognitive impairment"`, `post-acute sequelae SARS-CoV-2 cognition`, `brain fog COVID-19`.
3. ALDA searches arXiv (for preprints), PubMed, Europe PMC, medRxiv-indexed sources, and grey literature including news outlets and government reports via Google and Bing.
4. The journalist does not have an LLM configured, so scoring is skipped. They sort results by date to find the most recent work.
5. The Themes tab clusters results around topics like "neuroinflammation", "fatigue and cognition", "memory testing", giving the journalist a quick map of the research landscape.
6. They export 50 recent, highly cited results as CSV for background reading.

---

### 4. Research Team Scoping Review

**Scenario:** A multi-disciplinary research team is conducting a scoping review of AI tools used in clinical decision support.

**How it flows through ALDA:**

1. A team member types: *"What AI-based tools have been developed for clinical decision support in hospitals?"*
2. ALDA produces a broad keyword set: `clinical decision support`, `CDSS`, `machine learning diagnosis`, `AI clinical tool`, `deep learning hospital`, `electronic health record AI`.
3. The team searches all 16 academic databases plus grey literature. They set the maximum results to 2000.
4. After five iterations the search completes with 1,840 unique sources.
5. LLM scoring runs overnight (the search persists across browser reloads). In the morning, the team filters to results scoring above 80%, returning ~400 sources.
6. Theme clustering groups these into clusters like "radiology AI", "sepsis prediction", "drug dosing", "triage tools".
7. The team exports results by theme, splitting the full-text screening work among team members.

---

## Configuring ALDA

Most features work without any configuration, but two optional settings unlock the most powerful capabilities:

### Language Model (for brief parsing, scoring, and query expansion)

Open **Settings → LLM Provider** and enter:
- Your provider (OpenAI, Mistral, Anthropic, Gemini, DeepSeek, or a local Ollama instance)
- Your API key
- The model name (e.g. `gpt-4o-mini`, `mistral-large-latest`)

Without an LLM, ALDA still searches and deduplicates — brief parsing and scoring use simpler rule-based approaches instead.

### API Keys for Premium Sources

Some sources work better (or at all) with API keys:

| Source | What the key unlocks |
|---|---|
| Semantic Scholar | Higher rate limits (5x more requests per second) |
| CORE | Full open access text indexing |
| Google Custom Search | Grey literature search via Google |
| Bing | Grey literature search via Bing |

DuckDuckGo is always available as a free fallback for grey literature.

---

## Understanding the Results

Each result card shows:
- **Title** (translated to English if the original is in another language)
- **Authors, year, and publication venue**
- **Citation count** (where available)
- **Source** (which database found it)
- **Relevance score** (if scoring was run) — colour-coded green/yellow/red
- **Abstract** (expandable; translated if necessary)
- **DOI link** (opens the original source)

---

## Exporting and PRISMA Reporting

The export includes a PRISMA flow table showing:

| Stage | Count |
|---|---|
| Records identified through database searching | n |
| Records identified through other sources (grey, uploaded) | n |
| Records after duplicates removed | n |
| Records screened | n |
| Records excluded (below relevance threshold, if applied) | n |
| Records included | n |

This maps directly onto the PRISMA flow diagram required for systematic reviews and many grant applications.

---

## Tips

- **Start broad, then filter.** ALDA handles large result sets well. It is easier to widen a search than to re-run it from scratch.
- **Use the saturation signal.** If ALDA stops after two or three iterations, that is a meaningful signal that the literature on your specific query is relatively small or well-covered by the initial keywords.
- **Upload your existing references first.** If you have already done some manual searching, upload those references before running the automated search. ALDA will deduplicate against them, so you will not miss sources and will not double-count them.
- **Scoring is a triage tool, not a quality filter.** Relevance scores reflect how closely a title and abstract match your research question — they do not assess methodological quality. Use scores to prioritise screening, not to exclude sources outright.
- **The search persists across page reloads.** If your browser closes during a long search, reopen ALDA and your search will resume from where it left off.
