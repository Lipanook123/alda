SOURCES_SQL = """
CREATE TABLE IF NOT EXISTS sources (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    authors         TEXT[],
    year            INTEGER,
    doi             TEXT,
    url             TEXT NOT NULL,
    abstract        TEXT,
    venue           TEXT,
    citation_count  INTEGER,
    source_type     TEXT NOT NULL,
    relevance       FLOAT,
    themes          TEXT[],
    metadata        JSON,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

QUERIES_SQL = """
CREATE TABLE IF NOT EXISTS queries (
    id              TEXT PRIMARY KEY,
    query_text      TEXT NOT NULL,
    search_strategy TEXT,
    timestamp       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    results_count   INTEGER,
    status          TEXT
)
"""

THEMES_SQL = """
CREATE TABLE IF NOT EXISTS themes (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

QUERY_LOGS_SQL = """
CREATE TABLE IF NOT EXISTS query_logs (
    id          TEXT PRIMARY KEY,
    query_id    TEXT REFERENCES queries(id),
    source_id   TEXT REFERENCES sources(id),
    matched     BOOLEAN,
    score       FLOAT,
    timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

ALL_TABLES = [SOURCES_SQL, QUERIES_SQL, THEMES_SQL, QUERY_LOGS_SQL]
