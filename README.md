# DailyNest - Project 4: Frontend & Backend Integration

DailyNest is a daily life planner (Home, Study, Health, Shopping tasks).

- **Project 1** was the skin: the responsive page.
- **Project 2** was the nervous system: the backend API.
- **Project 3** was the memory: a real database.
- **Project 4** connects everything: the page now talks to the API with `fetch()` and `async/await`,
  shows the live data from the database, and handles every kind of error politely.

Built for the DecodeLabs Full Stack Development internship (Batch 2026).
Stack: HTML + CSS + vanilla JavaScript (frontend), Node.js + Express (backend), PostgreSQL / SQLite (database).

Built by: FATIMA

## The big idea in simple words

The page is like a **waiter**, the API is the **kitchen**, the database is the **fridge**.
The waiter never cooks and never stores food. He takes your order (a request), brings it to the kitchen,
waits, checks what came back, and puts it on your table (the screen). If the kitchen is closed, he politely
tells you instead of standing there silently.

```
USER click/type  ->  fetch() request  ->  Express API  ->  database
       ^                                                      |
       +---- page redraws  <---- JSON answer  <---------------+
```

Every action in the page follows **one loop**:

1. **Input**: the user does something (click, type).
2. **Process**: `fetch()` sends a request, the page checks the status code, then reads the JSON.
3. **Output**: the page updates (cards, counts, a toast message). In `finally`, the spinner is hidden.

## The three project requirements

| Requirement from the brief | How this project does it | Where |
|---|---|---|
| **Send requests from the frontend to the backend** | `fetch()` with GET, POST, PUT, PATCH and DELETE. Headers say it is JSON; the body is `JSON.stringify(...)` | `public/script.js` (`requestOnce`, `api`) |
| **Display dynamic data on the UI** | Task cards, category counts, progress bar, server status, pages, search and filters all come from the API. Nothing is hard-coded | `public/script.js` (`refresh`, `render...`) |
| **Handle basic errors and responses** | Status codes checked, friendly messages, toasts, a fallback panel with "Try again", safe retries, a spinner that always stops, errors reported to the server log | `public/script.js` (sections 4 and 5) |

## What the deck teaches, and where to find it

| Topic from the training kit | In this project |
|---|---|
| **IPO architecture** (Input -> Process -> Output) | The loop above; every handler in section 8 of `script.js` |
| **REST: nouns, not verbs** | URLs are `/api/tasks`, never `/getTasks` |
| **REST: stateless** | The server keeps no memory of the browser between calls. Every request carries what it needs (the page remembers only the theme, in the browser) |
| **HTTP method table + idempotency** | GET, PUT, DELETE are **safe to retry** and are retried automatically (up to 2 times). POST and PATCH are **never** auto-retried, because a repeat could create or change things twice (`IDEMPOTENT_METHODS`) |
| **`async` / `await`** | Every request is an `async` function using `await` (no `.then()` chains) |
| **`fetch()` details** | `method`, `headers: { "Content-Type": "application/json" }`, `body: JSON.stringify(...)` |
| **JSON parse / serialize** | `response.json()` to read, `JSON.stringify()` to send. Dates arrive as ISO text and are turned into readable dates |
| **Check `response.ok`** | `fetch()` does **not** fail on 404 or 500, so we check `response.ok` first and throw our own `ApiError` |
| **Status codes** | 200, 201, 204, 400, 401, 403, 404, 413, 415, **422**, 429, 500, 503. See the table below |
| **CORS and the preflight** | `cors` middleware in `middleware.js` answers the `OPTIONS` preflight. Allowed addresses come from `ALLOWED_ORIGINS` |
| **Safe DOM updates** | Only `createElement` + `textContent`. A task named `<img onerror=...>` is shown as plain text and never runs |
| **`try / catch / finally`** | Every action: `try` the request, `catch` shows the error, `finally` re-enables buttons and hides the spinner |
| **No silent failures** | Every `catch` shows a toast. Global `error` and `unhandledrejection` listeners catch anything unexpected |
| **Graceful degradation** | If loading fails: a clear panel with a **Try again** button, never a blank screen |
| **Toast notifications, not `console.log`** | Users see toasts. Real problems are also sent to `POST /api/logs` (a tiny home-made "Sentry") |
| **Anti-pattern: forgetting `await`** | Every call is awaited (it would leave you with a Promise instead of data) |
| **Anti-pattern: `await` inside a loop** | "Mark all done" starts all requests together with `Promise.allSettled`. The page also loads tasks, stats, categories and health together with `Promise.all` |
| **Lifecycle** | input -> fetch -> check status -> parse -> update DOM -> `finally` hide spinner |

## Run it

```bash
npm install     # downloads Express and pg
npm start       # open http://localhost:3000
npm test        # automated backend checks (they use a temporary file, never your real database)
```

Open **http://localhost:3000** (not the HTML file directly).

**Which database?** Same rule as Project 3:
- `DATABASE_URL` set (in a `.env` file, copy `.env.example`) -> the shared cloud PostgreSQL database.
- Empty -> a local file `data/dailynest.db` (needs Node 22.13+).

The terminal prints which one is used. The coloured badge in the page's sidebar shows it too.

### Page on another address (to see CORS for real)

1. In `public/config.js` set `apiBaseUrl` to your backend address, e.g. `"http://localhost:3000"`.
2. Open `public/index.html` with VS Code **Live Server** (it runs on port 5500).
3. Port 5500 is already in the backend's allowed list. For any other address, set
   `ALLOWED_ORIGINS=https://my-page.example` on the backend (comma-separated for several).

## Try it yourself (great for a demo)

| Do this | What you should see |
|---|---|
| Add a task | A card appears first, a green "Task added." toast, counts and progress change |
| Type `!!!` as the task | A red message under the form: text must contain a letter or number (the server answered **422**) |
| Click **Edit**, change the text, **Save** | The card updates (a **PUT** request) |
| Click **Mark done** | The card is crossed out, progress goes up (a **PATCH** request) |
| Type in the search box | The list filters while you type (`?search=...`) |
| Add 7+ tasks | **Previous / Next** buttons appear (`?page=2`) |
| Click **Mark all done** | Many PATCH requests run at once |
| Stop the server (Ctrl+C), then click a filter | Red "Server offline" badge, an error toast and a panel with **Try again**. Start the server again and click **Try again** |
| Add a task named `<b>hi</b><img src=x onerror=alert(1)>` | It is shown as plain text. No alert appears |
| Open DevTools -> Network and watch | The requests, their methods, status codes and JSON |

## Files

```
DailyNest-Project4/
├── server.js            # starts everything; CORS, routes, health check
├── db.js  store.js      # database connection and all SQL (from Project 3)
├── schema.sql  schema.sqlite.sql
├── middleware.js        # CORS + preflight, logger, rate limit, API key, error handlers
├── validators.js        # checks incoming data
├── routes/
│   ├── tasks.js         # tasks API (validation errors answer 422)
│   ├── categories.js  stats.js
│   ├── logs.js          # POST /api/logs: browser error reports       (new)
│   └── admin.js         # reset + read the error log (API key needed)
├── public/
│   ├── index.html       # page structure (+ search, filter, pages, spinner, toasts)
│   ├── styles.css
│   ├── config.js        # backend address for the page                (new)
│   └── script.js        # all the fetch / async / error-handling code (rewritten)
├── scripts/migrate-json.js
├── test.js              # backend tests
└── .env.example
```

## API

Base URL: `http://localhost:3000`. Bodies are JSON. URLs are **nouns**.

| Method | URL | What it does | Success |
|---|---|---|---|
| GET | `/api/health` | Server + database alive? | 200 |
| GET | `/api/tasks` | List. Optional: `?category=study&done=false&search=milk&page=1&limit=6` | 200 |
| GET | `/api/tasks/:id` | One task | 200 |
| POST | `/api/tasks` | Create `{ "text": "...", "category": "home" }` | 201 |
| PUT | `/api/tasks/:id` | Replace a task (send text, category, done) | 200 |
| PATCH | `/api/tasks/:id` | Change some fields, e.g. `{ "done": true }` | 200 |
| DELETE | `/api/tasks/:id` | Delete one task | 204 |
| DELETE | `/api/tasks?done=true` | Clear finished tasks | 200 |
| GET | `/api/categories` | Categories with task counts | 200 |
| GET | `/api/stats` | Totals and percentage | 200 |
| POST | `/api/logs` | Browser reports an error `{ "message": "...", "context": "..." }` | 202 |
| POST | `/api/admin/reset` | Starter tasks back (header `x-api-key`) | 200 |
| GET | `/api/admin/logs` | Latest browser error reports (header `x-api-key`) | 200 |

### Status codes and what the page does

| Code | Meaning | What the page shows |
|---|---|---|
| 200 / 201 / 204 | OK / created / done, nothing to send back | Updates the screen (+ success toast) |
| 400 | **Malformed** request (not JSON, bad id, bad filter value) | Friendly message |
| 401 / 403 | Not logged in / not allowed | "Please log in" / "not allowed" |
| 404 | Not found | "Task not found, it may already be deleted" and the list refreshes |
| 413 / 415 | Body too big / wrong Content-Type | Friendly message |
| **422** | JSON is fine but the **values break the rules** (empty text, unknown category) | The exact reasons, next to the form |
| 429 | Too many requests | "Please wait N seconds" (read from the `Retry-After` header) |
| 500 / 503 | Server problem | "The server had a problem", and the error is sent to `/api/logs` |
| no answer | Server off or network down | "Could not reach the server", offline badge, **Try again** |

400 vs 422 in one line: **400 = the question is broken, 422 = the question is fine but the answer is not allowed.**

## Explain it in simple words

**What is `fetch()`?** The browser's way to send a request to a server and wait for the answer.

**Why `async` / `await`?** Asking a server takes time. `await` waits for the answer without freezing the page, and the code reads top to bottom like normal.

**Why check `response.ok`?** `fetch()` only fails when the network is dead. A 404 or 500 still "succeeds", so we must look at the status ourselves.

**What is CORS?** A browser safety rule: a page may only read answers from another address if that server says "this address is allowed". The browser first sends a small `OPTIONS` question called the **preflight**; our server answers with the allowed methods and headers.

**What is idempotent?** Doing it twice has the same result as once. Deleting the same task twice leaves the same list, so DELETE can be retried. Creating a task twice makes two tasks, so POST is never retried automatically.

**Why `textContent` and not `innerHTML`?** `textContent` shows text as text. `innerHTML` would run HTML someone typed, which allows attacks (XSS).

**What does `finally` do?** It always runs, whether the request worked or failed. We hide the spinner and re-enable buttons there, so the page can never get stuck.

**Why `Promise.all`?** To start independent requests together. Four requests one after another take four times as long.

**Why a toast and not `console.log`?** Users never open the console, so an error there is invisible to them. A toast tells them; `/api/logs` tells the developer.

**Why does the page ignore an old answer?** If you type fast, answers can arrive out of order. Each request gets a number and only the newest answer is shown.

**What is "stateless"?** The server does not remember you between requests. Everything needed is in each request.

## Deploying

Same as Project 3: push the project to GitHub, then on SnapDeploy deploy the repository.
Set the environment variables `DATABASE_URL` (your Neon connection string) and `API_KEY` (your own secret).
The page and the API are served from the same address, so no CORS setting is needed. Open `/api/health` to check.
Remember: the connection string is a password. Keep it in `.env` and in the host's settings, never on GitHub.
