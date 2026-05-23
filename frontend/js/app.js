/**
 * ALDA Frontend — Vanilla ES Modules
 * BACKEND_URL is replaced by GitHub Actions at deploy time.
 * For local dev, set it here manually or via localStorage.
 */

const BACKEND_URL = localStorage.getItem("alda_backend_url") || "%%BACKEND_URL%%";

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
let state = {
  queryId: null,
  jobId: null,
  pollInterval: null,
  resultsPage: 1,
  totalResults: 0,
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
    opts.body = body; // FormData
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
  document.querySelector(`.tab-btn[data-tab="${name}"]`).click();
}

// ──────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────
async function checkHealth() {
  try {
    const h = await api("GET", "/api/v1/health");
    setDot("dot-db", h.db === "connected" ? "green" : "red", `DB: ${h.db}`);
    setDot("dot-llm", h.llm_configured ? "green" : "grey",
           h.llm_configured ? "LLM: configured" : "LLM: not configured (BYOK)");
    setDot("dot-scraping", h.scraping_enabled ? "green" : "grey",
           h.scraping_enabled ? "Scraping: enabled" : "Scraping: disabled");

    // Grey out unavailable sources
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
    setDot("dot-db", "red", `Cannot reach backend: ${e.message}`);
    setDot("dot-llm", "red", "");
    setDot("dot-scraping", "red", "");
  }
}

function setDot(id, cls, title) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-dot ${cls}`;
  if (title) el.title = title;
}

// ──────────────────────────────────────────────
// Mission Brief
// ──────────────────────────────────────────────
function initMission() {
  document.getElementById("btn-parse").addEventListener("click", parseMission);
}

async function parseMission() {
  const text = document.getElementById("mission-text").value.trim();
  if (!text) { showStatus("parse-status", "Please enter a mission brief.", "error"); return; }

  showStatus("parse-status", "Parsing…");
  try {
    const result = await api("POST", "/api/v1/mission/parse", { text });
    state.queryId = result.query_id;
    renderBrief(result.structured);
    showStatus("parse-status", `Saved as query ${result.query_id.slice(0, 8)}…`, "success");
    loadRecentQueries();
  } catch (e) {
    showStatus("parse-status", e.message, "error");
  }
}

function renderBrief(s) {
  const kws = (s.keywords || []).map(k => `<span class="kw-chip">${esc(k)}</span>`).join(" ");
  const dr = s.date_range ? `${s.date_range[0]}–${s.date_range[1]}` : "Not specified";
  const inc = s.inclusion_criteria.length
    ? `<ul>${s.inclusion_criteria.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "<em>None specified</em>";
  const exc = s.exclusion_criteria.length
    ? `<ul>${s.exclusion_criteria.map(c => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "<em>None specified</em>";

  document.getElementById("brief-content").innerHTML = `
    <p><strong>Topic:</strong> ${esc(s.topic)}</p>
    <p><strong>Keywords:</strong> ${kws || "<em>None</em>"}</p>
    <p><strong>Date Range:</strong> ${dr}</p>
    <p><strong>Sources:</strong> ${(s.source_types || []).join(", ")}</p>
    <p><strong>Max Results:</strong> ${s.max_results}</p>
    <p><strong>Include:</strong></p>${inc}
    <p><strong>Exclude:</strong></p>${exc}
  `;
  document.getElementById("brief-preview").classList.remove("hidden");
}

async function loadRecentQueries() {
  try {
    const queries = await api("GET", "/api/v1/mission/");
    if (!queries.length) return;
    const list = queries.map(q => `
      <div class="result-card" style="cursor:pointer" data-qid="${q.id}">
        <div class="result-meta">${q.id.slice(0, 8)}… — ${q.status} — ${fmtDate(q.timestamp)}</div>
        <div>${esc(q.query_text.slice(0, 120))}…</div>
      </div>
    `).join("");
    document.getElementById("recent-queries-list").innerHTML = list;
    document.getElementById("recent-queries-section").classList.remove("hidden");
    document.querySelectorAll("[data-qid]").forEach(el => {
      el.addEventListener("click", () => selectQuery(el.dataset.qid));
    });
  } catch (_) {}
}

function selectQuery(qid) {
  state.queryId = qid;
  showStatus("parse-status", `Loaded query ${qid.slice(0, 8)}…`, "success");
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

  const sources = [...document.querySelectorAll('input[name="source"]:checked')]
    .map(el => el.value);
  const useLlm = document.getElementById("use-llm").checked;

  showStatus("search-status-msg", "Starting search…");
  try {
    const result = await api("POST", "/api/v1/search/start", {
      query_id: state.queryId,
      sources,
      use_llm_relevance: useLlm,
    });
    state.jobId = result.job_id;
    document.getElementById("search-progress").classList.remove("hidden");
    startPolling();
    showStatus("search-status-msg", "Search running…");
  } catch (e) {
    showStatus("search-status-msg", e.message, "error");
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
      const msg = job.status === "failed"
        ? `Search failed: ${job.progress.error || "unknown error"}`
        : `Search ${job.status} — ${job.progress.total_sources_found} sources found`;
      showStatus("search-status-msg", msg, job.status === "failed" ? "error" : "success");
      if (job.status !== "failed") {
        setTimeout(() => { switchTab("results"); loadResults(true); }, 800);
      }
    }
  } catch (e) {
    showStatus("search-status-msg", `Poll error: ${e.message}`, "error");
  }
}

function updateProgress(job) {
  const p = job.progress;
  const pct = Math.min(
    Math.round((p.total_sources_found / Math.max(p.total_sources_found + 20, 100)) * 100),
    95,
  );
  document.getElementById("search-progress-bar").value = pct;
  document.getElementById("search-stats").innerHTML =
    `Iteration ${p.current_iteration} | Total: <strong>${p.total_sources_found}</strong> | ` +
    `New this round: ${p.new_this_iteration} | Duplicates removed: ${p.duplicates_removed} | ` +
    `Status: <strong>${job.status}</strong>`;

  const breakdown = Object.entries(p.source_breakdown || {})
    .map(([k, v]) => `<span class="source-tag">${k}: ${v}</span>`)
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
      `/api/v1/search/results/${state.queryId}?page=${state.resultsPage}&page_size=50&sort_by=${sort}&source_type=${type}&min_relevance=${minRel}`
    );

    if (reset) document.getElementById("results-list").innerHTML = "";

    if (!sources.length && state.resultsPage === 1) {
      document.getElementById("results-list").innerHTML = "<p><em>No results yet. Run a search first.</em></p>";
      document.getElementById("load-more-row").style.display = "none";
      return;
    }

    document.getElementById("results-count").textContent =
      `Page ${state.resultsPage} — showing ${sources.length} sources`;

    const cards = sources.map(renderSourceCard).join("");
    document.getElementById("results-list").insertAdjacentHTML("beforeend", cards);

    document.getElementById("load-more-row").style.display = sources.length >= 50 ? "flex" : "none";

    // Abstract expand toggle
    document.querySelectorAll(".result-abstract").forEach(el => {
      el.addEventListener("click", () => el.classList.toggle("expanded"));
    });
  } catch (e) {
    document.getElementById("results-list").innerHTML = `<p class="error">${e.message}</p>`;
  }
}

function renderSourceCard(src) {
  const authors = (src.authors || []).slice(0, 3).join(", ") + (src.authors?.length > 3 ? " et al." : "");
  const relBadge = src.relevance != null ? relevanceBadge(src.relevance) : "";
  const typeBadge = `<span class="source-badge">${esc(src.source_type)}</span>`;
  const doi = src.doi ? `<a href="https://doi.org/${esc(src.doi)}" target="_blank">DOI</a> · ` : "";
  return `
    <div class="result-card">
      <div class="result-title">
        <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>
        ${relBadge}${typeBadge}
      </div>
      <div class="result-meta">
        ${authors ? esc(authors) + " · " : ""}
        ${src.year || ""}
        ${src.venue ? " · " + esc(src.venue) : ""}
        ${src.citation_count != null ? ` · ${src.citation_count} citations` : ""}
        · ${doi}<a href="${esc(src.url)}" target="_blank" rel="noopener">Link</a>
      </div>
      ${src.abstract ? `<div class="result-abstract">${esc(src.abstract)}</div>` : ""}
    </div>
  `;
}

function relevanceBadge(score) {
  const pct = Math.round(score * 100);
  const cls = score >= 0.7 ? "relevance-high" : score >= 0.4 ? "relevance-medium" : "relevance-low";
  return `<span class="relevance-badge ${cls}">${pct}%</span>`;
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
  document.getElementById("upload-file-name").textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById("btn-upload").disabled = false;
}

async function doUpload() {
  if (!state.pendingFile) return;
  const fd = new FormData();
  fd.append("file", state.pendingFile);
  if (state.queryId) fd.append("query_id", state.queryId);

  try {
    const result = await api("POST", "/api/v1/upload/", fd, true);
    const hasErrors = result.errors?.length > 0;
    const el = document.getElementById("upload-result");
    el.className = `upload-result ${hasErrors ? "has-errors" : "success"}`;
    el.innerHTML = `
      <p><strong>Parsed:</strong> ${result.records_parsed} &nbsp;
      <strong>Inserted:</strong> ${result.records_inserted} &nbsp;
      <strong>Duplicates skipped:</strong> ${result.records_skipped_duplicate}</p>
      ${result.errors.length ? `<details><summary>Errors (${result.errors.length})</summary>
        <ul>${result.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    `;
    el.classList.remove("hidden");
  } catch (e) {
    const el = document.getElementById("upload-result");
    el.className = "upload-result has-errors";
    el.innerHTML = `<p>Upload failed: ${esc(e.message)}</p>`;
    el.classList.remove("hidden");
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

  try {
    const blob = await api("POST", "/api/v1/export/", body);
    const ext = fmt === "csv" ? "csv" : "json";
    downloadBlob(blob, `alda_export_${Date.now()}.${ext}`);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  }
}

async function loadPrisma() {
  if (!state.queryId) { alert("No query selected."); return; }
  try {
    const stats = await api("GET", `/api/v1/export/prisma/${state.queryId}`);
    const rows = [
      ["Records identified", stats.identified],
      ["Duplicates removed", stats.duplicates_removed],
      ["Records screened", stats.screened],
      ["Records excluded", stats.excluded],
      ["Records included", stats.included],
    ];
    const bySource = Object.entries(stats.by_source || {})
      .map(([k, v]) => `<tr><td>— ${esc(k)}</td><td>${v}</td></tr>`).join("");
    document.getElementById("prisma-stats").innerHTML = `
      <table class="prisma-table">
        <tbody>
          ${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("")}
          ${bySource}
        </tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById("prisma-stats").innerHTML = `<p class="error">${e.message}</p>`;
  }
}

// ──────────────────────────────────────────────
// Themes
// ──────────────────────────────────────────────
function initThemes() {
  document.getElementById("btn-cluster").addEventListener("click", runClustering);
}

async function runClustering() {
  if (!state.queryId) { alert("No query selected."); return; }
  showStatus("cluster-status", "Clustering…");
  try {
    const job = await api("POST", `/api/v1/themes/cluster/${state.queryId}`);
    // Poll clustering job
    const interval = setInterval(async () => {
      try {
        const s = await api("GET", `/api/v1/themes/cluster/status/${job.job_id}`);
        if (s.status === "complete") {
          clearInterval(interval);
          showStatus("cluster-status", "Done!", "success");
          loadThemes();
        } else if (s.status.startsWith("failed")) {
          clearInterval(interval);
          showStatus("cluster-status", s.status, "error");
        }
      } catch (_) { clearInterval(interval); }
    }, 2000);
  } catch (e) {
    showStatus("cluster-status", e.message, "error");
  }
}

async function loadThemes() {
  if (!state.queryId) return;
  try {
    const themes = await api("GET", `/api/v1/themes/${state.queryId}`);
    const maxCount = Math.max(...themes.map(t => t.source_count), 1);
    const cloud = themes.map(t => {
      const size = 0.8 + (t.source_count / maxCount) * 1.4;
      const title = t.description || `${t.source_count} sources`;
      return `<span class="theme-tag" style="font-size:${size}rem" title="${esc(title)}">${esc(t.name)}</span>`;
    }).join("");
    document.getElementById("theme-cloud").innerHTML =
      `<div class="theme-cloud">${cloud}</div>`;
  } catch (e) {
    document.getElementById("theme-cloud").innerHTML = `<p class="error">${e.message}</p>`;
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
  try { return new Date(ts).toLocaleDateString(); } catch (_) { return ts; }
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
