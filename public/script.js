"use strict";

/* =====================================================================
   DailyNest - Project 4: Frontend <-> Backend integration

   The page keeps NO tasks of its own. Everything follows ONE loop:

     user action -> fetch() request -> check the status code -> read the JSON
                 -> update the page -> (finally) hide the spinner

   Input  = what the user does      (click, type)
   Process = the request to the API (fetch + async/await)
   Output = what the user sees      (cards, counts, toasts)
   ===================================================================== */

/* ---------- 1. Settings ---------- */
// Where is the backend? Empty = same address as this page (see config.js)
const API_BASE = String((window.DAILYNEST_CONFIG && window.DAILYNEST_CONFIG.apiBaseUrl) || "").replace(/\/+$/, "");
const PAGE_SIZE = 6;               // tasks per page
const REQUEST_TIMEOUT_MS = 10000;  // give up on a request after 10 seconds
const MAX_RETRIES = 2;             // extra tries for safe requests
const BULK_LIMIT = 50;             // "Mark all done" handles up to 50 tasks per click
const THEME_KEY = "dailynest-theme";
const CATEGORIES = ["home", "study", "health", "shopping"];

// Idempotent = repeating it gives the same result, so it is SAFE to retry (GET, PUT, DELETE).
// POST and PATCH are NOT retried automatically: a repeat could create or change things twice.
const IDEMPOTENT_METHODS = ["GET", "PUT", "DELETE"];

/* ---------- 2. Page elements ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  navToggle: $("navToggle"), nav: $("siteNav"), themeToggle: $("themeToggle"),
  today: $("todayDate"), badge: $("serverBadge"),
  progressText: $("progressText"), progressBar: $("progressBar"), progressFill: $("progressFill"),
  markAll: $("markAllBtn"), clearDone: $("clearDoneBtn"),
  form: $("taskForm"), input: $("taskInput"), category: $("taskCategory"), addBtn: $("addBtn"), formMsg: $("formMsg"),
  search: $("searchInput"), status: $("statusFilter"), filters: document.querySelector(".filters"),
  grid: $("taskGrid"), emptyMsg: $("emptyMsg"),
  pagination: $("pagination"), prev: $("prevPage"), next: $("nextPage"), pageInfo: $("pageInfo"),
  spinner: $("spinner"), toasts: $("toasts"),
};

/* ---------- 3. What the page remembers (only what it is SHOWING) ---------- */
const state = {
  tasks: [], meta: { page: 1, totalPages: 1, total: 0 }, categories: [], stats: null,
  category: "all", status: "all", search: "", page: 1,
  loading: true, loadError: "", editingId: null, online: null, dbType: "",
};

/* =====================================================================
   4. TALKING TO THE API
   ===================================================================== */

// A custom error that carries the HTTP status, so the page can react to it
class ApiError extends Error {
  constructor(message, { status = 0, code = "NETWORK_ERROR" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns a status code into a short, kind message (never show raw technical errors to users)
function friendlyMessage(status, problem, response) {
  if (problem && Array.isArray(problem.details) && problem.details.length) {
    return problem.details.map((d) => (d && d.message) || String(d)).join(" ");
  }
  switch (status) {
    case 400: return (problem && problem.message) || "That request was not understood.";
    case 401: return "Please log in first.";
    case 403: return "You are not allowed to do that.";
    case 404: return "That task was not found. It may already be deleted.";
    case 413: return "That is too much data to send.";
    case 415: return "The page sent data in the wrong format.";
    case 422: return (problem && problem.message) || "Some of the data is not valid.";
    case 429: {
      const wait = Number(response && response.headers.get("Retry-After"));
      return wait > 0 ? `Too many requests. Please wait ${wait} seconds and try again.` : "Too many requests. Please wait a moment.";
    }
    default:
      return status >= 500
        ? "The server had a problem. Please try again in a moment."
        : `The request failed (HTTP ${status}).`;
  }
}

// Reads JSON without crashing if the server answered with something else (like an HTML error page)
async function readJsonSafely(response) {
  try { return await response.json(); } catch (err) { return null; }
}

// ONE attempt: send the request, check the answer.
async function requestOnce(method, path, body, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" }, // tell the server we send JSON
      body: body === undefined ? undefined : JSON.stringify(body),                     // objects must become text
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new ApiError("The server took too long to answer.", { code: "TIMEOUT" });
    throw new ApiError("Could not reach the server. Check your internet connection.", { code: "NETWORK_ERROR" });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return null; // success, nothing to read (e.g. DELETE)

  // IMPORTANT: check response.ok BEFORE reading the data. fetch() does NOT throw on 404 or 500!
  if (!response.ok) {
    // A retried DELETE that says "404" means the first try already worked: same end result.
    if (method === "DELETE" && response.status === 404 && attempt > 1) return null;
    const payload = await readJsonSafely(response);
    const problem = payload && payload.error;
    throw new ApiError(friendlyMessage(response.status, problem, response), {
      status: response.status,
      code: (problem && problem.code) || "HTTP_ERROR",
    });
  }

  const data = await readJsonSafely(response); // JSON text -> JavaScript object
  if (data === null) {
    throw new ApiError("The server sent an answer the page could not read.", { status: response.status, code: "BAD_JSON" });
  }
  return data;
}

// The spinner stays visible while at least one request is running
let pendingRequests = 0;
function setBusy(change) {
  pendingRequests += change;
  els.spinner.hidden = pendingRequests === 0;
}

// The function the whole page uses. It adds: spinner, safe retries, clean errors.
async function api(method, path, body) {
  const maxAttempts = IDEMPOTENT_METHODS.includes(method) ? MAX_RETRIES + 1 : 1;
  setBusy(1);
  try {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // `await` inside this loop is on purpose: each retry must wait for the one before it.
        return await requestOnce(method, path, body, attempt);
      } catch (err) {
        lastError = err;
        const temporary = err.code === "NETWORK_ERROR" || err.code === "TIMEOUT" || [502, 503, 504].includes(err.status);
        if (!temporary || attempt === maxAttempts) break;
        await sleep(400 * attempt); // wait a little longer before every retry
      }
    }
    throw lastError;
  } finally {
    setBusy(-1); // runs on success AND on failure: the spinner can never get stuck
  }
}

/* =====================================================================
   5. ERRORS: never silent. Tell the user, and tell the developer.
   ===================================================================== */

function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.textContent = message; // textContent: the text is shown as text, never run as HTML

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss message");
  close.textContent = "\u00D7";
  close.addEventListener("click", () => toast.remove());

  toast.append(text, close);
  els.toasts.append(toast);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();
  setTimeout(() => toast.remove(), type === "error" ? 7000 : 3500);
}

// Expected problems (wrong input, "not found") are not bugs. Real problems are sent to the server's log.
function shouldReport(err) {
  if (!(err instanceof ApiError)) return true; // a bug in our own code
  return err.status >= 500 || err.code === "BAD_JSON" || err.code === "TIMEOUT";
}

// Sends a short report to POST /api/logs (like a tiny Sentry). It must NEVER throw.
function reportError(err, context) {
  try {
    fetch(`${API_BASE}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String((err && err.message) || err || "Unknown error").slice(0, 300),
        context,
        status: (err && err.status) || 0,
        page: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (ignore) { /* logging must never break the page */ }
}

// The ONE place every error ends up
function handleError(err, context) {
  const message = err instanceof ApiError ? err.message : "Something unexpected went wrong. Please try again.";
  showToast(message, "error");
  if (err instanceof ApiError && (err.code === "NETWORK_ERROR" || err.code === "TIMEOUT" || err.status >= 500)) {
    state.online = false;
    renderBadge();
  }
  if (shouldReport(err)) reportError(err, context);
}

// Safety nets: even a bug we did not expect is not silent
window.addEventListener("error", (event) => handleError(event.error || new Error(event.message), "window-error"));
window.addEventListener("unhandledrejection", (event) => handleError(event.reason, "unhandled-promise"));

/* =====================================================================
   6. LOADING DATA
   ===================================================================== */

let latestRefresh = 0;

// Asks the server for everything the page shows. The 4 requests are independent,
// so they start TOGETHER with Promise.all (one after another would be 4 times slower).
async function refresh() {
  const ticket = ++latestRefresh;
  const params = new URLSearchParams({ page: String(state.page), limit: String(PAGE_SIZE) });
  if (state.category !== "all") params.set("category", state.category);
  if (state.status !== "all") params.set("done", state.status === "done" ? "true" : "false");
  if (state.search) params.set("search", state.search);

  const [tasks, stats, categories, health] = await Promise.all([
    api("GET", `/api/tasks?${params}`),
    api("GET", "/api/stats"),
    api("GET", "/api/categories"),
    api("GET", "/api/health"),
  ]);

  if (ticket !== latestRefresh) return; // a newer request started meanwhile: ignore this old answer

  // The last task of this page was removed? Go back to a page that exists.
  if (tasks.data.length === 0 && state.page > 1) {
    state.page = Math.max(1, tasks.meta.totalPages);
    return refresh();
  }

  state.tasks = tasks.data;
  state.meta = tasks.meta;
  state.stats = stats.data;
  state.categories = categories.data;
  state.online = true;
  state.dbType = health.data.type;
  state.loadError = "";
  renderAll();
}

// First load, filters, search, "Try again": shows "Loading..." and a friendly fallback if it fails
let loadCounter = 0;
async function loadWithFallback() {
  const mine = ++loadCounter;
  state.loading = true;
  state.loadError = "";
  renderAll();
  try {
    await refresh();
  } catch (err) {
    if (mine === loadCounter) {
      state.loadError = err instanceof ApiError ? err.message : "Something unexpected went wrong.";
      handleError(err, "load");
    }
  } finally {
    if (mine === loadCounter) {
      state.loading = false;
      renderAll();
    }
  }
}

/* =====================================================================
   7. DRAWING THE PAGE (DOM)  - only createElement + textContent, never innerHTML,
      so a task like <img onerror=...> is shown as plain text and cannot run (XSS safe).
   ===================================================================== */

function formatDate(iso) {
  const date = new Date(iso); // the server sends dates as ISO text
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function makeButton(label, className, action, id, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${className}`;
  button.textContent = label;
  button.dataset.action = action;
  if (id !== undefined) button.dataset.id = String(id);
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}

function buildCard(task) {
  const card = document.createElement("article");
  card.className = task.done ? "card is-done" : "card";

  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = task.category;

  const title = document.createElement("h3");
  title.textContent = task.text;

  const meta = document.createElement("p");
  meta.className = "meta";
  const time = document.createElement("time");
  time.dateTime = task.createdAt;
  time.textContent = `Added ${formatDate(task.createdAt)}`;
  meta.append(time);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    makeButton(task.done ? "Mark not done" : "Mark done", "", "toggle", task.id, `${task.done ? "Mark not done" : "Mark done"}: ${task.text}`),
    makeButton("Edit", "btn-ghost", "edit", task.id, `Edit: ${task.text}`),
    makeButton("Delete", "btn-danger", "delete", task.id, `Delete: ${task.text}`)
  );

  card.append(tag, title, meta, actions);
  return card;
}

function buildEditCard(task) {
  const form = document.createElement("form");
  form.className = "card edit-form";
  form.dataset.id = String(task.id);
  form.noValidate = true;

  const input = document.createElement("input");
  input.type = "text";
  input.name = "text";
  input.maxLength = 80;
  input.value = task.text;
  input.setAttribute("aria-label", "Task text");

  const select = document.createElement("select");
  select.name = "category";
  select.setAttribute("aria-label", "Category");
  CATEGORIES.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = capitalise(name);
    option.selected = name === task.category;
    select.append(option);
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn";
  save.textContent = "Save";
  actions.append(save, makeButton("Cancel", "btn-ghost", "cancel"));

  form.append(input, select, actions);
  return form;
}

function buildPanel(message, isError) {
  const panel = document.createElement("div");
  panel.className = isError ? "panel panel--error grid-message" : "panel grid-message";
  if (isError) panel.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = message;
  panel.append(text);
  if (isError) panel.append(makeButton("Try again", "", "retry"));
  return panel;
}

function renderTasks() {
  els.grid.replaceChildren();
  els.emptyMsg.hidden = true;

  if (state.loading) { els.grid.append(buildPanel("Loading your tasks...", false)); return; }
  // Graceful fallback: a clear message and a way to retry, never a blank screen
  if (state.loadError) { els.grid.append(buildPanel(`We could not load your tasks. ${state.loadError}`, true)); return; }

  if (state.tasks.length === 0) {
    const filtered = state.category !== "all" || state.status !== "all" || state.search !== "";
    els.emptyMsg.textContent = filtered ? "No tasks match this search or filter." : "No tasks here yet. Add your first one above!";
    els.emptyMsg.hidden = false;
    return;
  }
  state.tasks.forEach((task) => els.grid.append(task.id === state.editingId ? buildEditCard(task) : buildCard(task)));
}

function renderChips() {
  const counts = {};
  let all = 0;
  state.categories.forEach((c) => { counts[c.name] = c.total; all += c.total; });
  els.filters.querySelectorAll(".chip").forEach((chip) => {
    const key = chip.dataset.filter;
    const active = key === state.category;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
    const count = key === "all" ? all : counts[key];
    chip.textContent = count === undefined ? capitalise(key) : `${capitalise(key)} (${count})`;
  });
}

function renderProgress() {
  const { total = 0, done = 0, percent = 0 } = state.stats || {};
  els.progressText.textContent = `${done} of ${total} tasks done`;
  els.progressBar.setAttribute("aria-valuenow", String(percent));
  els.progressFill.style.width = `${percent}%`;
}

function renderPagination() {
  const { page, totalPages } = state.meta;
  els.pagination.hidden = state.loading || Boolean(state.loadError) || totalPages <= 1;
  els.pageInfo.textContent = `Page ${page} of ${totalPages}`;
  els.prev.disabled = page <= 1;
  els.next.disabled = page >= totalPages;
}

function renderBadge() {
  els.badge.classList.remove("badge--online", "badge--offline");
  if (state.online === true) {
    els.badge.classList.add("badge--online");
    els.badge.textContent = `Server online \u00B7 ${state.dbType === "postgresql" ? "PostgreSQL" : "SQLite"}`;
  } else if (state.online === false) {
    els.badge.classList.add("badge--offline");
    els.badge.textContent = "Server offline";
  } else {
    els.badge.textContent = "Checking server...";
  }
}

function renderAll() {
  renderBadge();
  renderChips();
  renderProgress();
  renderTasks();
  renderPagination();
}

function setFormMessage(message) { els.formMsg.textContent = message; }

/* =====================================================================
   8. USER ACTIONS (Input -> Process -> Output)
   ===================================================================== */

// ----- CREATE: POST /api/tasks -----
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormMessage("");
  const text = els.input.value.trim();
  if (!text) { // quick check in the browser; the server checks again (never trust the client)
    setFormMessage("Please type a task first.");
    els.input.focus();
    return;
  }
  els.addBtn.disabled = true; // stops double clicks
  try {
    await api("POST", "/api/tasks", { text, category: els.category.value });
    els.input.value = "";
    // Show the new task: clear the filters, go to the first page (newest first)
    state.category = "all"; state.status = "all"; state.search = ""; state.page = 1;
    els.status.value = "all"; els.search.value = "";
    await refresh();
    showToast("Task added.", "success");
    els.input.focus();
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) setFormMessage(err.message); // wrong input: show next to the box
    else handleError(err, "add-task");
  } finally {
    els.addBtn.disabled = false;
  }
});

// ----- UPDATE (PATCH) / DELETE / start editing: one listener for all cards (event delegation) -----
els.grid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = Number(button.dataset.id);

  if (action === "retry") { loadWithFallback(); return; }
  if (action === "cancel") { state.editingId = null; renderTasks(); return; }

  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  if (action === "edit") {
    state.editingId = id;
    renderTasks();
    const input = els.grid.querySelector(".edit-form input");
    if (input) input.focus();
    return;
  }

  button.disabled = true;
  try {
    if (action === "toggle") await api("PATCH", `/api/tasks/${id}`, { done: !task.done });
    if (action === "delete") await api("DELETE", `/api/tasks/${id}`);
    await refresh(); // redraw first, THEN say "done": the message always matches what the user sees
    if (action === "delete") showToast("Task deleted.", "success");
  } catch (err) {
    handleError(err, action);
    button.disabled = false;
    // "Not found" usually means someone else already changed the shared data: show the real list
    if (err instanceof ApiError && err.status === 404) refresh().catch(() => {});
  }
});

// ----- UPDATE (PUT): save the edit form -----
els.grid.addEventListener("submit", async (event) => {
  const form = event.target.closest("form.edit-form");
  if (!form) return;
  event.preventDefault();
  const id = Number(form.dataset.id);
  const task = state.tasks.find((t) => t.id === id);
  const text = form.elements.text.value.trim();
  if (!task) return;
  if (!text) { showToast("Please type something for the task.", "error"); return; }

  const save = form.querySelector("button[type=submit]");
  save.disabled = true;
  try {
    // PUT replaces the whole task, so we send every field
    await api("PUT", `/api/tasks/${id}`, { text, category: form.elements.category.value, done: task.done });
    state.editingId = null;
    await refresh();
    showToast("Task updated.", "success");
  } catch (err) {
    handleError(err, "edit-task");
    save.disabled = false;
  }
});

// ----- DELETE many: DELETE /api/tasks?done=true -----
els.clearDone.addEventListener("click", async () => {
  if (!state.stats || state.stats.done === 0) { showToast("There are no finished tasks to clear.", "info"); return; }
  els.clearDone.disabled = true;
  try {
    const result = await api("DELETE", "/api/tasks?done=true");
    await refresh();
    showToast(`${result.data.deleted} finished task(s) cleared.`, "success");
  } catch (err) {
    handleError(err, "clear-done");
  } finally {
    els.clearDone.disabled = false;
  }
});

// ----- Many requests at once: Mark all done -----
els.markAll.addEventListener("click", async () => {
  els.markAll.disabled = true;
  try {
    const open = await api("GET", `/api/tasks?done=false&limit=${BULK_LIMIT}`);
    if (open.data.length === 0) { showToast("Everything is already done!", "info"); return; }

    // Promise.allSettled starts ALL the requests together and waits for every one to finish.
    // (A `for` loop with `await` inside would send them one by one: much slower.)
    const results = await Promise.allSettled(open.data.map((t) => api("PATCH", `/api/tasks/${t.id}`, { done: true })));
    const failed = results.filter((r) => r.status === "rejected");
    await refresh();

    if (failed.length === 0) {
      const more = open.meta.total > BULK_LIMIT ? ` (the first ${BULK_LIMIT}; click again for the rest)` : "";
      showToast(`${results.length} task(s) marked as done${more}.`, "success");
    } else {
      showToast(`${results.length - failed.length} done, ${failed.length} failed. Please try again.`, "error");
      if (shouldReport(failed[0].reason)) reportError(failed[0].reason, "mark-all");
    }
  } catch (err) {
    handleError(err, "mark-all");
  } finally {
    els.markAll.disabled = false;
  }
});

// ----- Filters, search and pages: all become query parameters of GET /api/tasks -----
els.filters.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  state.category = chip.dataset.filter;
  state.page = 1;
  loadWithFallback();
});

els.status.addEventListener("change", () => {
  state.status = els.status.value;
  state.page = 1;
  loadWithFallback();
});

let searchTimer;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer); // wait until the user stops typing: fewer requests
  searchTimer = setTimeout(() => {
    state.search = els.search.value.trim();
    state.page = 1;
    loadWithFallback();
  }, 350);
});

els.prev.addEventListener("click", () => { if (state.page > 1) { state.page -= 1; loadWithFallback(); } });
els.next.addEventListener("click", () => { if (state.page < state.meta.totalPages) { state.page += 1; loadWithFallback(); } });

/* =====================================================================
   9. SMALL EXTRAS: menu, dark mode, today's date
   ===================================================================== */

els.navToggle.addEventListener("click", () => {
  const open = els.nav.classList.toggle("is-open");
  els.navToggle.setAttribute("aria-expanded", String(open));
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

els.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* private mode: fine */ }
});

function init() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
  els.today.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  loadWithFallback(); // first load
}

init();
