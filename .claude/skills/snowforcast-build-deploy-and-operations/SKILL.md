---
name: snowforcast-build-deploy-and-operations
description: >
  The single operational reference for snowforcast: how to install, run locally,
  configure env/secrets, and operate the live deploy target (Vercel; a GitHub
  Pages path is documented but NOT enabled — 404) and two GitHub Actions cron
  workflows. Load this when you need to set up a dev environment, run app.py,
  add or read a secret/env var, understand or edit .github/workflows/update-forecast.yml
  or update-skill.yml, reason about what actually deploys via vercel.json (now
  app.py-served: /forecast.html, /share, /share-card, /data all route to app.py),
  install Pillow / the bundled fonts for the share cards, trigger a data refresh,
  or diagnose a CI dependency-drift break. Triggers: "how do I run it", "install",
  "venv", "requirements", "Pillow", "fonts", "share card", "OG image",
  "OPENWEATHER_API_KEY", "env var", "secret", "Vercel", "GitHub Pages", "cron",
  "GitHub Action", "workflow", "deploy", "update-forecast", "update-skill",
  "generate_static_data", "forecast_skill", "which HTML deploys", "vercel routes".
---

# snowforcast — Build, Deploy, and Operations

The operational runbook for **snowforcast**, a ski-resort snow-forecast dashboard.
Install it, run it locally, set its secrets, and operate its live deploy target and
two scheduled jobs. This skill is thin on purpose: it owns *operations*, and points
you to sibling skills for everything else.

> **Audience note.** The real users are the owner and a few ski buddies planning
> trips over WhatsApp — no meteorology background. That does not change the commands
> here, but it is why the site must **fail loud, never silently show a default
> number** (see change-control). Keep it in mind when you touch a data path.

> **Refreshed 2026-07-11** to match the post-Codex redesign: `app.py` (Flask) is now
> the **primary serving layer**. `vercel.json` routes `/forecast.html`, `/`, `/data/*`,
> `/share/*`, `/share-card/*`, and `/api/*` all to `app.py`. The page is a static
> FILE but served + enhanced dynamically. Share previews and PNG cards are generated
> per-resort by `app.py` with **Pillow** (now a required dependency) and **bundled
> fonts** under `fonts/`.

---

## When to use this skill vs. a sibling

| You want to… | Use this skill? | Otherwise go to |
|---|---|---|
| Install, run locally, set env/secrets | ✅ Yes | — |
| Understand/edit the two cron workflows | ✅ Yes | — |
| Know which files actually deploy / how they route | ✅ Yes | — |
| Trigger a refresh, then check the data is *correct* | Trigger here | `snowforcast-data-integrity-and-validation` |
| Design/copy the dynamic share page + PNG card | No | `snowforcast-link-preview-and-positioning` |
| Repair a scrape the cron runs (selectors broke) | No | `snowforcast-scraper-resilience-campaign` |
| Understand *why* git-as-datastore / `fetch-depth: 0` exists | No | `snowforcast-architecture-contract` |
| The rules that gate any change before you edit | No | `snowforcast-change-control` (first stop) |
| A live symptom on the site/data, triage fast | No | `snowforcast-debugging-playbook` |

**Never route around change control.** Before editing the scraper, the JSON data,
or a front-end file, read `snowforcast-change-control` first.

---

## Glossary (each term defined once)

- **Scraper** — the code that fetches and parses snow-forecast.com HTML. The
  fragile core of the whole project. As of 2026-07-11 there are **3 real parsers**
  all keyed on the `forecast-table__table` table and `forecast-table__cell` rows:
  `generate_static_data.py::fetch_forecast` (the **live one CI runs**), plus
  `analyze_html.py` and `snow_forecast_parser.py`. A markup change breaks all three
  the same way. **No test/CI gate catches it.** Note the change from the old runbook:
  **`app.py` is no longer a parser** (verified 2026-07-11: 0 hits for
  `forecast-table__table`/`forecast-table__cell` in `app.py`) — it is now the serving
  layer, not a scraper. `enhanced_snow_forecast_parser.py` is **NOT** a real parser
  either — its live extraction method returns `random.randint`/`random.choice`
  **sample data** and its table-reading helpers are dead code. Treat it as a
  fabricating stub, not a parser to keep in sync.
- **The serving layer (`app.py`, Flask)** — now the **primary** production path.
  `vercel.json` routes `/forecast.html`, `/` (catch-all), `/data/*`, `/share/*`,
  `/share-card/*`, and `/api/*` to `app.py`. `app.py::_serve_forecast_html()` reads
  `forecast.html` from disk and runs it through `_enhance_forecast_html()` (injects a
  country-sort + share-button JS enhancement) before returning. So the page is a
  **static FILE, served and enhanced dynamically** by Flask on Vercel. Only the three
  alternates (`forecast-dark.html`, `forecast-modern.html`, `forecast_new.html`) are
  still served as raw static files.
- **The frozen JSON contract** — `data/all-forecasts.json`. The live front-end fetches
  it **directly from GitHub raw** in the browser (not from `app.py`). `app.py` *also*
  exposes `/data/<filename>` via `send_from_directory`, but the page does not use it.
  Fields may be **added** additively; existing fields must never change or disappear.
  (Owned by architecture-contract; named here only so operational commands make sense.)
- **The dynamic share system** — per-resort WhatsApp/OG sharing, generated by `app.py`
  (not static `<meta>` tags on `forecast.html`, which has none). `/share/<resort>/<elevation>`
  renders a per-resort HTML page with live `og:` tags; `/share-card/<resort>/<elevation>.png`
  renders a 1200×630 PNG with **Pillow**, with a `.svg` fallback. Requires the `Pillow`
  dependency and the **bundled fonts** under `fonts/`. The copy/positioning rules live
  in `snowforcast-link-preview-and-positioning`.
- **cron** — the `schedule:` trigger in a GitHub Actions workflow, in standard
  5-field crontab syntax.

---

## 1. Build reality: there is no build

Verified 2026-07-11: the repo has **no** `pyproject.toml`, `setup.py`, `setup.cfg`,
`tox.ini`, `Makefile`, `Dockerfile`, or lockfile. There is no packaging and no
compile/bundle step. "Build" means: create a virtualenv and `pip install` five
loosely-pinned dependencies.

`requirements.txt` (exact contents, verified 2026-07-11):

```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
flask>=3.0.0
Pillow>=10.0.0
```

All five are `>=` floors, not exact pins. There is no lockfile, so a fresh install
may pull newer versions than CI ever tested.

> **`Pillow` is now required** (added in the Codex redesign). `app.py` imports it under
> a `try/except` that sets `PIL_AVAILABLE` (verified `from PIL import Image, ImageDraw,
> ImageFont, ImageFilter` at app.py:12). If Pillow is missing, the `/share-card/*.png`
> route degrades to the SVG fallback rather than crashing — but on the live deploy you
> want the PNG, so keep Pillow installed. See §4d.

### Bundled fonts (required for deterministic PNG cards)

`fonts/` ships `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` (plus a `README.md`).
`app.py::_font()` (app.py:335) loads the **repo-bundled font first**, then falls back
to system paths, so the share card renders deterministically on Vercel/Lambda with no
system-font dependency. Do not delete `fonts/` — without it the card falls back to
`ImageFont.load_default()` and the layout degrades.

### Install (copy-paste)

```bash
cd "<repo-root>"          # the directory containing app.py and requirements.txt
python3 -m venv venv
source venv/bin/activate  # macOS/Linux; Windows: venv\Scripts\activate
pip install -r requirements.txt
```

> **Known hazard — Python version skew.** Local dev here runs **Python 3.10**
> (verified 2026-07-11: `python3 --version` → 3.10.0). Both GitHub Actions workflows
> pin **Python 3.11** (`setup-python@v5`, `python-version: '3.11'`). Code that works
> locally can behave differently in CI (and vice versa). If you hit a version-only
> bug, reproduce under 3.11 before trusting a local pass.

### Run locally

`app.py` has a `__main__` block (verified app.py:630). As of the redesign it simply
calls `app.run(debug=True)` — **it no longer reads a `PORT` env var**. Flask's dev
server therefore serves on its default **http://127.0.0.1:5000**:

```bash
python app.py
# serves Flask (debug) on http://127.0.0.1:5000
# open http://127.0.0.1:5000/forecast.html for the served+enhanced page,
#      http://127.0.0.1:5000/share/Val-Thorens/top for a share preview,
#      http://127.0.0.1:5000/share-card/Val-Thorens/top.png for the OG card.
```

> **Changed 2026-07-11:** the old runbook said `PORT`/`0.0.0.0:8080`. That is stale —
> the current `__main__` is `app.run(debug=True)` with no `PORT` read (verified: 0 hits
> for `PORT` in `app.py`). If you need a different port, pass it in code or set it up
> yourself; there is no env override anymore.

`generate_static_data.py` and `forecast_skill.py` also have `__main__` blocks and are
run directly (see §3). Everything else (`test_*.py`, `analyze_html.py`,
`compare_forecasts.py`) is a manual script, **not** a test suite — there is no test
framework in this repo.

---

## 2. Configuration, secrets, env vars

The only application secret is **`OPENWEATHER_API_KEY`**, read from the process
environment in exactly **one** place (verified 2026-07-11):

- `generate_static_data.py:524` — `os.environ.get('OPENWEATHER_API_KEY')`

> **Changed 2026-07-11:** the old runbook also listed `app.py:30`. That is stale — the
> redesigned `app.py` **no longer reads `OPENWEATHER_API_KEY` at all** (verified: 0 hits
> in `app.py`). OpenWeather enrichment now lives only in the scraper leg.

It **degrades gracefully with a printed warning** when unset
(`"⚠ OPENWEATHER_API_KEY not set, using snow-forecast.com only"`, generate_static_data.py:529)
— i.e. OpenWeather enrichment is optional; snow-forecast.com scraping still runs
without the key.

### Where the key lives per environment

| Environment | How to set it |
|---|---|
| Local dev | Export it in your shell, or put it in `.env` / `.env.local` (both gitignored) and load it yourself. `os.environ` is the only reader — the app does **not** auto-load a `.env`. |
| GitHub Actions | **Repository secret** `OPENWEATHER_API_KEY` (Settings → Secrets and variables → Actions). *Note:* neither workflow currently exports it into the job env — see §3 caveat. |
| Vercel | Project **Environment Variable** `OPENWEATHER_API_KEY` (used only if you run the scraper on Vercel; the live site's data comes from the cron-committed JSON). |

### Gitignored config (never commit)

`.gitignore` excludes `.env`, `.env.local`, and `mcp-template.json` (reference
template only). Confirmed present in `.gitignore` (2026-07-11).

> **NEVER hardcode a secret in source.** An API key was once committed and had to be
> scrubbed. Keys go in environment variables / platform secret stores, never in a
> `.py`, `.html`, or `.json` file. This is a change-control rule; do not relitigate it.

---

## 3. The two cron workflows

Both live in `.github/workflows/`, both push to `main` as **`github-actions[bot]`**
with `permissions: contents: write`, and both use `actions/checkout@v4` with
`${{ secrets.GITHUB_TOKEN }}`.

### 3a. `update-forecast.yml` — the 3-hourly data refresh

| Field | Value |
|---|---|
| Schedule | `cron: '0 */3 * * *'` (every 3 hours, on the hour) |
| Manual trigger | `workflow_dispatch` (Actions tab → Run workflow) |
| Python | 3.11 |
| Runs | `python3 generate_static_data.py` |
| Commits | `git add data/*.json` → commit `"Update forecast data - <date>"` → push (only if changed) |

This is **the only automation that keeps the live site fresh.** It scrapes
snow-forecast.com and commits whatever it gets. **A green run does NOT mean the data
is correct** — there is no validation gate. If the scraper silently returns garbage
or empties, the bot commits garbage. To verify correctness after a run, use
`snowforcast-data-integrity-and-validation`.

Run it by hand (`gh` CLI):

```bash
gh workflow run update-forecast.yml
gh run watch                       # follow the latest run
```

Or run the same script locally to preview what it would commit:

```bash
python generate_static_data.py     # writes data/all-forecasts.json + per-resort files
```

### 3b. `update-skill.yml` — the weekly skill-score job

| Field | Value |
|---|---|
| Schedule | `cron: '0 3 * * 1'` (Mondays 03:00 UTC) |
| Manual trigger | `workflow_dispatch` |
| Checkout | `fetch-depth: 0` (**full git history — required**) |
| Python | 3.11 |
| Runs | `python3 forecast_skill.py --days 45` |
| Commits | `git add data/skill.json` → commit `"Update model skill scores - <date>"` → push (only if changed) |

`forecast_skill.py` replays committed forecast JSON from **git history** (via
`subprocess` calls to `git log` / `git show`), which is why `fetch-depth: 0` is
mandatory — a shallow checkout would have no history to replay. `--days` is the
history window (verified: `argparse`, default 45). The *why* behind git-as-datastore
and the proxy-truth caveat live in `snowforcast-architecture-contract` and
`snowforcast-forecast-skill-methodology`; the skill-weighting scheme is currently
**dormant** — do not describe it as active.

Run it by hand:

```bash
gh workflow run update-skill.yml
# local preview (needs full history in your clone):
python forecast_skill.py --days 45     # writes data/skill.json
```

### 3c. ⚠️ CI dependency DRIFT — the trap in both workflows

Neither workflow installs from `requirements.txt`. This is a real, standing hazard
(unchanged by the redesign, re-verified 2026-07-11):

- **`update-forecast.yml`** pip-installs a **hand-typed subset**:
  `pip install requests beautifulsoup4 lxml`. It **omits `flask`** and **`Pillow`**,
  and **ignores all version pins**. `generate_static_data.py` happens not to need Flask
  or Pillow at import time today, so it works — but the install list and
  `requirements.txt` can drift apart silently. **Worse, the drift fails silently rather
  than crashing:** `generate_static_data.py` imports `multi_model` /
  `openweather_integration` under a `try/except` that sets `MULTI_MODEL_AVAILABLE` /
  `OPENWEATHER_AVAILABLE = False`. So a new third-party import in *either* of those
  modules raises `ImportError`, which is swallowed — the consensus / OpenWeather leg is
  **silently disabled**, the Action still exits 0 and commits degraded
  (green-but-thinner) data. (This is the single home for the CI-dependency-drift fact;
  `snowforcast-scraper-resilience-campaign` cross-references here rather than restating.)
- **`update-skill.yml`** installs **nothing**. `forecast_skill.py` imports only the
  standard library (`argparse`, `json`, `subprocess`, `datetime` — verified 2026-07-11).
  **If you add any third-party import (`requests`, `bs4`, etc.) to `forecast_skill.py`,
  the weekly job breaks silently with a `ModuleNotFoundError`** and there is no test to
  catch it.

**Rule of thumb before editing either script:** if you add a new third-party import,
you MUST also add it to that workflow's `pip install` line (or switch the step to
`pip install -r requirements.txt`). Do not assume `requirements.txt` covers CI — it
does not.

---

## 4. Deploy — what actually ships where

The **only live host is Vercel.** Know exactly how each URL routes.

### 4a. Vercel — serverless Flask serves almost everything

Config: `vercel.json`. Live URL: **https://snowforcast.vercel.app**

Builds declared (verified 2026-07-11):

| `src` | builder | Meaning |
|---|---|---|
| `app.py` | `@vercel/python` | Flask app as a serverless function — **the primary serving layer** |
| `forecast.html` | `@vercel/static` | canonical front-end **file** (but its route is overridden to `app.py` — see below) |
| `forecast-dark.html` | `@vercel/static` | experiment, served as a raw static file |
| `forecast-modern.html` | `@vercel/static` | experiment, served as a raw static file |
| `forecast_new.html` | `@vercel/static` | dark-theme alternate, served as a raw static file |

**Routes (in order — this is the important part):**

| Route | Destination | Note |
|---|---|---|
| `/forecast.html` | `app.py` | **dynamic** — served + enhanced by `_serve_forecast_html()` |
| `/forecast-dark.html` | `/forecast-dark.html` | raw static file |
| `/forecast-modern.html` | `/forecast-modern.html` | raw static file |
| `/forecast_new.html` | `/forecast_new.html` | raw static file |
| `/api/(.*)` | `app.py` | JSON/API endpoints |
| `/data/(.*)` | `app.py` | `send_from_directory('data', …)` |
| `/share/(.*)` | `app.py` | dynamic per-resort OG page |
| `/share-card/(.*)` | `app.py` | dynamic 1200×630 PNG (`.svg` fallback) |
| `/(.*)` | `app.py` | catch-all incl. `/` → the enhanced forecast page |

> **The canonical page is dynamic now.** Even though `forecast.html` is declared as a
> `@vercel/static` build, the `/forecast.html` and `/` routes send it to `app.py`, which
> reads the file from disk and runs `_enhance_forecast_html()` (country-sort + share
> button) before returning. A change to `forecast.html` still takes effect (it is the
> file being read), but the served bytes are the enhanced version, not the raw file.
> There is **no static-only production path** anymore.

### 4b. GitHub Pages — documented but NOT enabled (404)

`README` / `DEPLOYMENT.md` describe a GitHub Pages hosting path, but Pages is **not
enabled**. Verified 2026-07-08 (unchanged): `https://avielj.github.io/snowforcast/…`
returns **404**. The **only live origin is Vercel** (§4a). Do **not** cite
`avielj.github.io` as a live URL.

What *is* real is the **committed-JSON data fetch**: the live front-end fetches data
**in the browser** directly from
`https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json`
(and `…/metadata.json`) — verified in `forecast.html` (`DATA_URL`/`META_URL`, 2026-07-11).
That is GitHub **raw** (a JSON data fetch), **NOT** GitHub **Pages** (HTML hosting) —
keep the two distinct: raw is live, Pages is not.

> **The real production path is Vercel serving the enhanced `forecast.html` via
> `app.py`, and the browser then fetching the committed JSON from GitHub raw** — that
> is what the shared WhatsApp link actually loads. Note the split: the *page* is served
> by `app.py`, but the *data* is fetched by the browser from GitHub raw, not `app.py`.
> A change that only fixes `app.py`'s `/data` route does **not** change what the page
> shows; the front-end reads the GitHub-raw JSON.

### 4c. `vercel.json` vs. file drift — which HTML deploys

The repo contains more HTML files than `vercel.json` routes. Do not assume a file
deploys just because it exists.

| File | In `vercel.json`? | Status |
|---|---|---|
| `forecast.html` | ✅ built + routed to `app.py` | **Canonical** front-end (Codex redesign: topbar, share/compact buttons, hero, decision section, hash routing, localStorage favorites) — served dynamically |
| `forecast_new.html` | ✅ built + routed (static) | Dark-theme alternate |
| `forecast-dark.html` | ✅ built + routed (static) | Experiment |
| `forecast-modern.html` | ✅ built + routed (static) | Experiment |
| `forecast-dark2.html` | ❌ **unrouted** | Experiment — does **not** deploy via Vercel |
| `comprehensive.html` | ❌ **unrouted** | Experiment — does **not** deploy |
| `vt_page.html` | ❌ **unrouted** | Not deployed |
| `index-static.html` | ❌ unrouted | Experiment |

**`forecast.html` is the one that matters** as the live front-end. Front-end editing
rules live in `snowforcast-frontend-ui-contract`; the share page/card copy lives in
`snowforcast-link-preview-and-positioning`. Consult those before any UI/share change.

### 4d. The dynamic share endpoints (operational)

`app.py` generates sharing artifacts on demand (verified 2026-07-11):

- `GET /share/<resort>/<elevation>` → `share_preview()` builds a per-resort summary via
  `_forecast_summary()` and `render_template_string`s an HTML page carrying live
  `og:title` / `og:description` / `og:image` (image = the PNG below), plus
  `og:image:width=1200` / `height=630`.
- `GET /share-card/<resort>/<elevation>.png` → `share_card_png()` → `_share_card_png()`
  renders a **1200×630** PNG with Pillow (app.py:387 `W, H = 1200, 630`),
  `Cache-Control: public, max-age=300`. On any Pillow/render failure it falls back to
  `GET /share-card/<resort>/<elevation>.svg`.

Operational implications: **keep `Pillow` installed and `fonts/` present** for the PNG
path (§1). If share previews render but the image is blank/tofu, suspect a missing font
or Pillow. There are **no static `og:` meta tags on `forecast.html`** (verified: 0) and
**no `og/snowforcast-card.png` route in `vercel.json`** — sharing is entirely dynamic
through `app.py`.

---

## 5. Legacy / alternate: local crontab path

`cron_examples.txt` documents an **older local-machine crontab** approach that runs
`update_forecast.py` (a different, standalone script from the CI's
`generate_static_data.py`). It is **legacy/alternate only** — the GitHub Action is
the live automation.

⚠️ The example lines contain a **stale hardcoded path**
(`…/com~apple~CloudDocs/Snowforcast`) that does **not** match this checkout and will
**not** copy-paste correctly. Treat that file as historical documentation, not a
runbook. If you genuinely need a local cron, write your own line with the correct
absolute path to *this* repo.

---

## 6. Common operations — quick index

| I want to… | Command / action |
|---|---|
| Set up dev env | `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt` |
| Run the Flask app | `python app.py` (debug server on `http://127.0.0.1:5000`; no `PORT` override anymore) |
| Preview the served+enhanced page | open `http://127.0.0.1:5000/forecast.html` |
| Preview a share card/PNG | open `http://127.0.0.1:5000/share-card/Val-Thorens/top.png` |
| Refresh data locally (preview) | `python generate_static_data.py` |
| Recompute skill scores locally | `python forecast_skill.py --days 45` (needs full git history) |
| Trigger the 3-hourly refresh now | `gh workflow run update-forecast.yml` |
| Trigger the weekly skill job now | `gh workflow run update-skill.yml` |
| Add a secret to CI | Repo Settings → Secrets → Actions → `OPENWEATHER_API_KEY` |
| Add a secret to Vercel | Project → Settings → Environment Variables |
| Check what actually deploys | Read `vercel.json` — **Vercel is the sole live host**; most routes go to `app.py`; GitHub Pages is documented but 404/not enabled |
| Verify a refresh produced *correct* data | → `snowforcast-data-integrity-and-validation` |

---

## Provenance and maintenance

All facts here were verified against the repo on **2026-07-11** (post-Codex redesign).
Re-run these one-liners from the repo root when a fact may have drifted.

```bash
# No build/packaging files exist:
ls pyproject.toml setup.py setup.cfg tox.ini Makefile Dockerfile 2>/dev/null || echo "none (expected)"

# Dependencies (now 5 loose >= pins, incl. Pillow):
cat requirements.txt

# Pillow is imported under a guard; fonts are bundled:
grep -nE "from PIL|PIL_AVAILABLE" app.py
ls fonts/            # expect DejaVuSans.ttf, DejaVuSans-Bold.ttf, README.md
grep -n "_FONT_DIR\|DejaVuSans" app.py

# Local Python version (skew vs CI 3.11):
python3 --version

# app.py entry point: app.run(debug=True), NO PORT read:
grep -n "__main__" app.py
grep -nc "PORT" app.py                      # expect 0
grep -n "app.run" app.py

# Vercel routing — /forecast.html, /data, /share, /share-card, catch-all -> app.py:
cat vercel.json
grep -A2 '"/forecast.html"' vercel.json      # dest should be app.py

# The dynamic share/serving routes live in app.py:
grep -nE "@app.route|_serve_forecast_html|_enhance_forecast_html|share_preview|share_card_png|_share_card_png|_forecast_summary|_font" app.py

# forecast.html is the Codex redesign: no static OG tags, has topbar/share/compact:
grep -c 'property="og:' forecast.html        # expect 0
grep -cE 'topbar|copyShareLink|Share preview|Compact' forecast.html

# The two workflows: schedules, python-version, install lines, scripts:
grep -nE "cron|python-version|pip install|python3 |fetch-depth|contents:" .github/workflows/update-forecast.yml .github/workflows/update-skill.yml

# forecast_skill.py is stdlib-only (drift trap — adding an import breaks update-skill):
grep -nE "^import |^from " forecast_skill.py

# Secret is read from os.environ in generate_static_data.py ONLY (not app.py anymore):
grep -n "OPENWEATHER_API_KEY" app.py generate_static_data.py   # 0 hits in app.py

# The 3 real scraper parsers keyed on the same table (app.py is NO LONGER one; stub excluded):
grep -ln "forecast-table__cell\|forecast-table__table" generate_static_data.py analyze_html.py snow_forecast_parser.py
grep -c "forecast-table__table" app.py                          # expect 0
grep -c "forecast-table__table" enhanced_snow_forecast_parser.py # expect 0 (fabricating stub)

# Front-end fetches the frozen JSON from GitHub raw (not app.py):
grep -n "raw.githubusercontent.com" forecast.html

# Live host is Vercel (200); GitHub Pages is NOT enabled (404):
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/forecast.html       # expect 200
curl -so /dev/null -w '%{http_code}\n' https://avielj.github.io/snowforcast/forecast.html # expect 404

# Gitignored secrets/config:
grep -nE "\.env|mcp-template" .gitignore

# Legacy crontab doc with a stale hardcoded path:
cat cron_examples.txt
```

**Volatile facts to watch:** the 5-dep `requirements.txt` (esp. `Pillow`); presence of
`fonts/`; local Python version (currently 3.10.0, CI 3.11); the hand-typed
`pip install` line in `update-forecast.yml` (still omits `flask` and `Pillow`); the
`vercel.json` route table (which URLs go to `app.py`); the `raw.githubusercontent.com`
URL in `forecast.html`; the app.py `__main__` (currently `app.run(debug=True)`, no
`PORT`); the live host (`snowforcast.vercel.app` → 200 is the **sole** live origin;
GitHub Pages at `avielj.github.io/snowforcast` is documented but **404/not enabled**).
If any of these change, update this skill.

**Open / candidate (not verified live):** whether the Vercel serverless function ships
Pillow correctly at runtime (the code degrades to SVG if not) and the exact live behavior
of `/share-card/*.png` on Vercel were not exercised against the deployed function during
this refresh — verify with a live request if it matters.
