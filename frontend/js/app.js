/**
 * ALDA Frontend — Vanilla ES Modules
 * For local dev: localStorage.setItem("alda_backend_url", "http://localhost:8000")
 */

const BACKEND_URL = localStorage.getItem("alda_backend_url") || "https://alda-49ak.onrender.com";

// ──────────────────────────────────────────────
// Display label maps
// ──────────────────────────────────────────────
const SOURCE_NAMES = {
  semantic_scholar: "Semantic Scholar",
  crossref: "CrossRef",
  openalex: "OpenAlex",
  arxiv: "arXiv",
  pubmed: "PubMed",
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
// State
// ──────────────────────────────────────────────
let state = {
  queryId: null,
  jobId: null,
  pollInterval: null,
  resultsPage: 1,
  pendingFile: null,
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
  const resp = await fetch(`${BACKEND_URL}${path}`, opts);
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const err = await resp.json(); msg = err.detail || msg; } catch (_) {}
    throw new Error(msg);
  }
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
      h.llm_configured ? "AI scoring active" : "AI scoring not configured (optional)");
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
  } catch (e) {
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
    renderBrief(result.structured);
    showStatus("parse-status", "Done! Review the summary, then run your search.", "success");
    loadRecentQueries();
    updateGuidedBanner(2);
  } catch (e) {
    showStatus("parse-status", `Something went wrong: ${e.message}`, "error");
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

  document.getElementById("brief-content").innerHTML = `
    <p><strong>Topic:</strong> ${esc(s.topic)}</p>
    <p><strong>Search keywords:</strong> ${kws || "<em>None identified</em>"}</p>
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
  showStatus("parse-status", "Previous search loaded. You can run a new search or go straight to Results.", "success");
  updateGuidedBanner(2);
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────
function initSearch() {
  document.getElementById("btn-search").addEventListener("click", startSearch);
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

  showStatus("search-status-msg", "Starting…");
  try {
    const result = await api("POST", "/api/v1/search/start", {
      query_id: state.queryId,
      sources,
      use_llm_relevance: useLlm,
    });
    state.jobId = result.job_id;
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
    updateProgress(job);

    if (["complete", "saturated", "failed"].includes(job.status)) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      document.getElementById("btn-search").disabled = false;
      document.getElementById("btn-search").textContent = "Start Search";

      if (job.status === "failed") {
        showStatus("search-status-msg", "Search failed — please try again.", "error");
      } else {
        const total = job.progress.total_sources_found;
        showStatus("search-status-msg",
          `Found ${total} source${total !== 1 ? "s" : ""}. Taking you to results…`, "success");
        updateGuidedBanner(3);
        setTimeout(() => { switchTab("results"); loadResults(true); }, 1000);
      }
    }
  } catch (e) {
    showStatus("search-status-msg", `Connection issue: ${e.message}`, "error");
  }
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
  document.getElementById("source-breakdown").innerHTML = breakdown;
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

  return `
    <div class="result-card">
      <div class="result-title">
        <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>
        ${relBadge}${typeBadge}
      </div>
      <div class="result-meta">
        ${authors ? esc(authors) + " · " : ""}${src.year || ""}
        ${src.venue ? " · " + esc(src.venue) : ""}${citations}
        · ${doiLink}<a href="${esc(src.url)}" target="_blank" rel="noopener">Open source</a>
      </div>
      ${src.abstract ? `<div class="result-abstract">${esc(src.abstract)}</div>` : ""}
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
// Boot
// ──────────────────────────────────────────────
function init() {
  initTabs();
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
