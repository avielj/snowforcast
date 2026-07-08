---
name: snowforcast-build-deploy-and-operations
description: >
  The single operational reference for snowforcast: how to install, run locally,
  configure env/secrets, and operate the live deploy target (Vercel; a GitHub
  Pages path is documented but NOT enabled — 404) and two GitHub Actions cron workflows. Load this when you need to set up a dev
  environment, run app.py, add or read a secret/env var, understand or edit
  .github/workflows/update-forecast.yml or update-skill.yml, reason about what
  actually deploys via vercel.json, trigger a data refresh, or diagnose a CI
  dependency-drift break. Triggers: "how do I run it", "install", "venv",
  "requirements", "OPENWEATHER_API_KEY", "env var", "secret", "Vercel", "GitHub
  Pages", "cron", "GitHub Action", "workflow", "deploy", "update-forecast",
  "update-skill", "generate_static_data", "forecast_skill", "which HTML deploys".
---

# snowforcast — Build, Deploy, and Operations

The operational runbook for **snowforcast**, a ski-resort snow-forecast dashboard.
Install it, run it locally, set its secrets, and operate its two deploy targets and
two scheduled jobs. This skill is thin on purpose: it owns *operations*, and points
you to sibling skills for everything else.

> **Audience note.** The real users are the owner and a few ski buddies planning
> trips over WhatsApp — no meteorology background. That does not change the commands
> here, but it is why the site must **fail loud, never silently show a default
> number** (see change-control). Keep it in mind when you touch a data path.

---

## When to use this skill vs. a sibling

| You want to… | Use this skill? | Otherwise go to |
|---|---|---|
| Install, run locally, set env/secrets | ✅ Yes | — |
| Understand/edit the two cron workflows | ✅ Yes | — |
| Know which files actually deploy | ✅ Yes | — |
| Trigger a refresh, then check the data is *correct* | Trigger here | `snowforcast-data-integrity-and-validation` |
| Repair a scrape the cron runs (selectors broke) | No | `snowforcast-scraper-resilience-campaign` |
| Understand *why* git-as-datastore / `fetch-depth: 0` exists | No | `snowforcast-architecture-contract` |
| The rules that gate any change before you edit | No | `snowforcast-change-control` (first stop) |
| A live symptom on the site/data, triage fast | No | `snowforcast-debugging-playbook` |

**Never route around change control.** Before editing the scraper, the JSON data,
or a front-end file, read `snowforcast-change-control` first.

---

## Glossary (each term defined once)

- **Scraper** — the code that fetches and parses snow-forecast.com HTML. The
  fragile core of the whole project. There are **4 real parsers** all keyed on the
  `forecast-table__table` table and `forecast-table__cell` rows:
  `generate_static_data.py::fetch_forecast` (the **live one CI runs**), plus
  `app.py`, `analyze_html.py`, and `snow_forecast_parser.py`. A markup change
  breaks all four the same way. **No test/CI gate catches it.**
  `enhanced_snow_forecast_parser.py` is **NOT** one of them — its live extraction
  method returns `random.randint`/`random.choice` **sample data** (verified: 0 hits
  for `forecast-table__table`, `random.randint` at line ~219) and its table-reading
  helpers are dead code. Treat it as a fabricating stub, not a parser to keep in
  sync.
- **Static path** — the real production path: the canonical `forecast.html` served
  statically by **Vercel** (`@vercel/static`), which fetches committed `data/*.json`
  from `raw.githubusercontent.com` (GitHub **raw**, a data fetch — NOT GitHub
  Pages, which is documented but not enabled; see §4b).
- **Dynamic path** — `app.py` (Flask) running as a Vercel serverless function.
  Secondary; the static pages do **not** depend on it.
- **The frozen JSON contract** — `data/all-forecasts.json`. Both live front-ends
  fetch it directly from GitHub raw. Fields may be **added** additively; existing
  fields must never change or disappear. (Owned by architecture-contract; named
  here only so operational commands make sense.)
- **cron** — the `schedule:` trigger in a GitHub Actions workflow, in standard
  5-field crontab syntax.

---

## 1. Build reality: there is no build

Verified 2026-07-08: the repo has **no** `pyproject.toml`, `setup.py`, `setup.cfg`,
`tox.ini`, `Makefile`, `Dockerfile`, or lockfile. There is no packaging and no
compile/bundle step. "Build" means: create a virtualenv and `pip install` four
loosely-pinned dependencies.

`requirements.txt` (exact contents):

```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
flask>=3.0.0
```

All four are `>=` floors, not exact pins. There is no lockfile, so a fresh install
may pull newer versions than CI ever tested.

### Install (copy-paste)

```bash
cd "<repo-root>"          # the directory containing app.py and requirements.txt
python3 -m venv venv
source venv/bin/activate  # macOS/Linux; Windows: venv\Scripts\activate
pip install -r requirements.txt
```

> **Known hazard — Python version skew.** Local dev here runs **Python 3.10**
> (verified: `python3 --version` → 3.10.0). Both GitHub Actions workflows pin
> **Python 3.11** (`setup-python@v5`, `python-version: '3.11'`). Code that works
> locally can behave differently in CI (and vice versa). If you hit a version-only
> bug, reproduce under 3.11 before trusting a local pass.

### Run locally

`app.py` has a `__main__` block (verified line 335). It reads `PORT` from the
environment, defaulting to 8080:

```bash
python app.py
# serves Flask on http://0.0.0.0:8080  (override with PORT=xxxx python app.py)
```

`generate_static_data.py` and `forecast_skill.py` also have `__main__` blocks and
are run directly (see §3). Everything else (`test_*.py`, `analyze_html.py`,
`compare_forecasts.py`) is a manual script, **not** a test suite — there is no test
framework in this repo.

---

## 2. Configuration, secrets, env vars

The only application secret is **`OPENWEATHER_API_KEY`**, read from the process
environment in exactly two places:

- `generate_static_data.py:524` — `os.environ.get('OPENWEATHER_API_KEY')`
- `app.py:30` — `os.environ.get('OPENWEATHER_API_KEY')`

Both **degrade gracefully with a printed warning** when it is unset
(`"⚠ OPENWEATHER_API_KEY not set, using snow-forecast.com only"`) — i.e. OpenWeather
enrichment is optional; snow-forecast.com scraping still runs without the key.

### Where the key lives per environment

| Environment | How to set it |
|---|---|
| Local dev | Export it in your shell, or put it in `.env` / `.env.local` (both gitignored) and load it yourself. `os.environ` is the only reader — the app does **not** auto-load a `.env`. |
| GitHub Actions | **Repository secret** `OPENWEATHER_API_KEY` (Settings → Secrets and variables → Actions). *Note:* neither workflow currently exports it into the job env — see §3 caveat. |
| Vercel | Project **Environment Variable** `OPENWEATHER_API_KEY`. |

### Gitignored config (never commit)

`.gitignore` excludes `.env`, `.env.local`, and `mcp-template.json` (reference
template only). Confirmed present in `.gitignore`.

> **NEVER hardcode a secret in source.** A Weather Unlocked API key was once
> committed and had to be scrubbed (git commit `bfff7287`). Keys go in environment
> variables / platform secret stores, never in a `.py`, `.html`, or `.json` file.
> This is a change-control rule; do not relitigate it.

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

Neither workflow installs from `requirements.txt`. This is a real, standing hazard:

- **`update-forecast.yml`** pip-installs a **hand-typed subset**:
  `pip install requests beautifulsoup4 lxml`. It **omits `flask`** and **ignores
  all version pins**. `generate_static_data.py` happens not to need Flask at import
  time today, so it works — but the install list and `requirements.txt` can drift
  apart silently. **Worse, the drift fails silently rather than crashing:**
  `generate_static_data.py` imports `multi_model` / `openweather_integration` under
  a `try/except` that sets `MULTI_MODEL_AVAILABLE` / `OPENWEATHER_AVAILABLE = False`.
  So a new third-party import in *either* of those modules raises `ImportError`,
  which is swallowed — the consensus / OpenWeather leg is **silently disabled**, the
  Action still exits 0 and commits degraded (green-but-thinner) data. (This is the
  single home for the CI-dependency-drift fact; `snowforcast-scraper-resilience-campaign`
  cross-references here rather than restating it.)
- **`update-skill.yml`** installs **nothing**. `forecast_skill.py` imports only the
  standard library (`argparse`, `json`, `subprocess`, `datetime` — verified). **If
  you add any third-party import (`requests`, `bs4`, etc.) to `forecast_skill.py`,
  the weekly job breaks silently with a `ModuleNotFoundError`** and there is no test
  to catch it.

**Rule of thumb before editing either script:** if you add a new third-party import,
you MUST also add it to that workflow's `pip install` line (or switch the step to
`pip install -r requirements.txt`). Do not assume `requirements.txt` covers CI — it
does not.

---

## 4. Dual deploy — what actually ships where

There are **two independent deploy targets**. Know which one you are reasoning about.

### 4a. Vercel — serverless Flask + a few static pages

Config: `vercel.json`. Live URL: **https://snowforcast.vercel.app**

Builds declared (verified):

| `src` | builder | Meaning |
|---|---|---|
| `app.py` | `@vercel/python` | Flask app as a serverless function |
| `forecast.html` | `@vercel/static` | canonical front-end |
| `forecast-dark.html` | `@vercel/static` | experiment (still built) |
| `forecast-modern.html` | `@vercel/static` | experiment (still built) |
| `forecast_new.html` | `@vercel/static` | live dark-theme alternate |

Routes (in order): `/forecast.html`, `/forecast-dark.html`, `/forecast-modern.html`,
`/forecast_new.html` map to their files; `/api/(.*)` and the catch-all `/(.*)` both
route to `app.py`.

### 4b. GitHub Pages — documented but NOT enabled (404)

`README` / `DEPLOYMENT.md` describe a GitHub Pages hosting path, but Pages is **not
enabled**. Verified 2026-07-08: `https://avielj.github.io/snowforcast/…` returns
**404**. The **only live origin is Vercel** (§4a) — that is where the canonical
`forecast.html` + `data/*.json` actually ship. Do **not** cite `avielj.github.io`
as a live URL.

What *is* real is the **committed-JSON data fetch**: both live front-ends fetch data
**not from `app.py`** but directly from
`https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json`
(verified in `forecast.html:961` and `forecast_new.html:919`). That is GitHub
**raw** (a JSON data fetch), **NOT** GitHub **Pages** (HTML hosting) — keep the two
distinct: raw is live, Pages is not. `index.html` is a tiny redirect to
`forecast.html` (verified).

> **The real production static path is Vercel serving `forecast.html`, which then
> fetches the committed JSON from GitHub raw** — that is what the shared WhatsApp
> link actually loads (it resolves to the Vercel URL, not `github.io`). A change
> that only fixes the Flask/`app.py` route does **not** fix the live site; the
> front-ends read the GitHub-raw JSON, not `app.py`.

### 4c. `vercel.json` vs. file drift — which HTML deploys

The repo contains more HTML files than `vercel.json` routes. Do not assume a file
deploys just because it exists.

| File | In `vercel.json`? | Status |
|---|---|---|
| `forecast.html` | ✅ built + routed | **Canonical** front-end |
| `forecast_new.html` | ✅ built + routed | **Live** dark-theme alternate (linked from `forecast.html:948`) |
| `forecast-dark.html` | ✅ built + routed | Experiment |
| `forecast-modern.html` | ✅ built + routed | Experiment |
| `forecast-dark2.html` | ❌ **unrouted** | Experiment — does **not** deploy via Vercel |
| `comprehensive.html` | ❌ **unrouted** | Experiment — does **not** deploy |
| `vt_page.html` | ❌ **unrouted** | Not deployed |
| `index-static.html` | ❌ unrouted | Experiment |

Only **`forecast.html` + `forecast_new.html`** matter as live front-ends. Everything
else is an experiment. Front-end editing rules live in
`snowforcast-frontend-ui-contract`; consult it before any UI change.

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
| Run the Flask app | `python app.py` (port 8080, override `PORT=`) |
| Refresh data locally (preview) | `python generate_static_data.py` |
| Recompute skill scores locally | `python forecast_skill.py --days 45` (needs full git history) |
| Trigger the 3-hourly refresh now | `gh workflow run update-forecast.yml` |
| Trigger the weekly skill job now | `gh workflow run update-skill.yml` |
| Add a secret to CI | Repo Settings → Secrets → Actions → `OPENWEATHER_API_KEY` |
| Add a secret to Vercel | Project → Settings → Environment Variables |
| Check what actually deploys | Read `vercel.json` — **Vercel is the sole live host**; GitHub Pages is documented but 404/not enabled |
| Verify a refresh produced *correct* data | → `snowforcast-data-integrity-and-validation` |

---

## Provenance and maintenance

All facts below were verified against the repo on **2026-07-08**. Re-run these
one-liners from the repo root when a fact may have drifted.

```bash
# No build/packaging files exist:
ls pyproject.toml setup.py setup.cfg tox.ini Makefile Dockerfile 2>/dev/null || echo "none (expected)"

# Dependencies (4 loose >= pins):
cat requirements.txt

# Local Python version (skew vs CI 3.11):
python3 --version

# The two workflows: schedules, python-version, install lines, scripts:
grep -nE "cron|python-version|pip install|python3 |fetch-depth|contents:" .github/workflows/update-forecast.yml .github/workflows/update-skill.yml

# forecast_skill.py is stdlib-only (drift trap — adding an import breaks update-skill):
grep -nE "^import |^from " forecast_skill.py

# Secret is read from os.environ only:
grep -n "OPENWEATHER_API_KEY" app.py generate_static_data.py

# Entry points (__main__):
grep -n "__main__" app.py generate_static_data.py forecast_skill.py

# What Vercel builds/routes (vs. files that exist):
cat vercel.json
ls forecast*.html comprehensive.html vt_page.html index*.html

# Front-ends fetch the frozen JSON from GitHub raw (not app.py):
grep -n "raw.githubusercontent.com" forecast.html forecast_new.html

# The 4 real scraper parsers keyed on the same table (enhanced_snow_forecast_parser.py is a stub — excluded):
grep -ln "forecast-table__cell\|forecast-table__table" generate_static_data.py app.py analyze_html.py snow_forecast_parser.py
# Confirm the stub fabricates instead of parsing (0 table hits, random sample data):
grep -c "forecast-table__table" enhanced_snow_forecast_parser.py   # expect 0
grep -n "random.randint\|sample data" enhanced_snow_forecast_parser.py

# Live host is Vercel (200); GitHub Pages is NOT enabled (404):
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/forecast.html      # expect 200
curl -so /dev/null -w '%{http_code}\n' https://avielj.github.io/snowforcast/forecast.html # expect 404

# Gitignored secrets/config:
grep -nE "\.env|mcp-template" .gitignore

# Legacy crontab doc with a stale hardcoded path:
cat cron_examples.txt
```

**Volatile facts to watch:** local Python version (currently 3.10.0, CI 3.11); the
hand-typed `pip install` line in `update-forecast.yml`; the set of files in
`vercel.json` builds/routes; the `raw.githubusercontent.com` URL in the front-ends;
the live host (`snowforcast.vercel.app` → 200 is the **sole** live origin; GitHub
Pages at `avielj.github.io/snowforcast` is documented but **404/not enabled** — if
Pages is ever turned on, revisit §4b). If any of these change, update this skill.
