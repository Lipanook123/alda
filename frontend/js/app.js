/**
 * ALDA Frontend — Vanilla ES Modules
 * BACKEND_URL is injected by GitHub Actions at deploy time.
 * For local dev: localStorage.setItem("alda_backend_url", "http://localhost:8000")
 */

const _rawBackend = localStorage.getItem("alda_backend_url") || "%%BACKEND_URL%%";
// If the placeholder was never replaced (secret not set), prompt the user once.
const BACKEND_URL = (_rawBackend && _rawBackend !== "%%BACKEND_URL%%") ? _rawBackend : (() => {
  const stored = localStorage.getItem("alda_backend_url");
  if (stored) return stored;
  const entered = prompt(
    "ALDA needs to know where its server is running.\n\n" +
    "Enter your backend URL (e.g. https://alda-49ak.onrender.com):"
  );
  if (entered && entered.trim()) {
    localStorage.setItem("alda_backend_url", entered.trim());
    return entered.trim();
  }
  return "";
})();

// ──────────────────────────────────────────────
// Display label maps
// ──────────────────────────────────────────────
const SOURCE_NAMES = {
  semantic_scholar: "Semantic Scholar",
  crossref: "CrossRef",
  openalex: "OpenAlex",
  arxiv: "arXiv",
  pubmed: "PubMed",
  core: "CORE (Open Access)",
  europe_pmc: "Europe PMC",
  doaj: "DOAJ",
  base: "BASE",
  openaire: "OpenAIRE",
  scielo: "SciELO",
  jstage: "J-STAGE",
  cyberleninka: "CyberLeninka",
  eric: "ERIC",
  who_iris: "WHO IRIS",
  clinicaltrials: "ClinicalTrials.gov",
  google_cse: "Google CSE",
  bing: "Bing Search",
  duckduckgo: "DuckDuckGo",
  upload: "Uploaded by you",
  scraped: "Web scraping",
};

const JOB_STATUS_LABELS = {
  running:   "Searching…",
  complete:  "Search complete",
  saturated: "Search complete — no further new sources found",
  failed:    "Search failed",
  pending:   "Starting…",
};

// ──────────────────────────────────────────────
// Token pricing (USD per 1k tokens — input/output)
// ──────────────────────────────────────────────
const TOKEN_PRICING = {
  "openai/gpt-4o-mini":                  [0.00015,  0.0006],
  "openai/gpt-4o":                       [0.005,    0.015],
  "openai/gpt-3.5-turbo":               [0.0005,   0.0015],
  "anthropic/claude-haiku-4-5-20251001": [0.00025,  0.00125],
  "anthropic/claude-sonnet-4-6":         [0.003,    0.015],
  "mistral/mistral-small-latest":        [0.001,    0.003],
  "mistral/mistral-medium-latest":       [0.0027,   0.0081],
  "mistral/open-mistral-7b":             [0.00025,  0.00025],
  "gemini/gemini-1.5-flash":             [0.000075, 0.0003],
  "gemini/gemini-1.5-pro":              [0.00125,  0.005],
  "deepseek/deepseek-chat":              [0.00027,  0.00110],
  "deepseek/deepseek-reasoner":          [0.00055,  0.00219],
};
// Rough per-source token estimates (title + abstract excerpt + prompt overhead)
const TOKENS_IN_PER_SOURCE  = 150;  // input
const TOKENS_OUT_PER_SOURCE =  25;  // output (short JSON score)

// ──────────────────────────────────────────────
// Activity log
// ──────────────────────────────────────────────
const _log = [];  // {ts, level, msg, detail}

function appLog(level, msg, detail = null) {
  const entry = { ts: new Date(), level, msg, detail };
  _log.push(entry);
  const el = document.getElementById("log-content");
  if (!el) return;
  const row = document.createElement("div");
  row.className = `log-row log-${level}`;
  const time = entry.ts.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  row.innerHTML =
    `<span class="log-ts">${time}</span>` +
    `<span class="log-level">${level.toUpperCase()}</span>` +
    `<span class="log-msg">${esc(msg)}${detail ? `<span class="log-detail"> — ${esc(String(detail))}</span>` : ""}</span>`;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
  // Badge on log button
  const badge = document.getElementById("btn-open-log");
  if (badge && level === "error") badge.classList.add("log-btn-error");
}

function openLogModal() {
  document.getElementById("log-modal").classList.remove("hidden");
  document.getElementById("btn-open-log").classList.remove("log-btn-error");
}

function closeLogModal() {
  document.getElementById("log-modal").classList.add("hidden");
}

function copyLog() {
  const text = _log.map(e => {
    const time = e.ts.toISOString().slice(11, 19);
    return `[${time}] [${e.level.toUpperCase()}] ${e.msg}${e.detail ? " — " + String(e.detail) : ""}`;
  }).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("btn-copy-log");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => {
    prompt("Copy this log:", text);
  });
}

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
let state = {
  queryId: null,
  jobId: null,
  pollInterval: null,
  pollErrorCount: 0,
  resultsPage: 1,
  pendingFile: null,
  llmProvider: null,
  llmModel: null,
  maxResults: 200,
};

// ──────────────────────────────────────────────
// API Client
// ──────────────────────────────────────────────
async function api(method, path, body = null, isForm = false) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }
  const url = `${BACKEND_URL}${path}`;
  // Only log non-poll requests to avoid spamming the log
  const isPoll = path.includes("/search/status/");
  if (!isPoll) appLog("info", `${method} ${path}`, body && !isForm ? JSON.stringify(body).slice(0, 200) : null);
  let resp;
  try {
    resp = await fetch(url, opts);
  } catch (netErr) {
    appLog("error", `${method} ${path} — network error`, netErr.message);
    throw netErr;
  }
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const err = await resp.json(); msg = err.detail || msg; } catch (_) {}
    appLog("error", `${method} ${path} → ${resp.status}`, msg);
    throw new Error(msg);
  }
  if (!isPoll) appLog("info", `${method} ${path} → ${resp.status} OK`);
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) return resp.json();
  if (ct.includes("text/csv") || ct.includes("application/octet-stream")) return resp.blob();
  return resp.text();
}

// ──────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });
}

function switchTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.click();
}

// ──────────────────────────────────────────────
// Guided banner
// ──────────────────────────────────────────────
const GUIDED_STEPS = {
  1: {
    title: "Step 1 — Describe your research question",
    desc: "Type your research question below, then click <strong>Parse Brief</strong> to continue.",
  },
  2: {
    title: "Step 2 — Run your search",
    desc: "ALDA is ready to search. Click <strong>Start Search</strong> — it usually takes 1–3 minutes.",
  },
  3: {
    title: "Step 3 — Explore and export your results",
    desc: "Your results are ready. Browse them, download a spreadsheet, or explore themes.",
  },
};

function updateGuidedBanner(step) {
  const s = GUIDED_STEPS[step];
  if (!s) return;
  document.getElementById("guided-title").textContent = s.title;
  document.getElementById("guided-desc").innerHTML = s.desc;

  [1, 2, 3].forEach(n => {
    const pip = document.getElementById(`pip-${n}`);
    if (!pip) return;
    pip.className = "step-pip" + (n < step ? " done" : n === step ? " active" : "");
  });
}

// ──────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────
async function checkHealth() {
  try {
    const h = await api("GET", "/api/v1/health");
    setDot("dot-db",
      h.db === "connected" ? "green" : "red",
      h.db === "connected" ? "Database connected" : `Database error: ${h.db}`);
    setDot("dot-llm",
      h.llm_configured ? "green" : "grey",
      h.llm_configured ? "Language model active" : "Language model not configured — required for parsing");
    setDot("dot-scraping",
      h.scraping_enabled ? "green" : "grey",
      h.scraping_enabled ? "Web scraping enabled" : "Web scraping disabled");

    if (h.available_sources) {
      const gCSE = h.available_sources.google_cse;
      const bing = h.available_sources.bing;
      const gLabel = document.getElementById("lbl-google");
      const bLabel = document.getElementById("lbl-bing");
      if (gLabel) {
        gLabel.querySelector("input").disabled = !gCSE;
        if (!gCSE) gLabel.style.opacity = "0.5";
      }
      if (bLabel) {
        bLabel.querySelector("input").disabled = !bing;
        if (!bing) bLabel.style.opacity = "0.5";
      }
    }

    state.llmProvider = h.llm_provider || null;
    state.llmModel = h.llm_model || null;
    appLog("info", "Health check OK",
      `db=${h.db}, llm=${h.llm_configured ? (h.llm_provider + "/" + h.llm_model) : "not configured"}`);

    if (!h.llm_configured) {
      showSetupIfNeeded();
    } else {
      // Mark setup complete so wizard doesn't reappear (covers env-var configuration)
      localStorage.setItem("alda_setup_done", "true");
      localStorage.removeItem("alda_setup_skipped");
      // Close wizard if it was showing while the health check ran
      document.getElementById("setup-modal").classList.add("hidden");
      updateTokenEstimate();
    }
  } catch (e) {
    appLog("error", "Health check failed", e.message);
    setDot("dot-db", "red", `Cannot reach the server: ${e.message}`);
    setDot("dot-llm", "red", "");
    setDot("dot-scraping", "red", "");
  }
}

function setDot(id, cls, title) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-dot ${cls}`;
  if (title) el.title = title;
  const labelEl = document.getElementById(id.replace("dot-", "label-"));
  if (labelEl) labelEl.style.opacity = cls === "grey" ? "0.55" : "1";
}

// ──────────────────────────────────────────────
// Mission Brief
// ──────────────────────────────────────────────
function initMission() {
  document.getElementById("btn-parse").addEventListener("click", parseMission);
  document.getElementById("btn-go-search").addEventListener("click", () => switchTab("search"));
  const goMission = document.getElementById("btn-go-mission");
  if (goMission) goMission.addEventListener("click", () => switchTab("mission"));
}

async function parseMission() {
  const text = document.getElementById("mission-text").value.trim();
  if (!text) {
    showStatus("parse-status", "Please enter your research question first.", "error");
    return;
  }

  showStatus("parse-status", "Analysing your question…");
  try {
    const result = await api("POST", "/api/v1/mission/parse", { text });
    state.queryId = result.query_id;
    state.maxResults = result.structured.max_results || 200;
    appLog("info", "Brief parsed", `query_id=${result.query_id}, topic="${result.structured.topic}", max_results=${state.maxResults}`);
    renderBrief(result.structured);
    showStatus("parse-status", "Done! Review the summary, then run your search.", "success");
    loadRecentQueries();
    updateGuidedBanner(2);
    updateTokenEstimate();
  } catch (e) {
    appLog("error", "Parse brief failed", e.message);
    if (e.message === "llm_not_configured") {
      document.getElementById("parse-status").innerHTML =
        `<span class="status-msg error">
           A language model is required to parse research briefs.
           <button class="secondary" style="margin-left:0.5rem" onclick="openSetupWizard()">
             Set up language model →
           </button>
         </span>`;
    } else {
      showStatus("parse-status", `Parse failed: ${e.message}`, "error");
    }
  }
}

function renderBrief(s) {
  const kws = (s.keywords || []).map(k => `<span class="kw-chip">${esc(k)}</span>`).join(" ");
  const dr = s.date_range ? `${s.date_range[0]}–${s.date_range[1]}` : "Not specified";
  const inc = (s.inclusion_criteria || []).length
    ? `<ul>${s.inclusion_criteria.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "<em>None specified</em>";
  const exc = (s.exclusion_criteria || []).length
    ? `<ul>${s.exclusion_criteria.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "<em>None specified</em>";
  const sourceDisplay = (s.source_types || [])
    .map(t => SOURCE_NAMES[t] || t).join(", ") || "All sources";

  const queriesHtml = (s.search_queries || []).length
    ? `<p><strong>Search queries that will run:</strong></p>
       <ol class="search-queries-list">${
         s.search_queries.map(q => `<li><code>${esc(q)}</code></li>`).join("")
       }</ol>`
    : "";

  document.getElementById("brief-content").innerHTML = `
    <p><strong>Topic:</strong> ${esc(s.topic)}</p>
    <p><strong>Keywords (including synonyms &amp; related terms):</strong>
       ${kws || "<em>None identified</em>"}</p>
    ${queriesHtml}
    <p><strong>Date range:</strong> ${dr}</p>
    <p><strong>Source types:</strong> ${esc(sourceDisplay)}</p>
    <p><strong>Maximum results:</strong> ${s.max_results}</p>
    <p><strong>Include:</strong></p>${inc}
    <p><strong>Exclude:</strong></p>${exc}
    <p class="field-help">Not quite right? Edit your question above and click Parse Brief again.</p>
  `;
  document.getElementById("brief-preview").classList.remove("hidden");
}

async function loadRecentQueries() {
  try {
    const queries = await api("GET", "/api/v1/mission/");
    if (!queries.length) return;
    const list = queries.map(q => `
      <div class="result-card" style="cursor:pointer" data-qid="${q.id}">
        <div class="result-meta">${fmtDate(q.timestamp)} — ${JOB_STATUS_LABELS[q.status] || q.status}</div>
        <div>${esc(q.query_text.slice(0, 140))}${q.query_text.length > 140 ? "…" : ""}</div>
      </div>
    `).join("");
    document.getElementById("recent-queries-list").innerHTML = list;
    document.getElementById("recent-queries-section").classList.remove("hidden");
    document.querySelectorAll("[data-qid]").forEach(el => {
      el.addEventListener("click", () => selectQuery(el.dataset.qid, el));
    });
  } catch (_) {}
}

function selectQuery(qid, el) {
  state.queryId = qid;
  const preview = el.querySelector("div:last-child")?.textContent || "";
  showStatus("parse-status", "Previous search loaded. You can run a new search or go straight to Results.", "success");
  updateGuidedBanner(2);
}

// ──────────────────────────────────────────────
// Token estimate
// ──────────────────────────────────────────────
function updateTokenEstimate() {
  const el = document.getElementById("token-estimate");
  const textEl = document.getElementById("token-estimate-text");
  if (!el || !textEl) return;

  const useLlm = document.getElementById("use-llm");
  if (!state.llmProvider || !state.llmModel || (useLlm && !useLlm.checked)) {
    el.classList.add("hidden");
    return;
  }

  const n = state.maxResults;
  const totalIn  = n * TOKENS_IN_PER_SOURCE;
  const totalOut = n * TOKENS_OUT_PER_SOURCE;
  const totalTokens = totalIn + totalOut;

  const key = `${state.llmProvider}/${state.llmModel}`;
  const pricing = TOKEN_PRICING[key];

  if (pricing) {
    const cost = (totalIn / 1000 * pricing[0]) + (totalOut / 1000 * pricing[1]);
    const costStr = cost < 0.01 ? "<$0.01" : `~$${cost.toFixed(2)}`;
    textEl.innerHTML =
      `<strong>Estimated language model scoring cost:</strong> ${costStr} ` +
      `<span class="muted">(~${(totalTokens / 1000).toFixed(0)}k tokens for up to ${n} sources ` +
      `using ${esc(state.llmModel)})</span>`;
  } else {
    textEl.innerHTML =
      `<strong>Language model scoring:</strong> ~${(totalTokens / 1000).toFixed(0)}k tokens estimated ` +
      `for up to ${n} sources <span class="muted">(pricing not available for ${esc(state.llmModel)})</span>`;
  }
  el.classList.remove("hidden");
}

function budgetToTokens(dollars) {
  if (!dollars || isNaN(dollars) || dollars <= 0) return null;
  const key = `${state.llmProvider}/${state.llmModel}`;
  const pricing = TOKEN_PRICING[key];
  if (!pricing) {
    // Fallback: assume $1 = ~5000 tokens (cheap model average)
    return Math.round(dollars * 5000);
  }
  // Use average of input+output rate to convert dollar budget → token budget
  const avgPricePer1k = (pricing[0] + pricing[1]) / 2;
  return Math.round((dollars / avgPricePer1k) * 1000);
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────
function initSearch() {
  document.getElementById("btn-search").addEventListener("click", startSearch);
  const useLlm = document.getElementById("use-llm");
  if (useLlm) useLlm.addEventListener("change", updateTokenEstimate);
}

async function startSearch() {
  if (!state.queryId) {
    document.getElementById("no-query-warn").classList.remove("hidden");
    document.getElementById("search-form").classList.add("hidden");
    return;
  }
  document.getElementById("no-query-warn").classList.add("hidden");
  document.getElementById("search-form").classList.remove("hidden");

  const sources = [...document.querySelectorAll('input[name="source"]:checked')].map(el => el.value);
  const useLlm = document.getElementById("use-llm").checked;
  const budgetDollars = parseFloat(document.getElementById("token-budget-dollars")?.value) || 0;
  const maxTokenBudget = budgetDollars > 0 ? budgetToTokens(budgetDollars) : null;

  showStatus("search-status-msg", "Starting…");
  try {
    const result = await api("POST", "/api/v1/search/start", {
      query_id: state.queryId,
      sources,
      use_llm_relevance: useLlm,
      max_token_budget: maxTokenBudget,
      max_results: state.defaultMaxResults ?? null,
    });
    state.jobId = result.job_id;
    state.pollErrorCount = 0;
    appLog("info", "Search started", `job_id=${result.job_id}, sources=${sources.join(",")}`);
    document.getElementById("search-progress").classList.remove("hidden");
    document.getElementById("btn-search").disabled = true;
    document.getElementById("btn-search").textContent = "Searching…";
    startPolling();
    showStatus("search-status-msg", "");
  } catch (e) {
    showStatus("search-status-msg", `Could not start search: ${e.message}`, "error");
  }
}

function startPolling() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollInterval = setInterval(pollStatus, 2000);
}

async function pollStatus() {
  if (!state.jobId) return;
  try {
    const job = await api("GET", `/api/v1/search/status/${state.jobId}`);
    state.pollErrorCount = 0;
    updateProgress(job);
    showStatus("search-status-msg", "");  // clear any previous connection error

    if (["complete", "saturated", "failed"].includes(job.status)) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      document.getElementById("btn-search").disabled = false;
      document.getElementById("btn-search").textContent = "Start Search";
      appLog("info", `Search job ${state.jobId} finished`, `status=${job.status}, sources=${job.progress.total_sources_found}`);

      if (job.status === "failed") {
        const errMsg = job.progress.error || "unknown error";
        appLog("error", "Search job reported failure", errMsg);
        showStatus("search-status-msg", `Search failed: ${errMsg}`, "error");
      } else {
        const total = job.progress.total_sources_found;
        showStatus("search-status-msg",
          `Found ${total} source${total !== 1 ? "s" : ""}. Taking you to results…`, "success");
        updateGuidedBanner(3);
        setTimeout(() => { switchTab("results"); loadResults(true); }, 1000);
      }
    }
  } catch (e) {
    state.pollErrorCount++;
    appLog("error", `Poll attempt ${state.pollErrorCount} failed`, e.message);
    if (state.pollErrorCount >= 5) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      document.getElementById("btn-search").disabled = false;
      document.getElementById("btn-search").textContent = "Start Search";
      showStatus("search-status-msg",
        `Lost connection to server after ${state.pollErrorCount} attempts. ` +
        `Open the <strong>Log</strong> for details, then try searching again.`, "error");
      document.getElementById("search-status-msg").innerHTML =
        `Lost connection to server. ` +
        `<button class="secondary" style="font-size:0.8rem;padding:0.2rem 0.6rem;margin-left:0.5rem" ` +
        `onclick="retryPoll()">Reconnect</button> ` +
        `or <button class="secondary" style="font-size:0.8rem;padding:0.2rem 0.6rem" ` +
        `onclick="openLogModal()">View log</button>`;
    } else {
      showStatus("search-status-msg",
        `Connection issue (attempt ${state.pollErrorCount}/5): ${e.message}`, "error");
    }
  }
}

function retryPoll() {
  if (!state.jobId) return;
  state.pollErrorCount = 0;
  showStatus("search-status-msg", "Reconnecting…");
  document.getElementById("btn-search").disabled = true;
  document.getElementById("btn-search").textContent = "Searching…";
  appLog("info", "Retrying poll for job", state.jobId);
  startPolling();
}

function updateProgress(job) {
  const p = job.progress;
  const pct = Math.min(
    Math.round((p.total_sources_found / Math.max(p.total_sources_found + 20, 100)) * 100),
    95,
  );
  document.getElementById("search-progress-bar").value = pct;

  const label = JOB_STATUS_LABELS[job.status] || job.status;
  const newNote = p.new_this_iteration > 0
    ? ` — ${p.new_this_iteration} new this pass`
    : " — no new sources this pass (wrapping up…)";
  document.getElementById("search-stats").innerHTML =
    `<strong>${label}</strong> — Found <strong>${p.total_sources_found}</strong> sources so far${newNote}.`;

  const breakdown = Object.entries(p.source_breakdown || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="source-tag">${SOURCE_NAMES[k] || k}: ${v}</span>`)
    .join(" ");

  let tokenNote = "";
  if (p.tokens_used > 0) {
    const key = `${state.llmProvider}/${state.llmModel}`;
    const pricing = TOKEN_PRICING[key];
    if (pricing) {
      const cost = (p.tokens_used / 1000) * ((pricing[0] + pricing[1]) / 2);
      tokenNote = ` · Language model scoring: ${p.tokens_used.toLocaleString()} tokens (~$${cost < 0.01 ? "<0.01" : cost.toFixed(2)})`;
    } else {
      tokenNote = ` · Language model scoring: ${p.tokens_used.toLocaleString()} tokens used`;
    }
  }

  document.getElementById("source-breakdown").innerHTML =
    breakdown + (tokenNote ? `<div class="muted" style="margin-top:0.3rem;font-size:0.8rem">${tokenNote}</div>` : "");
}

// ──────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────
function initResults() {
  document.getElementById("btn-filter").addEventListener("click", () => {
    state.resultsPage = 1;
    loadResults(true);
  });
  document.getElementById("btn-load-more").addEventListener("click", () => {
    state.resultsPage++;
    loadResults(false);
  });
  document.getElementById("filter-relevance").addEventListener("input", function () {
    document.getElementById("relevance-val").textContent = `${this.value}%`;
  });
}

async function loadResults(reset = false) {
  if (!state.queryId) return;
  if (reset) {
    state.resultsPage = 1;
    document.getElementById("results-list").innerHTML = "";
  }

  const type = document.getElementById("filter-type").value;
  const sort = document.getElementById("filter-sort").value;
  const minRel = (parseInt(document.getElementById("filter-relevance").value, 10) / 100).toFixed(2);

  try {
    const sources = await api("GET",
      `/api/v1/search/results/${state.queryId}?page=${state.resultsPage}&page_size=50` +
      `&sort_by=${sort}&source_type=${type}&min_relevance=${minRel}`
    );

    if (reset) document.getElementById("results-list").innerHTML = "";

    if (!sources.length && state.resultsPage === 1) {
      document.getElementById("results-list").innerHTML = `
        <div class="empty-state">
          <p>No results yet.</p>
          <p>Go to <strong>Step 2: Search</strong> to run a search, or use <strong>Upload Sources</strong> to add your own.</p>
          <button class="secondary" onclick="switchTab('search')" style="margin-top:0.75rem">Run a search →</button>
        </div>`;
      document.getElementById("load-more-row").style.display = "none";
      document.getElementById("results-actions").classList.add("hidden");
      return;
    }

    document.getElementById("results-count").textContent =
      `Showing ${sources.length} source${sources.length !== 1 ? "s" : ""}` +
      (state.resultsPage > 1 ? ` (page ${state.resultsPage})` : "");

    const cards = sources.map(renderSourceCard).join("");
    document.getElementById("results-list").insertAdjacentHTML("beforeend", cards);
    document.getElementById("load-more-row").style.display = sources.length >= 50 ? "flex" : "none";

    document.querySelectorAll(".result-abstract").forEach(el => {
      el.addEventListener("click", () => el.classList.toggle("expanded"));
    });

    if (state.resultsPage === 1 && sources.length > 0) {
      const actionsEl = document.getElementById("results-actions");
      const msgEl = document.getElementById("results-action-msg");
      msgEl.innerHTML = `<strong>${sources.length}+ sources found.</strong> What would you like to do next?`;
      actionsEl.classList.remove("hidden");
    }
  } catch (e) {
    document.getElementById("results-list").innerHTML =
      `<div class="empty-state"><p>Could not load results: ${esc(e.message)}</p></div>`;
  }
}

function renderSourceCard(src) {
  const authors = (src.authors || []).slice(0, 3).join(", ") +
    (src.authors?.length > 3 ? " et al." : "");
  const relBadge = src.relevance != null ? relevanceBadge(src.relevance) : "";
  const srcName = SOURCE_NAMES[src.source_type] || src.source_type;
  const typeBadge = `<span class="source-badge">${esc(srcName)}</span>`;
  const doiLink = src.doi
    ? `<a href="https://doi.org/${esc(src.doi)}" target="_blank" rel="noopener">Full text via DOI</a> · `
    : "";
  const citations = src.citation_count != null
    ? ` · ${src.citation_count.toLocaleString()} citation${src.citation_count !== 1 ? "s" : ""}`
    : "";

  const meta = src.metadata || {};
  const detectedLang = meta.detected_language || "";
  const translatedTitle = meta.translated_title || "";
  const translatedAbstract = meta.translated_abstract || "";

  const titleHtml = translatedTitle && translatedTitle !== src.title
    ? `${esc(src.title)} <span class="title-translation">(${esc(translatedTitle)})</span>`
    : esc(src.title);

  const translationBlock = translatedAbstract
    ? `<div class="result-translation">
        <span class="translation-label">Translated from ${esc(detectedLang || "original language")}:</span>
        <div class="translation-text">${esc(translatedAbstract)}</div>
       </div>`
    : "";

  return `
    <div class="result-card">
      <div class="result-title">
        <a href="${esc(src.url)}" target="_blank" rel="noopener">${titleHtml}</a>
        ${relBadge}${typeBadge}
      </div>
      <div class="result-meta">
        ${authors ? esc(authors) + " · " : ""}${src.year || ""}
        ${src.venue ? " · " + esc(src.venue) : ""}${citations}
        · ${doiLink}<a href="${esc(src.url)}" target="_blank" rel="noopener">Open source</a>
      </div>
      ${src.abstract ? `<div class="result-abstract">${esc(src.abstract)}</div>` : ""}
      ${translationBlock}
    </div>
  `;
}

function relevanceBadge(score) {
  const pct = Math.round(score * 100);
  const cls = score >= 0.7 ? "relevance-high" : score >= 0.4 ? "relevance-medium" : "relevance-low";
  const tip = `Relevance: ${pct}% — how closely this source matches your research question. `
    + `70%+ is a strong match; 40–70% is moderate; below 40% may be less relevant.`;
  return `<span class="relevance-badge ${cls}" title="${esc(tip)}">${pct}% match</span>`;
}

// ──────────────────────────────────────────────
// Upload
// ──────────────────────────────────────────────
function initUpload() {
  const dz = document.getElementById("drop-zone");
  const fi = document.getElementById("file-input");

  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  fi.addEventListener("change", () => { if (fi.files[0]) setFile(fi.files[0]); });
  document.getElementById("btn-upload").addEventListener("click", doUpload);
}

function setFile(file) {
  state.pendingFile = file;
  document.getElementById("upload-file-name").textContent =
    `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById("btn-upload").disabled = false;
}

async function doUpload() {
  if (!state.pendingFile) return;
  const fd = new FormData();
  fd.append("file", state.pendingFile);
  if (state.queryId) fd.append("query_id", state.queryId);

  const btn = document.getElementById("btn-upload");
  btn.disabled = true;
  btn.textContent = "Uploading…";

  try {
    const result = await api("POST", "/api/v1/upload/", fd, true);
    const el = document.getElementById("upload-result");
    const n = result.records_inserted;
    const dups = result.records_skipped_duplicate;
    el.className = `upload-result ${result.errors?.length ? "has-errors" : "success"}`;
    el.innerHTML = `
      <p><strong>${n} source${n !== 1 ? "s" : ""} added to your library.</strong>
      ${dups > 0 ? `${dups} duplicate${dups !== 1 ? "s" : ""} skipped (already in the database).` : ""}</p>
      ${result.errors?.length
        ? `<details><summary>Problems with ${result.errors.length} row${result.errors.length !== 1 ? "s" : ""}</summary>
           <ul>${result.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>`
        : ""}
      ${n > 0 ? `<p><button class="secondary" onclick="switchTab('results');loadResults(true)">View your sources →</button></p>` : ""}
    `;
    el.classList.remove("hidden");
  } catch (e) {
    const el = document.getElementById("upload-result");
    el.className = "upload-result has-errors";
    el.innerHTML = `<p>Upload failed: ${esc(e.message)}</p>`;
    el.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload";
  }
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────
function initExport() {
  document.getElementById("btn-export").addEventListener("click", doExport);
  document.getElementById("btn-prisma").addEventListener("click", loadPrisma);
}

async function doExport() {
  const fmt = document.querySelector('input[name="export-format"]:checked').value;
  const currentOnly = document.getElementById("export-current-query").checked;
  const body = { format: fmt };
  if (currentOnly && state.queryId) body.query_id = state.queryId;

  const btn = document.getElementById("btn-export");
  btn.disabled = true;
  btn.textContent = "Preparing download…";

  try {
    const blob = await api("POST", "/api/v1/export/", body);
    const ext = fmt === "csv" ? "csv" : "json";
    downloadBlob(blob, `alda_export_${Date.now()}.${ext}`);
  } catch (e) {
    alert(`Download failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Download";
  }
}

async function loadPrisma() {
  if (!state.queryId) {
    document.getElementById("prisma-stats").innerHTML =
      `<p class="field-help">Please run a search first, then come back here to generate the PRISMA table.</p>`;
    return;
  }
  const btn = document.getElementById("btn-prisma");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const stats = await api("GET", `/api/v1/export/prisma/${state.queryId}`);
    const rows = [
      ["Records identified through database searching", stats.identified],
      ["Duplicates removed", stats.duplicates_removed],
      ["Records screened", stats.screened],
      ["Records excluded", stats.excluded],
      ["Studies included in review", stats.included],
    ];
    const bySource = Object.entries(stats.by_source || {})
      .map(([k, v]) => `<tr><td>&nbsp;&nbsp;&nbsp;${esc(SOURCE_NAMES[k] || k)}</td><td>${v}</td></tr>`)
      .join("");
    document.getElementById("prisma-stats").innerHTML = `
      <table class="prisma-table">
        <tbody>
          ${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("")}
          ${bySource}
        </tbody>
      </table>
      <p class="field-help" style="margin-top:0.75rem">Copy this table into your methods section. Most journals accept it in this format.</p>
    `;
  } catch (e) {
    document.getElementById("prisma-stats").innerHTML =
      `<p style="color:var(--alda-danger)">Could not load statistics: ${esc(e.message)}</p>`;
  }
}

// ──────────────────────────────────────────────
// Themes
// ──────────────────────────────────────────────
function initThemes() {
  document.getElementById("btn-cluster").addEventListener("click", runClustering);
}

async function runClustering() {
  if (!state.queryId) {
    showStatus("cluster-status", "Please run a search first.", "error");
    return;
  }
  const btn = document.getElementById("btn-cluster");
  btn.disabled = true;
  showStatus("cluster-status", "Grouping your sources into themes…");
  try {
    const job = await api("POST", `/api/v1/themes/cluster/${state.queryId}`);
    const interval = setInterval(async () => {
      try {
        const s = await api("GET", `/api/v1/themes/cluster/status/${job.job_id}`);
        if (s.status === "complete") {
          clearInterval(interval);
          btn.disabled = false;
          showStatus("cluster-status", "Themes ready!", "success");
          loadThemes();
        } else if (s.status.startsWith("failed")) {
          clearInterval(interval);
          btn.disabled = false;
          showStatus("cluster-status", "Clustering failed — please try again.", "error");
        }
      } catch (_) {
        clearInterval(interval);
        btn.disabled = false;
      }
    }, 2000);
  } catch (e) {
    btn.disabled = false;
    showStatus("cluster-status", `Could not start clustering: ${e.message}`, "error");
  }
}

async function loadThemes() {
  if (!state.queryId) return;
  const container = document.getElementById("theme-cloud");
  try {
    const themes = await api("GET", `/api/v1/themes/${state.queryId}`);
    if (!themes.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No themes found yet.</p>
          <p>Run a search to gather sources, then click Find Themes.</p>
        </div>`;
      return;
    }
    const maxCount = Math.max(...themes.map(t => t.source_count), 1);
    const cloud = themes.map(t => {
      const size = 0.85 + (t.source_count / maxCount) * 1.3;
      const tip = `${t.source_count} source${t.source_count !== 1 ? "s" : ""}` +
        (t.description ? ` — ${t.description}` : "");
      return `<span class="theme-tag" style="font-size:${size}rem"
        title="${esc(tip)}" data-theme="${esc(t.name)}"
        >${esc(t.name)} <small style="opacity:0.7">(${t.source_count})</small></span>`;
    }).join("");

    container.innerHTML =
      `<p class="field-help theme-legend">Tag size = number of sources in that theme. Click a tag to go to your results.</p>` +
      `<div class="theme-cloud">${cloud}</div>`;

    container.querySelectorAll(".theme-tag").forEach(tag => {
      tag.addEventListener("click", () => {
        switchTab("results");
        document.getElementById("results-count").textContent =
          `Showing results for theme: ${tag.dataset.theme}`;
        loadResults(true);
      });
    });
  } catch (e) {
    container.innerHTML =
      `<div class="empty-state"><p>Could not load themes: ${esc(e.message)}</p></div>`;
  }
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleDateString(undefined, { dateStyle: "medium" }); }
  catch (_) { return ts; }
}

function showStatus(id, msg, type = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ──────────────────────────────────────────────
// Setup Wizard
// ──────────────────────────────────────────────
const PROVIDERS_CONFIG = {
  openai: {
    name: "OpenAI",
    description: "Most popular. GPT-4o-mini is fast, affordable, and capable.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
    steps: [
      'Sign up or log in at <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a>',
      "Click <strong>API Keys</strong> in the left sidebar",
      "Click <strong>Create new secret key</strong>",
      "Copy the key — it starts with <code>sk-</code>",
    ],
  },
  anthropic: {
    name: "Anthropic (Claude)",
    description: "Claude models. Haiku is fast and affordable.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Starts with sk-ant-",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
    steps: [
      'Sign up or log in at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>',
      "Click <strong>API Keys</strong> in the left sidebar",
      "Click <strong>Create Key</strong>",
      "Copy the key — it starts with <code>sk-ant-</code>",
    ],
  },
  mistral: {
    name: "Mistral AI",
    description: "European language model provider. Good balance of cost and capability.",
    keyUrl: "https://console.mistral.ai/api-keys/",
    keyHint: "A long alphanumeric string",
    models: ["mistral-small-latest", "mistral-medium-latest", "open-mistral-7b"],
    steps: [
      'Sign up or log in at <a href="https://console.mistral.ai" target="_blank" rel="noopener">console.mistral.ai</a>',
      "Click <strong>API Keys</strong> in the sidebar",
      "Click <strong>Create new key</strong>",
      "Copy the key",
    ],
  },
  gemini: {
    name: "Google Gemini",
    description: "Google's language model. Has a free tier.",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyHint: "Starts with AIza",
    models: ["gemini-1.5-flash", "gemini-1.5-pro"],
    steps: [
      'Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a>',
      "Sign in with your Google account",
      "Click <strong>Get API Key</strong>",
      "Copy the key — it starts with <code>AIza</code>",
    ],
  },
  deepseek: {
    name: "DeepSeek",
    description: "Very affordable. DeepSeek-chat is excellent value.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "Starts with sk-",
    models: ["deepseek-chat", "deepseek-reasoner"],
    steps: [
      'Sign up or log in at <a href="https://platform.deepseek.com" target="_blank" rel="noopener">platform.deepseek.com</a>',
      "Click <strong>API Keys</strong> in the left sidebar",
      "Click <strong>Create new API key</strong>",
      "Copy the key — it starts with <code>sk-</code>",
    ],
  },
  ollama: {
    name: "Ollama (free, local)",
    description: "Runs on your own computer. No API key or account needed.",
    keyUrl: "https://ollama.ai",
    keyHint: null,
    models: ["llama3", "llama3.1", "mistral", "gemma2"],
    steps: [
      'Download and install from <a href="https://ollama.ai" target="_blank" rel="noopener">ollama.ai</a>',
      "Open a terminal and run: <code>ollama pull llama3</code>",
      "Make sure Ollama is running, then come back here",
    ],
  },
};

let _setupProvider = null;

function initSetupWizard() {
  // Populate provider cards
  const grid = document.getElementById("provider-grid");
  if (grid) {
    grid.innerHTML = Object.entries(PROVIDERS_CONFIG).map(([key, p]) => `
      <div class="provider-card" onclick="selectProvider('${key}')">
        <strong>${esc(p.name)}</strong>
        <p>${esc(p.description)}</p>
      </div>
    `).join("");
  }

  document.getElementById("btn-setup-test").addEventListener("click", setupTestAndSave);
}

function showSetupIfNeeded() {
  if (!localStorage.getItem("alda_setup_done") && !localStorage.getItem("alda_setup_skipped")) {
    document.getElementById("setup-modal").classList.remove("hidden");
  }
}

function openSetupWizard() {
  setupGoTo(0);
  document.getElementById("setup-modal").classList.remove("hidden");
}

function setupGoTo(step) {
  document.querySelectorAll(".setup-step").forEach(s => s.classList.add("hidden"));
  document.getElementById(`setup-step-${step}`).classList.remove("hidden");
}

function selectProvider(key) {
  _setupProvider = key;
  const p = PROVIDERS_CONFIG[key];

  // Build instructions
  const stepsHtml = p.steps.map((s, i) => `<li>${s}</li>`).join("");
  document.getElementById("provider-instructions").innerHTML = `
    <h4>${esc(p.name)}</h4>
    <ol style="padding-left:1.5rem;line-height:1.9">${stepsHtml}</ol>
    <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener" class="secondary"
       style="display:inline-block;margin-top:0.75rem;font-size:0.9rem">
      Open ${esc(p.name)} dashboard ↗
    </a>
  `;

  // Populate model select
  const sel = document.getElementById("setup-model");
  sel.innerHTML = p.models.map(m => `<option value="${m}">${m}</option>`).join("");

  // Handle Ollama (no key needed)
  const keyInput = document.getElementById("setup-api-key");
  const keyHint = document.getElementById("setup-key-hint");
  if (p.keyHint === null) {
    keyInput.value = "";
    keyInput.placeholder = "No API key needed";
    keyInput.disabled = true;
    if (keyHint) keyHint.textContent = "Ollama runs locally — no account or key required.";
  } else {
    keyInput.disabled = false;
    keyInput.placeholder = "Paste your key here";
    if (keyHint) keyHint.textContent = p.keyHint;
  }

  setupGoTo(2);
}

async function setupTestAndSave() {
  const btn = document.getElementById("btn-setup-test");
  const statusEl = document.getElementById("setup-test-status");
  const key = document.getElementById("setup-api-key").value.trim();
  const model = document.getElementById("setup-model").value;

  btn.disabled = true;
  btn.textContent = "Testing connection…";
  statusEl.innerHTML = "";

  try {
    const result = await api("POST", "/api/v1/setup/llm", {
      provider: _setupProvider,
      api_key: key,
      model,
    });
    if (result.success) {
      localStorage.setItem("alda_setup_done", "true");
      localStorage.removeItem("alda_setup_skipped");
      setupGoTo(4);
    } else {
      statusEl.innerHTML = `<p style="color:var(--alda-danger)">⚠️ ${esc(result.message)}</p>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<p style="color:var(--alda-danger)">⚠️ ${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Test & save →";
  }
}

function closeSetup() {
  document.getElementById("setup-modal").classList.add("hidden");
  checkHealth(); // refresh dots and token estimate to reflect new LLM state
}

// ──────────────────────────────────────────────
// Settings modal
// ──────────────────────────────────────────────

// Tracks the currently selected max_results value (may differ from a preset)
let _settingsMaxResults = 500;

function loadSettings() {
  const saved = localStorage.getItem("alda_max_results");
  _settingsMaxResults = saved !== null ? parseInt(saved, 10) : 500;
  state.defaultMaxResults = _settingsMaxResults;

  const useLlm = localStorage.getItem("alda_use_llm_default");
  if (useLlm !== null) {
    const el = document.getElementById("use-llm");
    if (el) el.checked = useLlm !== "false";
  }

  const budget = localStorage.getItem("alda_budget_default");
  if (budget) {
    const el = document.getElementById("token-budget-dollars");
    if (el && !el.value) el.value = budget;
  }
}

function openSettings() {
  // Populate max results pill selection
  _applyMaxResultsPills(_settingsMaxResults);

  // Search behaviour checkboxes / inputs
  const useLlmEl = document.getElementById("settings-use-llm");
  if (useLlmEl) {
    const saved = localStorage.getItem("alda_use_llm_default");
    useLlmEl.checked = saved === null ? true : saved !== "false";
  }
  const budgetEl = document.getElementById("settings-budget");
  if (budgetEl) budgetEl.value = localStorage.getItem("alda_budget_default") || "";

  // AI status
  const aiStatus = document.getElementById("settings-ai-status");
  if (aiStatus) {
    if (state.llmProvider && state.llmModel) {
      aiStatus.innerHTML =
        `<p class="settings-ai-configured">✓ ${esc(state.llmProvider)} / ${esc(state.llmModel)}</p>`;
    } else {
      aiStatus.innerHTML = `<p style="color:#888">Not configured — language model is required for parsing.</p>`;
    }
  }

  // Backend URL
  const urlEl = document.getElementById("settings-backend-url");
  if (urlEl) urlEl.value = localStorage.getItem("alda_backend_url") || "";

  // Fetch which API keys are currently set on the server
  api("GET", "/api/v1/setup/keys").then(data => {
    _setKeyStatus("key-status-semantic", data.semantic_scholar);
    _setKeyStatus("key-status-core", data.core);
    _setKeyStatus("key-status-google", data.google_cse);
    _setKeyStatus("key-status-bing", data.bing);
  }).catch(() => {});

  document.getElementById("settings-modal").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settings-modal").classList.add("hidden");
}

function selectMaxResults(val) {
  _settingsMaxResults = val;
  _applyMaxResultsPills(val);
  // Clear custom input unless this was triggered by it
  const custom = document.getElementById("settings-max-results-custom");
  if (custom && val !== parseInt(custom.value, 10)) custom.value = "";
}

function selectMaxResultsCustom(raw) {
  const val = parseInt(raw, 10);
  if (!isNaN(val) && val >= 0) {
    _settingsMaxResults = val;
    // Deactivate all pills if custom doesn't match any preset
    _applyMaxResultsPills(val);
  }
}

function _applyMaxResultsPills(val) {
  document.querySelectorAll(".results-opt").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.val, 10) === val);
  });
}

function _setKeyStatus(id, configured) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = configured ? "✓ configured" : "";
    el.style.color = configured ? "var(--alda-success, #2d6a4f)" : "";
  }
}

function saveSettings() {
  localStorage.setItem("alda_max_results", String(_settingsMaxResults));
  state.defaultMaxResults = _settingsMaxResults;

  const useLlm = document.getElementById("settings-use-llm")?.checked ?? true;
  localStorage.setItem("alda_use_llm_default", String(useLlm));
  const useLlmMain = document.getElementById("use-llm");
  if (useLlmMain) useLlmMain.checked = useLlm;

  const budget = document.getElementById("settings-budget")?.value || "";
  if (budget) {
    localStorage.setItem("alda_budget_default", budget);
    const budgetMain = document.getElementById("token-budget-dollars");
    if (budgetMain && !budgetMain.value) budgetMain.value = budget;
  } else {
    localStorage.removeItem("alda_budget_default");
  }

  closeSettings();
}

async function saveApiKeys() {
  const payload = {};
  const semKey = document.getElementById("sk-semantic-scholar")?.value.trim();
  const coreKey = document.getElementById("sk-core")?.value.trim();
  const googleCseId = document.getElementById("sk-google-cse-id")?.value.trim();
  const googleApiKey = document.getElementById("sk-google-api-key")?.value.trim();
  const bingKey = document.getElementById("sk-bing")?.value.trim();

  if (semKey) payload.semantic_scholar_api_key = semKey;
  if (coreKey) payload.core_api_key = coreKey;
  if (googleCseId) payload.google_cse_id = googleCseId;
  if (googleApiKey) payload.google_api_key = googleApiKey;
  if (bingKey) payload.bing_api_key = bingKey;

  if (Object.keys(payload).length === 0) {
    showStatus("settings-keys-status", "No keys entered.", "");
    return;
  }

  const btn = document.getElementById("btn-save-keys");
  btn.disabled = true;
  try {
    await api("POST", "/api/v1/setup/keys", payload);
    showStatus("settings-keys-status", "Keys saved.", "success");
    // Refresh key status indicators
    const data = await api("GET", "/api/v1/setup/keys");
    _setKeyStatus("key-status-semantic", data.semantic_scholar);
    _setKeyStatus("key-status-core", data.core);
    _setKeyStatus("key-status-google", data.google_cse);
    _setKeyStatus("key-status-bing", data.bing);
    // Clear entered values (security: don't leave keys in inputs)
    ["sk-semantic-scholar","sk-core","sk-google-cse-id","sk-google-api-key","sk-bing"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    // Refresh health (Google/Bing may now be enabled)
    checkHealth();
  } catch (e) {
    showStatus("settings-keys-status", `Error: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

function saveBackendUrl() {
  const url = document.getElementById("settings-backend-url")?.value.trim();
  if (!url) return;
  localStorage.setItem("alda_backend_url", url);
  location.reload();
}

// ──────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────
function init() {
  loadSettings();
  initTabs();
  initSetupWizard();
  showSetupIfNeeded();   // show immediately, before the async health check
  initMission();
  initSearch();
  initResults();
  initUpload();
  initExport();
  initThemes();
  checkHealth();
  loadRecentQueries();
}

document.addEventListener("DOMContentLoaded", init);

// Expose functions used in inline HTML onclick attributes (required because
// this file is loaded as type="module", which scopes everything locally).
Object.assign(window, {
  switchTab,
  setupGoTo,
  closeSetup,
  selectProvider,
  openSetupWizard,
  parseMission,
  startSearch,
  loadResults,
  doUpload,
  doExport,
  runClustering,
  selectQuery,
  openLogModal,
  closeLogModal,
  copyLog,
  retryPoll,
  openSettings,
  closeSettings,
  saveSettings,
  saveApiKeys,
  saveBackendUrl,
  selectMaxResults,
  selectMaxResultsCustom,
});
