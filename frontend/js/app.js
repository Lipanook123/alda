/**
 * ALDA Frontend — Vanilla ES Modules
 * BACKEND_URL is injected by GitHub Actions at deploy time.
 * For local dev: localStorage.setItem("alda_backend_url", "http://localhost:8000")
 */

// ──────────────────────────────────────────────
// Backend URL
// ──────────────────────────────────────────────
const _injected = "%%BACKEND_URL%%";
let BACKEND_URL = localStorage.getItem("alda_backend_url") ||
  (_injected !== "%%BACKEND_URL%%" ? _injected : "");

// ──────────────────────────────────────────────
// Constants
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
  running:           "Searching…",
  awaiting_scoring:  "Search complete",
  scoring:           "Running relevance analysis…",
  complete:          "Search complete",
  saturated:         "Search complete — no further new sources found",
  failed:            "Search failed",
  pending:           "Starting…",
};

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
const TOKENS_IN_PER_SOURCE  = 150;
const TOKENS_OUT_PER_SOURCE =  25;

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
    description: "European provider. Good balance of cost and capability.",
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
    description: "Google's language models. Has a free tier.",
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

// ──────────────────────────────────────────────
// Activity log
// ──────────────────────────────────────────────
const _log = [];

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
  if (level === "error") {
    const btn = document.getElementById("btn-open-log");
    if (btn) btn.classList.add("log-btn-error");
  }
}

function openLogModal() {
  document.getElementById("log-modal").classList.remove("hidden");
  document.getElementById("btn-open-log")?.classList.remove("log-btn-error");
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
  }).catch(() => { prompt("Copy this log:", text); });
}

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
const state = {
  // Persisted
  lmConfig:      JSON.parse(localStorage.getItem("alda_lm_config") || "null"),
  currentQuery:  JSON.parse(localStorage.getItem("alda_current_query") || "null"),
  searchHistory: JSON.parse(localStorage.getItem("alda_search_history") || "[]"),

  // Session-only
  queryId:        null,
  jobId:          null,
  pollInterval:   null,
  pollErrorCount: 0,
  pollInFlight:   false,
  resultsPage:    1,
  pendingFile:    null,
  defaultMaxResults: 500,
  maxResults:     200,

  // Derived from health check
  lmProvider: null,
  lmModel:    null,
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
  const isPoll = path.includes("/search/status/") || path.includes("/themes/cluster/status/");
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
// Gate management
// ──────────────────────────────────────────────
function showGate(name) {
  document.getElementById(`gate-${name}`)?.classList.remove("hidden");
}
function hideGate(name) {
  document.getElementById(`gate-${name}`)?.classList.add("hidden");
}

async function initBackend() {
  if (!BACKEND_URL) {
    showGate("backend");
    return false;
  }
  try {
    const health = await api("GET", "/api/v1/health");
    applyHealthStatus(health);
    return true;
  } catch (_) {
    showGate("backend");
    return false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-gate-backend-connect")
    ?.addEventListener("click", connectBackend);
});

async function connectBackend() {
  const input = document.getElementById("gate-backend-url");
  const url = input?.value.trim();
  if (!url) return;
  BACKEND_URL = url;
  localStorage.setItem("alda_backend_url", url);

  const btn = document.getElementById("btn-gate-backend-connect");
  const statusEl = document.getElementById("gate-backend-status");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  statusEl.textContent = "";

  try {
    const health = await api("GET", "/api/v1/health");
    applyHealthStatus(health);
    hideGate("backend");
    proceedAfterBackend();
  } catch (e) {
    statusEl.textContent = `Cannot connect: ${e.message}`;
    statusEl.className = "alda-status-msg error";
    btn.disabled = false;
    btn.textContent = "Connect →";
  }
}

function applyHealthStatus(h) {
  setDot("dot-db",
    h.db === "connected" ? "green" : "red",
    h.db === "connected" ? "Database connected" : `Database error: ${h.db}`);
  setDot("dot-lm",
    h.llm_configured ? "green" : "grey",
    h.llm_configured ? "Language model active" : "Language model not configured");
  setDot("dot-scraping",
    h.scraping_enabled ? "green" : "grey",
    h.scraping_enabled ? "Web scraping enabled" : "Web scraping disabled");

  if (h.available_sources) {
    const gLabel = document.getElementById("lbl-google");
    const bLabel = document.getElementById("lbl-bing");
    if (gLabel) {
      gLabel.querySelector("input").disabled = !h.available_sources.google_cse;
      if (!h.available_sources.google_cse) gLabel.style.opacity = "0.5";
    }
    if (bLabel) {
      bLabel.querySelector("input").disabled = !h.available_sources.bing;
      if (!h.available_sources.bing) bLabel.style.opacity = "0.5";
    }
  }

  state.lmProvider = h.llm_provider || null;
  state.lmModel = h.llm_model || null;
}

function setDot(id, cls, title) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-dot ${cls}`;
  if (title) el.title = title;
}

// ──────────────────────────────────────────────
// Language model config
// ──────────────────────────────────────────────
function saveLmConfig(provider, model, apiKey) {
  const cfg = { provider, model, apiKey };
  localStorage.setItem("alda_lm_config", JSON.stringify(cfg));
  state.lmConfig = cfg;
  state.lmProvider = provider;
  state.lmModel = model;
  syncLmToBackend(cfg);
}

async function syncLmToBackend(cfg) {
  if (!cfg || !BACKEND_URL) return;
  try {
    await api("POST", "/api/v1/setup/llm", {
      provider: cfg.provider,
      api_key: cfg.apiKey,
      model: cfg.model,
    });
    setDot("dot-lm", "green", "Language model active");
    state.lmProvider = cfg.provider;
    state.lmModel = cfg.model;
    updateTokenEstimate();
  } catch (_) {
    // Silent — backend may be waking up; will retry on next call
  }
}

// ──────────────────────────────────────────────
// LM gate flow
// ──────────────────────────────────────────────
let _gateLmProvider = null;
let _lmGateFromSettings = false;
let _lmGateFromScoringGate = false;

function initLmGate() {
  const grid = document.getElementById("gate-provider-grid");
  if (grid) {
    grid.innerHTML = Object.entries(PROVIDERS_CONFIG).map(([key, p]) => `
      <div class="provider-card" onclick="gateLmSelectProvider('${key}')">
        <strong>${esc(p.name)}</strong>
        <p>${esc(p.description)}</p>
      </div>
    `).join("");
  }
  document.getElementById("btn-gate-lm-test")
    ?.addEventListener("click", gateLmTestAndSave);
}

function gateLmGoTo(step) {
  document.querySelectorAll(".alda-gate-step").forEach(s => s.classList.add("hidden"));
  document.getElementById(`gate-lm-${step}`)?.classList.remove("hidden");
  const cancelBtn = document.getElementById("btn-gate-lm-cancel");
  if (cancelBtn) cancelBtn.classList.toggle("hidden", !_lmGateFromSettings && !_lmGateFromScoringGate);
}

function gateLmSelectProvider(key) {
  _gateLmProvider = key;
  const p = PROVIDERS_CONFIG[key];

  // Highlight selected card
  document.querySelectorAll(".provider-card").forEach(c => c.classList.remove("selected"));
  const cards = document.getElementById("gate-provider-grid")?.querySelectorAll(".provider-card");
  if (cards) {
    Object.keys(PROVIDERS_CONFIG).forEach((k, i) => {
      if (k === key && cards[i]) cards[i].classList.add("selected");
    });
  }

  document.getElementById("gate-provider-instructions").innerHTML = `
    <h4 style="margin-bottom:0.75rem">${esc(p.name)}</h4>
    <ol style="padding-left:1.5rem;line-height:1.9;margin-bottom:0.75rem">
      ${p.steps.map(s => `<li>${s}</li>`).join("")}
    </ol>
    <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener" class="alda-btn alda-btn-secondary alda-btn-sm"
       style="display:inline-flex">
      Open ${esc(p.name)} dashboard ↗
    </a>
  `;

  const sel = document.getElementById("gate-model");
  if (sel) sel.innerHTML = p.models.map(m => `<option value="${m}">${m}</option>`).join("");

  const keyInput = document.getElementById("gate-api-key");
  const keyHint = document.getElementById("gate-key-hint");
  if (p.keyHint === null) {
    if (keyInput) { keyInput.value = ""; keyInput.placeholder = "No key needed"; keyInput.disabled = true; }
    if (keyHint) keyHint.textContent = "Ollama runs locally — no account or key required.";
  } else {
    if (keyInput) { keyInput.disabled = false; keyInput.placeholder = "Paste your key here"; }
    if (keyHint) keyHint.textContent = p.keyHint;
  }

  gateLmGoTo(2);
}

async function gateLmTestAndSave() {
  const btn = document.getElementById("btn-gate-lm-test");
  const statusEl = document.getElementById("gate-lm-status");
  const key = document.getElementById("gate-api-key")?.value.trim() || "";
  const model = document.getElementById("gate-model")?.value;

  btn.disabled = true;
  btn.textContent = "Testing…";
  if (statusEl) statusEl.innerHTML = "";

  try {
    const result = await api("POST", "/api/v1/setup/llm", {
      provider: _gateLmProvider,
      api_key: key,
      model,
    });
    if (result.success) {
      saveLmConfig(_gateLmProvider, model, key);
      passLmGate();
    } else {
      if (statusEl) statusEl.innerHTML = `<p class="alda-status-msg error">⚠ ${esc(result.message)}</p>`;
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<p class="alda-status-msg error">⚠ ${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Test & connect →";
  }
}

function passLmGate() {
  hideGate("lm");
  if (_lmGateFromScoringGate) {
    _lmGateFromScoringGate = false;
    _startScoringPhase();
    return;
  }
  const appIsHidden = document.getElementById("app")?.classList.contains("hidden");
  if (_lmGateFromSettings) {
    _lmGateFromSettings = false;
    if (!appIsHidden) {
      updateSettingsLmStatus();
      updateTokenEstimate();
    }
  }
  if (appIsHidden) {
    showApp();
  }
}

function cancelLmGate() {
  if (_lmGateFromScoringGate) {
    _lmGateFromScoringGate = false;
    hideGate("lm");
    return;  // scoring gate is still visible underneath
  }
  if (!_lmGateFromSettings) return;
  hideGate("lm");
  _lmGateFromSettings = false;
  openSettings();
}

function openLmGateFromSettings() {
  _lmGateFromSettings = true;
  closeSettings();
  showGate("lm");
  gateLmGoTo(1); // Go straight to provider selection
  const cancelBtn = document.getElementById("btn-gate-lm-cancel");
  if (cancelBtn) cancelBtn.classList.remove("hidden");
}

// ──────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────
async function init() {
  loadSettings();
  initLmGate();

  const backendOk = await initBackend();
  if (!backendOk) return;

  proceedAfterBackend();
}

function proceedAfterBackend() {
  if (!state.lmConfig) {
    showGate("lm");
    gateLmGoTo(0);
    return;
  }
  syncLmToBackend(state.lmConfig);
  showApp();
}

function showApp() {
  document.getElementById("app").classList.remove("hidden");
  // Wire event listeners (safe to call multiple times — using IDs)
  initMission();
  initSearch();
  initResults();
  initUpload();
  initExport();
  initThemes();
  initScrapingToggle();
  restoreState();
  checkHealth();
}

function restoreState() {
  if (state.currentQuery?.query_id) {
    state.queryId = state.currentQuery.query_id;
    state.maxResults = state.currentQuery.max_results || 200;
    // Unlock steps
    setStepState("search", "done");
    setStepState("results", "active");
    loadResults(true);
    showStep("results", true);
  } else {
    showStep("brief", true);
  }
  populateSearchSwitcher();
  loadRecentQueries();
}

// ──────────────────────────────────────────────
// Health check (background refresh)
// ──────────────────────────────────────────────
async function checkHealth() {
  if (!BACKEND_URL) return;
  try {
    const h = await api("GET", "/api/v1/health");
    applyHealthStatus(h);
    updateTokenEstimate();
    appLog("info", "Health check OK",
      `db=${h.db}, lm=${h.llm_configured ? (h.llm_provider + "/" + h.llm_model) : "not configured"}`);
  } catch (e) {
    appLog("error", "Health check failed", e.message);
    setDot("dot-db", "red", `Cannot reach server: ${e.message}`);
  }
}

// ──────────────────────────────────────────────
// Navigation — wizard steps
// ──────────────────────────────────────────────
function showStep(step, skipAnimation = false) {
  const panels = { brief: "panel-brief", search: "panel-search", results: "panel-results" };
  const wizIds = { brief: "wiz-brief", search: "wiz-search", results: "wiz-results" };

  Object.entries(panels).forEach(([key, id]) => {
    document.getElementById(id)?.classList.toggle("hidden", key !== step);
  });

  Object.entries(wizIds).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (key === step) {
      el.classList.remove("disabled");
      el.classList.add("active");
      el.classList.remove("done");
    }
  });
}

function setStepState(step, status) {
  const id = { brief: "wiz-brief", search: "wiz-search", results: "wiz-results" }[step];
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("active", "done", "disabled");
  el.classList.add(status);
}

// ──────────────────────────────────────────────
// Navigation — sub-tabs
// ──────────────────────────────────────────────
function showSubTab(name) {
  document.querySelectorAll(".alda-sub-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sub === name);
  });
  document.querySelectorAll(".alda-sub-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `sub-${name}`);
  });
  if (name === "export") updateExportFilterSummary();
}

// ──────────────────────────────────────────────
// Search history + switcher
// ──────────────────────────────────────────────
function saveCurrentQuery(queryData) {
  state.currentQuery = queryData;
  localStorage.setItem("alda_current_query", JSON.stringify(queryData));
  addToHistory(queryData);
  updateSwitcherBrief();
}

function addToHistory(queryData) {
  const existing = state.searchHistory.findIndex(q => q.query_id === queryData.query_id);
  if (existing !== -1) {
    state.searchHistory[existing] = queryData;
  } else {
    state.searchHistory.unshift(queryData);
    if (state.searchHistory.length > 20) state.searchHistory.pop();
  }
  localStorage.setItem("alda_search_history", JSON.stringify(state.searchHistory));
}

function updateSwitcherBrief() {
  const el = document.getElementById("switcher-brief");
  if (el) {
    const brief = state.currentQuery?.brief || "New search";
    el.textContent = brief.length > 90 ? brief.slice(0, 90) + "…" : brief;
  }
}

function populateSearchSwitcher() {
  const switcher = document.getElementById("search-switcher");
  if (!switcher) return;

  if (state.searchHistory.length === 0) {
    switcher.classList.add("hidden");
    return;
  }

  switcher.classList.remove("hidden");
  updateSwitcherBrief();

  const dropdown = document.getElementById("switcher-dropdown");
  if (!dropdown) return;

  dropdown.innerHTML = state.searchHistory.map((q, i) => {
    const brief = q.brief || "Untitled search";
    const date = q.timestamp ? fmtDate(q.timestamp) : "";
    const isActive = q.query_id === state.currentQuery?.query_id;
    return `
      <div class="alda-switcher-item ${isActive ? "active" : ""}"
           onclick="switchToSearch('${esc(q.query_id)}', ${i})">
        <span class="alda-switcher-item-brief">${esc(brief)}</span>
        <span class="alda-switcher-item-meta">${esc(date)}</span>
      </div>
    `;
  }).join("");
}

function toggleSwitcherDropdown() {
  const dd = document.getElementById("switcher-dropdown");
  if (dd) dd.classList.toggle("hidden");
}

function switchToSearch(queryId, historyIndex) {
  const item = state.searchHistory[historyIndex];
  if (!item) return;

  state.queryId = queryId;
  state.currentQuery = item;
  updateSwitcherBrief();

  document.getElementById("switcher-dropdown")?.classList.add("hidden");
  setStepState("brief", "done");
  setStepState("search", "done");
  setStepState("results", "active");
  showStep("results");
  loadResults(true);
}

function newSearch() {
  document.getElementById("switcher-dropdown")?.classList.add("hidden");
  state.queryId = null;
  state.currentQuery = null;
  document.getElementById("mission-text").value = "";
  document.getElementById("brief-preview")?.classList.add("hidden");
  document.getElementById("brief-content").innerHTML = "";
  showStatus("parse-status", "");

  // Reset wizard
  setStepState("brief", "active");
  setStepState("search", "disabled");
  setStepState("results", "disabled");
  showStep("brief");

  const el = document.getElementById("switcher-brief");
  if (el) el.textContent = "New search";
}

// Close switcher dropdown on outside click
document.addEventListener("click", (e) => {
  const switcher = document.getElementById("search-switcher");
  if (switcher && !switcher.contains(e.target)) {
    document.getElementById("switcher-dropdown")?.classList.add("hidden");
  }
});

// ──────────────────────────────────────────────
// Mission / Brief
// ──────────────────────────────────────────────
function initMission() {
  document.getElementById("btn-parse")
    ?.addEventListener("click", parseMission);
  document.getElementById("btn-go-search")
    ?.addEventListener("click", () => showStep("search"));
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
    appLog("info", "Brief parsed", `query_id=${result.query_id}, topic="${result.structured.topic}"`);

    renderBrief(result.structured);
    showStatus("parse-status", "Done — review the summary below, then run your search.", "success");

    // Persist and unlock step 2
    saveCurrentQuery({
      query_id: result.query_id,
      brief: text,
      timestamp: new Date().toISOString(),
      status: "pending",
      max_results: state.maxResults,
    });

    setStepState("brief", "done");
    setStepState("search", "active");
    setStepState("results", "disabled");

    updateTokenEstimate();
    loadRecentQueries();
  } catch (e) {
    appLog("error", "Parse brief failed", e.message);
    if (e.message === "llm_not_configured") {
      const el = document.getElementById("parse-status");
      if (el) el.innerHTML =
        `<span class="alda-status-msg error">A language model is required to parse research briefs.
           <button class="alda-btn alda-btn-secondary alda-btn-sm" style="margin-left:0.5rem" onclick="openLmGateFromSettings()">
             Configure language model →
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
    <p class="alda-field-help">Not quite right? Edit your question above and click Parse Brief again.</p>
  `;
  document.getElementById("brief-preview")?.classList.remove("hidden");
}

async function loadRecentQueries() {
  try {
    const queries = await api("GET", "/api/v1/mission/");
    if (!queries.length) return;
    const list = queries.map(q => `
      <div class="result-card" style="cursor:pointer" data-qid="${esc(q.id)}">
        <div class="result-meta">${fmtDate(q.timestamp)} — ${JOB_STATUS_LABELS[q.status] || q.status}</div>
        <div>${esc(q.query_text.slice(0, 160))}${q.query_text.length > 160 ? "…" : ""}</div>
      </div>
    `).join("");
    document.getElementById("recent-queries-list").innerHTML = list;
    document.getElementById("recent-queries-section")?.classList.remove("hidden");
    document.querySelectorAll("[data-qid]").forEach(el => {
      el.addEventListener("click", () => {
        state.queryId = el.dataset.qid;
        showStatus("parse-status", "Previous search loaded. You can run a new search or go to Results.", "success");
        setStepState("brief", "done");
        setStepState("search", "active");
      });
    });
  } catch (_) {}
}

// ──────────────────────────────────────────────
// Token estimate
// ──────────────────────────────────────────────
function updateTokenEstimate() {
  const el = document.getElementById("token-estimate");
  const textEl = document.getElementById("token-estimate-text");
  if (!el || !textEl) return;

  const useLm = document.getElementById("use-lm");
  if (!state.lmProvider || !state.lmModel || (useLm && !useLm.checked)) {
    el.classList.add("hidden");
    return;
  }

  const n = state.maxResults;
  const totalIn  = n * TOKENS_IN_PER_SOURCE;
  const totalOut = n * TOKENS_OUT_PER_SOURCE;
  const totalTokens = totalIn + totalOut;
  const key = `${state.lmProvider}/${state.lmModel}`;
  const pricing = TOKEN_PRICING[key];

  if (pricing) {
    const cost = (totalIn / 1000 * pricing[0]) + (totalOut / 1000 * pricing[1]);
    const costStr = cost < 0.01 ? "<$0.01" : `~$${cost.toFixed(2)}`;
    textEl.innerHTML =
      `<strong>Estimated language model scoring cost:</strong> ${costStr} ` +
      `<span class="alda-status-msg">(~${(totalTokens / 1000).toFixed(0)}k tokens for up to ${n} sources ` +
      `using ${esc(state.lmModel)})</span>`;
  } else {
    textEl.innerHTML =
      `<strong>Language model scoring:</strong> ~${(totalTokens / 1000).toFixed(0)}k tokens estimated ` +
      `for up to ${n} sources`;
  }
  el.classList.remove("hidden");
}

function budgetToTokens(dollars) {
  if (!dollars || isNaN(dollars) || dollars <= 0) return null;
  const key = `${state.lmProvider}/${state.lmModel}`;
  const pricing = TOKEN_PRICING[key];
  if (!pricing) return Math.round(dollars * 5000);
  const avgPricePer1k = (pricing[0] + pricing[1]) / 2;
  return Math.round((dollars / avgPricePer1k) * 1000);
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────
function initSearch() {
  document.getElementById("btn-search")?.addEventListener("click", startSearch);
  document.getElementById("use-lm")?.addEventListener("change", updateTokenEstimate);
}

async function startSearch() {
  if (!state.queryId) {
    document.getElementById("no-query-warn")?.classList.remove("hidden");
    document.getElementById("search-form")?.classList.add("hidden");
    return;
  }
  document.getElementById("no-query-warn")?.classList.add("hidden");
  document.getElementById("search-form")?.classList.remove("hidden");

  const sources = [...document.querySelectorAll('input[name="source"]:checked')].map(el => el.value);
  const useLm = document.getElementById("use-lm")?.checked ?? true;
  const budgetDollars = parseFloat(document.getElementById("token-budget-dollars")?.value) || 0;
  const maxTokenBudget = budgetDollars > 0 ? budgetToTokens(budgetDollars) : null;

  showStatus("search-status-msg", "Starting…");
  try {
    const result = await api("POST", "/api/v1/search/start", {
      query_id: state.queryId,
      sources,
      use_llm_relevance: useLm,
      max_token_budget: maxTokenBudget,
      max_results: state.defaultMaxResults || null,
    });
    state.jobId = result.job_id;
    state.pollErrorCount = 0;
    appLog("info", "Search started", `job_id=${result.job_id}, sources=${sources.join(",")}`);

    document.getElementById("search-progress")?.classList.remove("hidden");
    document.getElementById("scoring-gate")?.classList.add("hidden");
    const btn = document.getElementById("btn-search");
    if (btn) { btn.disabled = true; btn.textContent = "Searching…"; }
    // Show animated progress immediately before the first poll returns
    updateProgress({ job_id: result.job_id, query_id: state.queryId, status: "pending",
      progress: { total_sources_found: 0, new_this_iteration: 0, current_iteration: 0,
        source_breakdown: {}, tokens_used: 0, saturation_reached: false } });
    startPolling();
    showStatus("search-status-msg", "");
  } catch (e) {
    showStatus("search-status-msg", `Could not start search: ${e.message}`, "error");
  }
}

function startPolling() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollErrorCount = 0;
  state.pollInFlight = false;
  document.getElementById("btn-abandon-job")?.classList.remove("hidden");
  state.pollInterval = setInterval(pollStatus, 2000);
}

async function pollStatus() {
  if (!state.jobId || state.pollInFlight) return;
  if (document.visibilityState === "hidden") return;
  state.pollInFlight = true;
  try {
    const job = await api("GET", `/api/v1/search/status/${state.jobId}`);
    state.pollErrorCount = 0;
    updateProgress(job);
    showStatus("search-status-msg", "");

    if (["complete", "saturated", "failed", "awaiting_scoring"].includes(job.status)) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      document.getElementById("btn-abandon-job")?.classList.add("hidden");

      appLog("info", `Search ${state.jobId} reached status`, `${job.status}, sources=${job.progress.total_sources_found}`);

      if (job.status === "failed") {
        const btn = document.getElementById("btn-search");
        if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
        const errMsg = job.progress.error || "unknown error";
        appLog("error", "Search failed", errMsg);
        showStatus("search-status-msg", `Search failed: ${errMsg}`, "error");
      } else if (job.status === "awaiting_scoring") {
        showScoringGate(job);
      } else {
        const btn = document.getElementById("btn-search");
        if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
        const total = job.progress.total_sources_found;
        showStatus("search-status-msg",
          `Found ${total} source${total !== 1 ? "s" : ""}. Going to results…`, "success");

        if (state.currentQuery) {
          saveCurrentQuery({ ...state.currentQuery, status: job.status, result_count: total });
        }
        setStepState("brief", "done");
        setStepState("search", "done");
        setStepState("results", "active");

        setTimeout(() => { showStep("results"); loadResults(true); }, 900);
      }
    }
  } catch (e) {
    state.pollErrorCount++;
    appLog("error", `Poll attempt ${state.pollErrorCount} failed`, e.message);
    if (isNetworkDown(e.message)) {
      // Server is offline or sleeping — stop polling and start wake sequence
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      wakeAndResume();
    } else if (e.message === "Job not found") {
      // Server is up but has no memory of this job (restart wiped _jobs).
      // Check if results were already saved and recover silently.
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      recoverFromLostJob();
    } else if (state.pollErrorCount >= 5) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      document.getElementById("btn-abandon-job")?.classList.add("hidden");
      const btn = document.getElementById("btn-search");
      if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
      const statusEl = document.getElementById("search-status-msg");
      if (statusEl) statusEl.innerHTML =
        `<span class="alda-status-msg error">Lost connection to server. </span>` +
        `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="retryPoll()">Reconnect</button> ` +
        `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="abandonJob()">View results</button> ` +
        `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="openLogModal()">View log</button>`;
    } else {
      showStatus("search-status-msg",
        `Connection issue (attempt ${state.pollErrorCount}/5): ${e.message}`, "error");
    }
  } finally {
    state.pollInFlight = false;
  }
}

async function recoverFromLostJob() {
  if (!state.queryId) return;
  showStatus("search-status-msg", "Server restarted — checking for saved results…");
  appLog("info", "Job not found in server memory — checking DB for results", state.queryId);
  document.getElementById("btn-abandon-job")?.classList.add("hidden");
  try {
    const counts = await api("GET", `/api/v1/search/results/${state.queryId}/count`);
    const btn = document.getElementById("btn-search");
    if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
    if (counts.total > 0) {
      appLog("info", "Recovered results after server restart", `${counts.total} sources found`);
      if (state.currentQuery) {
        saveCurrentQuery({ ...state.currentQuery, status: "complete", result_count: counts.total });
      }
      setStepState("brief", "done");
      setStepState("search", "done");
      setStepState("results", "active");
      showStatus("search-status-msg",
        `Found ${counts.total} saved result${counts.total !== 1 ? "s" : ""} — going to results…`, "success");
      setTimeout(() => { showStep("results"); loadResults(true); }, 900);
    } else {
      appLog("error", "Server restarted and no results were saved", "search will need to be re-run");
      const statusEl = document.getElementById("search-status-msg");
      if (statusEl) statusEl.innerHTML =
        `<span class="alda-status-msg error">Server restarted and the search was lost (no results saved). </span>` +
        `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="startSearch()">Re-run search</button>`;
    }
  } catch (_) {
    showStatus("search-status-msg", "Server restarted — could not recover results.", "error");
  }
}

function isNetworkDown(msg) {
  return msg === "Failed to fetch" || /^HTTP 5/.test(msg);
}

async function abandonJob() {
  clearInterval(state.pollInterval);
  state.pollInterval = null;
  if (_wakeTimer) { clearTimeout(_wakeTimer); _wakeTimer = null; }
  state.pollInFlight = false;
  state.pollErrorCount = 0;
  state.jobId = null;

  document.getElementById("btn-abandon-job")?.classList.add("hidden");
  document.getElementById("scoring-gate")?.classList.add("hidden");
  const btn = document.getElementById("btn-search");
  if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }

  if (!state.queryId) {
    showStatus("search-status-msg", "Search stopped.");
    document.getElementById("search-progress")?.classList.add("hidden");
    return;
  }

  showStatus("search-status-msg", "Checking for saved results…");
  try {
    const counts = await api("GET", `/api/v1/search/results/${state.queryId}/count`);
    if (counts.total > 0) {
      appLog("info", "Stopped search — navigating to partial results", `${counts.total} sources`);
      setStepState("results", "active");
      showStatus("search-status-msg",
        `Stopped. Showing ${counts.total} result${counts.total !== 1 ? "s" : ""} found so far.`, "success");
      setTimeout(() => { showStep("results"); loadResults(true); }, 600);
    } else {
      document.getElementById("search-progress")?.classList.add("hidden");
      showStatus("search-status-msg", "Search stopped. No results saved yet.");
    }
  } catch (_) {
    document.getElementById("search-progress")?.classList.add("hidden");
    showStatus("search-status-msg", "Search stopped.");
  }
}

// Wake a sleeping Render instance by pinging /health, then resume polling.
let _wakeTimer = null;
function wakeAndResume() {
  if (!state.jobId) return;
  if (_wakeTimer) { clearTimeout(_wakeTimer); _wakeTimer = null; }
  clearInterval(state.pollInterval);
  state.pollInterval = null;
  state.pollInFlight = false;

  const MAX_ATTEMPTS = 18; // 5s × 18 = 90s

  appLog("info", "Server appears offline — sending wake-up request", state.jobId);

  const tryWake = async (attempt) => {
    if (!state.jobId) return;
    const secsLeft = (MAX_ATTEMPTS - attempt) * 5;
    const statusEl = document.getElementById("search-status-msg");
    if (statusEl) statusEl.innerHTML = attempt === 0
      ? `<span class="alda-status-msg">Server offline — sending wake-up request…</span>`
      : `<span class="alda-status-msg">Waiting for server to wake up… (${secsLeft}s remaining) ` +
        `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="wakeAndResume()">Retry now</button></span>`;
    try {
      await api("GET", "/api/v1/health");
      _wakeTimer = null;
      appLog("info", "Server woke up — resuming poll", `after ${attempt + 1} attempt(s)`);
      state.pollErrorCount = 0;
      const btn = document.getElementById("btn-search");
      if (btn) { btn.disabled = true; btn.textContent = "Searching…"; }
      startPolling();
    } catch (_) {
      if (attempt + 1 >= MAX_ATTEMPTS) {
        _wakeTimer = null;
        document.getElementById("btn-abandon-job")?.classList.add("hidden");
        appLog("error", "Server did not wake up within 90s", "");
        const statusEl = document.getElementById("search-status-msg");
        if (statusEl) statusEl.innerHTML =
          `<span class="alda-status-msg error">Server did not respond after 90s. </span>` +
          `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="wakeAndResume()">Try again</button> ` +
          `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="abandonJob()">View results</button> ` +
          `<button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="openLogModal()">View log</button>`;
        const btn = document.getElementById("btn-search");
        if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
      } else {
        _wakeTimer = setTimeout(() => tryWake(attempt + 1), 5000);
      }
    }
  };

  tryWake(0);
}

// Resume polling when browser tab becomes visible again (e.g. after PC sleep or phone lock)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.jobId) return;
  if (state.pollInterval) {
    // Active poll: reset error count so a brief network blip on wake doesn't kill it
    state.pollErrorCount = 0;
    state.pollInFlight = false;
  } else {
    // Polling was stopped — wake the server and resume
    wakeAndResume();
  }
});

function retryPoll() {
  if (!state.jobId) return;
  state.pollErrorCount = 0;
  appLog("info", "Retrying poll for job", state.jobId);
  wakeAndResume();
}

function updateProgress(job) {
  const p = job.progress;
  const isActive = ["pending", "running", "scoring"].includes(job.status);
  const hasResults = p.total_sources_found > 0;

  // Progress bar — indeterminate slide while no results yet, real fill once results arrive
  const fill = document.getElementById("search-progress-fill");
  if (fill) {
    if (isActive && !hasResults) {
      fill.classList.add("indeterminate");
      fill.style.width = "";
    } else {
      fill.classList.remove("indeterminate");
      const pct = Math.min(
        Math.round((p.total_sources_found / Math.max(p.total_sources_found + 20, 100)) * 100),
        95,
      );
      fill.style.width = pct + "%";
    }
  }

  // Status text
  const label = JOB_STATUS_LABELS[job.status] || job.status;
  const statsEl = document.getElementById("search-stats");
  if (statsEl) {
    if (job.status === "scoring") {
      statsEl.innerHTML =
        `<strong>Running relevance analysis…</strong> — scoring <strong>${p.total_sources_found}</strong> source${p.total_sources_found !== 1 ? "s" : ""}.`;
    } else if (!hasResults && isActive) {
      const n = document.querySelectorAll('input[name="source"]:checked').length;
      statsEl.innerHTML = `<strong>${label}</strong> — Searching across ${n} database${n !== 1 ? "s" : ""}…`;
    } else if (hasResults) {
      const passNote = p.current_iteration > 0 ? ` · Pass ${p.current_iteration}` : "";
      const newNote = p.new_this_iteration > 0
        ? ` · ${p.new_this_iteration} new this pass`
        : isActive ? " · checking for more…" : "";
      statsEl.innerHTML =
        `<strong>${label}</strong>${passNote} — <strong>${p.total_sources_found}</strong> sources found${newNote}.`;
    } else {
      statsEl.innerHTML = `<strong>${label}</strong>`;
    }
  }

  // Per-source tile grid — all selected sources shown; results highlighted, others pulsing
  const selected = [...document.querySelectorAll('input[name="source"]:checked')].map(el => el.value);
  const bd = p.source_breakdown || {};
  const tiles = selected.map(src => {
    const name = SOURCE_NAMES[src] || src;
    const count = bd[src] ?? null;
    if (count > 0) {
      return `<span class="src-tile has-results">${esc(name)}<span class="src-tile-count">${count}</span></span>`;
    }
    if (isActive) {
      return `<span class="src-tile">${esc(name)}<span class="src-tile-waiting">…</span></span>`;
    }
    return `<span class="src-tile">${esc(name)}<span class="src-tile-count" style="color:var(--alda-text-muted)">0</span></span>`;
  }).join("");

  let tokenNote = "";
  if (p.tokens_used > 0) {
    const key = `${state.lmProvider}/${state.lmModel}`;
    const pricing = TOKEN_PRICING[key];
    if (pricing) {
      const cost = (p.tokens_used / 1000) * ((pricing[0] + pricing[1]) / 2);
      tokenNote = `<div class="alda-status-msg" style="margin-top:0.3rem;font-size:0.8rem">Language model scoring: ${p.tokens_used.toLocaleString()} tokens (~$${cost < 0.01 ? "<0.01" : cost.toFixed(2)})</div>`;
    } else {
      tokenNote = `<div class="alda-status-msg" style="margin-top:0.3rem;font-size:0.8rem">Language model scoring: ${p.tokens_used.toLocaleString()} tokens used</div>`;
    }
  }

  const breakdownEl = document.getElementById("source-breakdown");
  if (breakdownEl) breakdownEl.innerHTML =
    (tiles ? `<div class="source-status-grid">${tiles}</div>` : "") + tokenNote;
}

// ──────────────────────────────────────────────
// Scoring gate
// ──────────────────────────────────────────────
function showScoringGate(job) {
  const p = job.progress;
  const total = p.total_sources_found;
  const bd = p.source_breakdown || {};

  // Build two-column table sorted by count descending
  const rows = Object.entries(bd)
    .sort(([, a], [, b]) => b - a)
    .map(([src, count]) => {
      const name = SOURCE_NAMES[src] || src;
      return `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:700">${count}</td></tr>`;
    }).join("");

  const runBtn = `<button class="alda-btn alda-btn-primary" onclick="runScoring()">Run relevance analysis</button>`;

  const gate = document.getElementById("scoring-gate");
  if (!gate) return;
  gate.classList.remove("hidden");
  gate.innerHTML =
    `<p><strong>${total}</strong> source${total !== 1 ? "s" : ""} found. ` +
    `Would you like the language model to score each source for relevance to your research question?</p>` +
    (rows
      ? `<table class="prisma-table" style="margin:0.75rem 0;max-width:28rem">
           <thead><tr><th>Source</th><th style="text-align:right">Found</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : "") +
    `<div class="alda-btn-row" style="margin-top:1rem">
       ${runBtn}
       <button class="alda-btn alda-btn-secondary" onclick="skipScoring()">Skip — go to results</button>
     </div>`;

  // Reset search button so user can re-run if they want
  const btn = document.getElementById("btn-search");
  if (btn) { btn.disabled = false; btn.textContent = "Start Search"; }
}

async function runScoring() {
  if (!state.lmProvider || !state.lmModel) {
    // LLM not configured — open the setup wizard; passLmGate will call _startScoringPhase
    _lmGateFromScoringGate = true;
    showGate("lm");
    gateLmGoTo(1);
    return;
  }
  await _startScoringPhase();
}

async function _startScoringPhase() {
  // Disable buttons to prevent double-click during API call
  document.getElementById("scoring-gate")?.querySelectorAll("button")
    .forEach(b => { b.disabled = true; });
  try {
    await api("POST", `/api/v1/search/score/${state.jobId}`);
    appLog("info", "Relevance scoring started", state.jobId);
    if (state.pollInterval) clearInterval(state.pollInterval);
    state.pollErrorCount = 0;
    state.pollInFlight = false;
    document.getElementById("scoring-gate")?.classList.add("hidden");
    document.getElementById("search-progress")?.classList.remove("hidden");
    state.pollInterval = setInterval(pollStatus, 2000);
  } catch (e) {
    appLog("error", "Failed to start scoring", e.message);
    document.getElementById("scoring-gate")?.querySelectorAll("button")
      .forEach(b => { b.disabled = false; });
    showStatus("search-status-msg", `Could not start relevance analysis: ${e.message}`, "error");
  }
}

async function skipScoring() {
  try {
    await api("POST", `/api/v1/search/score/${state.jobId}/skip`);
    appLog("info", "Relevance scoring skipped", state.jobId);
    document.getElementById("scoring-gate")?.classList.add("hidden");
    if (state.currentQuery) {
      saveCurrentQuery({ ...state.currentQuery, status: "complete" });
    }
    setStepState("brief", "done");
    setStepState("search", "done");
    setStepState("results", "active");
    setTimeout(() => { showStep("results"); loadResults(true); }, 300);
  } catch (e) {
    appLog("error", "Failed to skip scoring", e.message);
    showStatus("search-status-msg", `Could not skip: ${e.message}`, "error");
  }
}

// ──────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────
function initResults() {
  document.getElementById("btn-filter")?.addEventListener("click", () => { state.resultsPage = 1; loadResults(true); });
  document.getElementById("btn-clear-filters")?.addEventListener("click", () => {
    const t = document.getElementById("filter-type");
    const s = document.getElementById("filter-sort");
    const r = document.getElementById("filter-relevance");
    const v = document.getElementById("relevance-val");
    const ps = document.getElementById("filter-page-size");
    if (t) t.value = "all";
    if (s) s.value = "relevance";
    if (r) r.value = "0";
    if (v) v.textContent = "0%";
    if (ps) ps.value = "50";
    state.resultsPage = 1;
    loadResults(true);
  });
  document.getElementById("btn-load-more")?.addEventListener("click", () => { state.resultsPage++; loadResults(false); });
  document.getElementById("filter-relevance")?.addEventListener("input", function () {
    const el = document.getElementById("relevance-val");
    if (el) el.textContent = `${this.value}%`;
  });
}

async function loadResults(reset = false) {
  if (!state.queryId) return;
  if (reset) {
    state.resultsPage = 1;
    document.getElementById("results-list").innerHTML = "";
  }

  const type     = document.getElementById("filter-type")?.value || "all";
  const sort     = document.getElementById("filter-sort")?.value || "relevance";
  const minRel   = ((parseInt(document.getElementById("filter-relevance")?.value || "0", 10)) / 100).toFixed(2);
  const pageSize = parseInt(document.getElementById("filter-page-size")?.value || "50", 10);
  const filtersActive = type !== "all" || parseFloat(minRel) > 0;

  try {
    const [sources, counts] = await Promise.all([
      api("GET",
        `/api/v1/search/results/${state.queryId}?page=${state.resultsPage}&page_size=${pageSize}` +
        `&sort_by=${sort}&source_type=${type}&min_relevance=${minRel}`
      ),
      api("GET",
        `/api/v1/search/results/${state.queryId}/count` +
        `?source_type=${type}&min_relevance=${minRel}`
      ).catch(err => {
        appLog("warn", "Count endpoint failed (non-fatal)", err.message);
        return { filtered: null, total: null };
      }),
    ]);

    appLog("info", "Results loaded",
      `sources=${sources.length}, filtered=${counts.filtered}, total=${counts.total}, queryId=${state.queryId}`);

    if (reset) document.getElementById("results-list").innerHTML = "";

    // Determine whether there are any results at all for this query (unfiltered).
    // Prefer what the count endpoint says; fall back to sources.length if count failed.
    const hasAnyResults = counts.total > 0 || sources.length > 0;

    if (!hasAnyResults && state.resultsPage === 1) {
      document.getElementById("results-list").innerHTML = `
        <div class="empty-state">
          <p>No results yet.</p>
          <p>Go to <strong>Step 2: Search</strong> to run a search, or use <strong>Upload Sources</strong> to add your own.</p>
          <button class="alda-btn alda-btn-secondary" style="margin-top:0.75rem" onclick="showStep('search')">Run a search →</button>
        </div>`;
      document.getElementById("results-count").textContent = "";
      document.getElementById("load-more-row").style.display = "none";
      return;
    }

    if (!sources.length && state.resultsPage === 1) {
      const totalLabel = counts.total != null ? counts.total : "?";
      document.getElementById("results-list").innerHTML = `
        <div class="empty-state">
          <p>No results match your current filters.</p>
          <button class="alda-btn alda-btn-secondary" style="margin-top:0.75rem"
            onclick="document.getElementById('btn-clear-filters').click()">Clear filters</button>
        </div>`;
      document.getElementById("results-count").textContent =
        `0 of ${totalLabel} result${counts.total !== 1 ? "s" : ""}`;
      document.getElementById("load-more-row").style.display = "none";
      return;
    }

    const total    = counts.total    ?? sources.length;
    const filtered = counts.filtered ?? sources.length;
    const shown    = (state.resultsPage - 1) * pageSize + sources.length;
    document.getElementById("results-count").textContent = filtersActive
      ? `${filtered} of ${total} result${total !== 1 ? "s" : ""} (filtered)`
      : `${total} result${total !== 1 ? "s" : ""}`;

    const cards = sources.map(renderSourceCard).join("");
    document.getElementById("results-list").insertAdjacentHTML("beforeend", cards);
    document.getElementById("load-more-row").style.display = shown < filtered ? "flex" : "none";

    document.querySelectorAll(".result-abstract").forEach(el => {
      el.addEventListener("click", () => el.classList.toggle("expanded"));
    });
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
        · ${doiLink}<a href="${esc(src.url)}" target="_blank" rel="noopener">Open source ↗</a>
      </div>
      ${src.abstract ? `<div class="result-abstract">${esc(src.abstract)}</div>` : ""}
      ${translationBlock}
    </div>
  `;
}

function relevanceBadge(score) {
  const pct = Math.round(score * 100);
  const cls = score >= 0.7 ? "relevance-high" : score >= 0.4 ? "relevance-medium" : "relevance-low";
  const tip = `Relevance: ${pct}% — how closely this source matches your research question.`;
  return `<span class="relevance-badge ${cls}" title="${esc(tip)}">${pct}%</span>`;
}

// ──────────────────────────────────────────────
// Upload
// ──────────────────────────────────────────────
function initUpload() {
  const dz = document.getElementById("drop-zone");
  const fi = document.getElementById("file-input");
  if (!dz || !fi) return;

  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  fi.addEventListener("change", () => { if (fi.files[0]) setFile(fi.files[0]); });
  document.getElementById("btn-upload")?.addEventListener("click", doUpload);
}

function setFile(file) {
  state.pendingFile = file;
  const el = document.getElementById("upload-file-name");
  if (el) el.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  const btn = document.getElementById("btn-upload");
  if (btn) btn.disabled = false;
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
    const n = result.records_inserted;
    const dups = result.records_skipped_duplicate;
    const el = document.getElementById("upload-result");
    el.className = `upload-result ${result.errors?.length ? "has-errors" : "success"}`;
    el.innerHTML = `
      <p><strong>${n} source${n !== 1 ? "s" : ""} added.</strong>
      ${dups > 0 ? `${dups} duplicate${dups !== 1 ? "s" : ""} skipped.` : ""}</p>
      ${result.errors?.length
        ? `<details><summary>Problems with ${result.errors.length} row${result.errors.length !== 1 ? "s" : ""}</summary>
           <ul>${result.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>`
        : ""}
      ${n > 0 ? `<p><button class="alda-btn alda-btn-secondary alda-btn-sm" onclick="showSubTab('results');loadResults(true)">View results →</button></p>` : ""}
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
  document.getElementById("btn-export")?.addEventListener("click", doExport);
  document.getElementById("btn-prisma")?.addEventListener("click", loadPrisma);
  document.getElementById("export-apply-filters")?.addEventListener("change", updateExportFilterSummary);
}

function updateExportFilterSummary() {
  const applyEl  = document.getElementById("export-apply-filters");
  const summaryEl = document.getElementById("export-filter-summary");
  if (!summaryEl) return;
  if (!applyEl?.checked) {
    summaryEl.textContent = "Exports all results for this search.";
    return;
  }
  const type   = document.getElementById("filter-type")?.value || "all";
  const minRel = parseInt(document.getElementById("filter-relevance")?.value || "0", 10);
  const sort   = document.getElementById("filter-sort")?.value || "relevance";
  const parts = [];
  if (type !== "all") parts.push(type === "academic" ? "academic papers only" : type === "grey" ? "web sources only" : "uploaded sources only");
  if (minRel > 0)     parts.push(`relevance ≥ ${minRel}%`);
  if (sort !== "relevance") parts.push(`sorted by ${sort.replace("_", " ")}`);
  summaryEl.textContent = parts.length
    ? `Filters: ${parts.join(", ")}.`
    : "No filters active — exports all results for this search.";
}

async function doExport() {
  const fmt          = document.querySelector('input[name="export-format"]:checked')?.value || "csv";
  const currentOnly  = document.getElementById("export-current-query")?.checked ?? true;
  const applyFilters = document.getElementById("export-apply-filters")?.checked ?? true;

  const body = { format: fmt };
  if (currentOnly && state.queryId) body.query_id = state.queryId;

  if (applyFilters && state.queryId) {
    body.source_type   = document.getElementById("filter-type")?.value || "all";
    body.min_relevance = (parseInt(document.getElementById("filter-relevance")?.value || "0", 10)) / 100;
    body.sort_by       = document.getElementById("filter-sort")?.value || "relevance";
  }

  const btn = document.getElementById("btn-export");
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const blob = await api("POST", "/api/v1/export/", body);
    downloadBlob(blob, `alda_export_${Date.now()}.${fmt === "csv" ? "csv" : "json"}`);
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
      `<p class="alda-field-help">Please run a search first, then come back here to generate the PRISMA table.</p>`;
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
      <p class="alda-field-help" style="margin-top:0.75rem">Copy this table into your methods section.</p>
    `;
  } catch (e) {
    document.getElementById("prisma-stats").innerHTML =
      `<p class="alda-status-msg error">Could not load statistics: ${esc(e.message)}</p>`;
  }
}

// ──────────────────────────────────────────────
// Themes
// ──────────────────────────────────────────────
function initThemes() {
  document.getElementById("btn-cluster")?.addEventListener("click", runClustering);
}

async function runClustering() {
  if (!state.queryId) {
    showStatus("cluster-status", "Please run a search first.", "error");
    return;
  }
  const btn = document.getElementById("btn-cluster");
  btn.disabled = true;
  showStatus("cluster-status", "Grouping sources into themes…");
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
      } catch (_) { clearInterval(interval); btn.disabled = false; }
    }, 2000);
  } catch (e) {
    btn.disabled = false;
    showStatus("cluster-status", `Could not start: ${e.message}`, "error");
  }
}

async function loadThemes() {
  if (!state.queryId) return;
  const container = document.getElementById("theme-cloud");
  try {
    const themes = await api("GET", `/api/v1/themes/${state.queryId}`);
    if (!themes.length) {
      container.innerHTML = `<div class="empty-state"><p>No themes found. Run a search first, then click Find Themes.</p></div>`;
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
      `<p class="theme-legend">Tag size = number of sources in that theme. Click a tag to filter results.</p>` +
      `<div class="theme-cloud">${cloud}</div>`;

    container.querySelectorAll(".theme-tag").forEach(tag => {
      tag.addEventListener("click", () => {
        showSubTab("results");
        loadResults(true);
      });
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Could not load themes: ${esc(e.message)}</p></div>`;
  }
}

// ──────────────────────────────────────────────
// Web scraping toggle
// ──────────────────────────────────────────────
async function initScrapingToggle() {
  try {
    const st = await api("GET", "/api/v1/setup/scraping");
    const cb = document.getElementById("use-scraping");
    if (cb) cb.checked = st.enabled;
  } catch (_) {}
  document.getElementById("use-scraping")?.addEventListener("change", onScrapingToggle);
}

async function onScrapingToggle(e) {
  const cb = e.target;
  const enabling = cb.checked;
  if (!enabling) {
    try {
      await api("POST", "/api/v1/setup/scraping", { enabled: false });
      appLog("info", "Web scraping disabled");
    } catch (_) {
      cb.checked = true; // revert
    }
    return;
  }
  // Enabling: backend will tell us if Chromium needs installing
  cb.checked = false; // optimistically revert until confirmed
  try {
    const res = await api("POST", "/api/v1/setup/scraping", { enabled: true });
    if (res.needs_install) {
      document.getElementById("modal-chromium-install")?.classList.remove("hidden");
    } else {
      cb.checked = true;
      appLog("info", "Web scraping enabled");
    }
  } catch (_) {}
}

let _chromiumJobId = null;
let _chromiumPollInterval = null;

async function cancelChromiumInstall() {
  document.getElementById("modal-chromium-install")?.classList.add("hidden");
  // Reset modal state for next time
  const progress = document.getElementById("chromium-install-progress");
  const btns = document.getElementById("chromium-install-btns");
  const btn = document.getElementById("btn-proceed-chromium");
  if (progress) progress.classList.add("hidden");
  if (btns) btns.classList.remove("hidden");
  if (btn) { btn.disabled = false; btn.textContent = "Download & Install"; }
  if (_chromiumPollInterval) { clearInterval(_chromiumPollInterval); _chromiumPollInterval = null; }
  _chromiumJobId = null;
}

async function proceedChromiumInstall() {
  const btn = document.getElementById("btn-proceed-chromium");
  const progress = document.getElementById("chromium-install-progress");
  const btns = document.getElementById("chromium-install-btns");
  const msg = document.getElementById("chromium-install-msg");
  if (btn) { btn.disabled = true; btn.textContent = "Installing…"; }
  if (btns) btns.classList.add("hidden");
  if (progress) progress.classList.remove("hidden");
  if (msg) msg.textContent = "Downloading Chromium (~150 MB)…";
  try {
    const res = await api("POST", "/api/v1/setup/scraping/install-chromium");
    _chromiumJobId = res.job_id;
    _chromiumPollInterval = setInterval(pollChromiumInstall, 2000);
  } catch (e) {
    if (msg) msg.textContent = `Install failed: ${esc(e.message)}`;
    if (btn) { btn.disabled = false; btn.textContent = "Download & Install"; }
    if (btns) btns.classList.remove("hidden");
    if (progress) progress.classList.add("hidden");
  }
}

async function pollChromiumInstall() {
  if (!_chromiumJobId) return;
  try {
    const st = await api("GET", `/api/v1/setup/scraping/install-status/${_chromiumJobId}`);
    const msg = document.getElementById("chromium-install-msg");
    if (st.status === "complete") {
      clearInterval(_chromiumPollInterval);
      _chromiumPollInterval = null;
      // Now actually enable scraping
      await api("POST", "/api/v1/setup/scraping", { enabled: true });
      const cb = document.getElementById("use-scraping");
      if (cb) cb.checked = true;
      appLog("info", "Chromium installed — web scraping enabled");
      document.getElementById("modal-chromium-install")?.classList.add("hidden");
    } else if (st.status === "failed") {
      clearInterval(_chromiumPollInterval);
      _chromiumPollInterval = null;
      if (msg) msg.textContent = `Install failed: ${esc(st.message || "unknown error")}`;
      const btns = document.getElementById("chromium-install-btns");
      const btn = document.getElementById("btn-proceed-chromium");
      if (btns) btns.classList.remove("hidden");
      if (btn) { btn.disabled = false; btn.textContent = "Retry"; }
    } else {
      if (msg) msg.textContent = st.message || "Downloading…";
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────
// Settings modal
// ──────────────────────────────────────────────
let _settingsMaxResults = 500;

function loadSettings() {
  const saved = localStorage.getItem("alda_max_results");
  _settingsMaxResults = saved !== null ? parseInt(saved, 10) : 500;
  state.defaultMaxResults = _settingsMaxResults;

  const useLmDefault = localStorage.getItem("alda_use_lm_default");
  if (useLmDefault !== null) {
    const el = document.getElementById("use-lm");
    if (el) el.checked = useLmDefault !== "false";
  }

  const budget = localStorage.getItem("alda_budget_default");
  if (budget) {
    const el = document.getElementById("token-budget-dollars");
    if (el && !el.value) el.value = budget;
  }
}

function openSettings() {
  _applyMaxResultsPills(_settingsMaxResults);

  const useLmEl = document.getElementById("settings-use-lm");
  if (useLmEl) {
    const saved = localStorage.getItem("alda_use_lm_default");
    useLmEl.checked = saved === null ? true : saved !== "false";
  }

  const budgetEl = document.getElementById("settings-budget");
  if (budgetEl) budgetEl.value = localStorage.getItem("alda_budget_default") || "";

  updateSettingsLmStatus();

  const urlEl = document.getElementById("settings-backend-url");
  if (urlEl) urlEl.value = localStorage.getItem("alda_backend_url") || "";

  api("GET", "/api/v1/setup/keys").then(data => {
    _setKeyStatus("key-status-semantic", data.semantic_scholar);
    _setKeyStatus("key-status-core", data.core);
    _setKeyStatus("key-status-google", data.google_cse);
    _setKeyStatus("key-status-bing", data.bing);
  }).catch(() => {});

  document.getElementById("settings-modal").classList.remove("hidden");
}

function updateSettingsLmStatus() {
  const el = document.getElementById("settings-lm-status");
  if (!el) return;
  const cfg = state.lmConfig;
  if (cfg?.provider && cfg?.model) {
    el.innerHTML = `<p class="settings-lm-configured">✓ ${esc(cfg.provider)} — ${esc(cfg.model)}</p>`;
  } else {
    el.innerHTML = `<p class="alda-status-msg">Not configured — language model scoring is disabled.</p>`;
  }
}

function closeSettings() {
  document.getElementById("settings-modal").classList.add("hidden");
}

function selectMaxResults(val) {
  _settingsMaxResults = val;
  _applyMaxResultsPills(val);
  const custom = document.getElementById("settings-max-results-custom");
  if (custom && val !== parseInt(custom.value, 10)) custom.value = "";
}

function selectMaxResultsCustom(raw) {
  const val = parseInt(raw, 10);
  if (!isNaN(val) && val >= 0) {
    _settingsMaxResults = val;
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
  }
}

function saveSettings() {
  localStorage.setItem("alda_max_results", String(_settingsMaxResults));
  state.defaultMaxResults = _settingsMaxResults;

  const useLm = document.getElementById("settings-use-lm")?.checked ?? true;
  localStorage.setItem("alda_use_lm_default", String(useLm));
  const useLmMain = document.getElementById("use-lm");
  if (useLmMain) useLmMain.checked = useLm;

  const budget = document.getElementById("settings-budget")?.value || "";
  if (budget) {
    localStorage.setItem("alda_budget_default", budget);
    const budgetMain = document.getElementById("token-budget-dollars");
    if (budgetMain && !budgetMain.value) budgetMain.value = budget;
  } else {
    localStorage.removeItem("alda_budget_default");
  }

  closeSettings();
  updateTokenEstimate();
}

async function saveApiKeys() {
  const payload = {};
  const semKey      = document.getElementById("sk-semantic-scholar")?.value.trim();
  const coreKey     = document.getElementById("sk-core")?.value.trim();
  const googleCseId = document.getElementById("sk-google-cse-id")?.value.trim();
  const googleApiKey = document.getElementById("sk-google-api-key")?.value.trim();
  const bingKey     = document.getElementById("sk-bing")?.value.trim();

  if (semKey)       payload.semantic_scholar_api_key = semKey;
  if (coreKey)      payload.core_api_key = coreKey;
  if (googleCseId)  payload.google_cse_id = googleCseId;
  if (googleApiKey) payload.google_api_key = googleApiKey;
  if (bingKey)      payload.bing_api_key = bingKey;

  if (Object.keys(payload).length === 0) {
    showStatus("settings-keys-status", "No keys entered.", "");
    return;
  }

  const btn = document.getElementById("btn-save-keys");
  btn.disabled = true;
  try {
    await api("POST", "/api/v1/setup/keys", payload);
    showStatus("settings-keys-status", "Keys saved.", "success");
    const data = await api("GET", "/api/v1/setup/keys");
    _setKeyStatus("key-status-semantic", data.semantic_scholar);
    _setKeyStatus("key-status-core", data.core);
    _setKeyStatus("key-status-google", data.google_cse);
    _setKeyStatus("key-status-bing", data.bing);
    ["sk-semantic-scholar","sk-core","sk-google-cse-id","sk-google-api-key","sk-bing"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
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
  el.className = `alda-status-msg ${type}`;
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
// Boot
// ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);

// Expose for inline HTML onclick attributes (module scope requires this)
Object.assign(window, {
  // Gates
  gateLmGoTo,
  gateLmSelectProvider,
  cancelLmGate,
  openLmGateFromSettings,
  // Navigation
  showStep,
  showSubTab,
  newSearch,
  switchToSearch,
  toggleSwitcherDropdown,
  // Mission
  parseMission,
  // Search
  startSearch,
  retryPoll,
  wakeAndResume,
  recoverFromLostJob,
  abandonJob,
  // Results
  loadResults,
  // Upload
  doUpload,
  // Export
  doExport,
  // Themes
  runClustering,
  // Log
  openLogModal,
  closeLogModal,
  copyLog,
  // Settings
  openSettings,
  closeSettings,
  saveSettings,
  saveApiKeys,
  saveBackendUrl,
  selectMaxResults,
  selectMaxResultsCustom,
  // Chromium install modal
  cancelChromiumInstall,
  proceedChromiumInstall,
  // Scoring gate
  runScoring,
  skipScoring,
});
