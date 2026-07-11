# snowforcast — Repo Atlas (versioned-repo-atlas-steward)

Cross-run repo knowledge so a fleet cites facts instead of re-deriving them.
Each entry carries a **confidence** and an **expiry/re-check** trigger. A steward
opening a run should staleness-check entries against `git log` since the recorded
HEAD and file discoveries back at run end.

- **Atlas version:** 2 (2026-07-11)
- **Recorded HEAD at write:** `68e0e389` is the last real (non-bot) commit; HEAD
  moves every ~3h via the `github-actions[bot]` "Update forecast data" cron, so
  do NOT staleness-check against raw HEAD — check against the last non-bot commit:
  `git log --oneline | grep -v "Update forecast data" | head -1`.
- **What changed since v1 (Codex redesign, 2026-07-11):** the front-end / serving /
  share layer was rebuilt. `app.py` is now the PRIMARY serving path (was documented
  as secondary), `forecast.html` is a redesigned dashboard served + enhanced through
  Flask, and WhatsApp/OG sharing is now DYNAMIC per-resort (`/share/*`,
  `/share-card/*.png` via Pillow). The domain pipeline (scraper, 7-source median
  consensus, JSON contract, cron Actions) is UNCHANGED. See rows below.

## Build / run / test commands (VERIFIED 2026-07-11)

| Purpose | Command | Confidence | Re-check |
|---|---|---|---|
| Install deps | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` | verified | if requirements.txt changes |
| Deps are | `requests, beautifulsoup4, lxml, flask, Pillow` (Pillow ADDED 2026-07-11 for the dynamic share-card PNG) | verified 2026-07-11 | `cat requirements.txt` |
| Data generation (the live CI job) | `python3 generate_static_data.py` | verified imports; **slow, live-network, did not finish a 22s partial run** | re-time; watch for site rate-limits |
| Skill scoring (weekly CI job) | `python3 forecast_skill.py --days 45` | verified exit 0, stdlib-only | — |
| Run Flask app | `python3 app.py` (needs venv; bare system py3.10 lacks bs4; Pillow now also required for `/share-card/*.png`) | verified | — |
| "Tests" | `test_openmeteo.py`, `test_vt_scrape.py` are **manual network scripts, NOT a suite** — no pytest, no assertions, no CI test gate | verified | — |
| Syntax gate (there is no CI one) | `python3 -m py_compile *.py` | verified | run before any commit |

## Deploy / hosting (VERIFIED 2026-07-11 — REWRITTEN this version)

- **LIVE origin = Vercel only. `https://snowforcast.vercel.app/forecast.html` → 200.**
- **GitHub Pages `https://avielj.github.io/snowforcast/…` → 404 (NOT enabled).**
  README/DEPLOYMENT.md describe Pages as a hosting path — documented but not live.
  Re-check: `curl -so /dev/null -w '%{http_code}' <url>`.
- **`app.py` is the PRIMARY serving layer, not a fallback.** `vercel.json` builds
  `app.py` with `@vercel/python` and routes nearly everything to it:
  `/forecast.html → app.py`, `/api/(.*) → app.py`, `/data/(.*) → app.py`,
  `/share/(.*) → app.py`, `/share-card/(.*) → app.py`, and a catch-all
  `/(.*) → app.py`. Only `/forecast-dark.html`, `/forecast-modern.html`,
  `/forecast_new.html` route to their `@vercel/static` files. Verify:
  `grep -A2 '"/forecast.html"' vercel.json`. Confidence: verified 2026-07-11.
- **`forecast.html` is a static FILE but SERVED DYNAMICALLY.** `@app.route('/')` /
  `@app.route('/forecast.html')` → `_serve_forecast_html()` reads `forecast.html`
  from disk and runs it through `_enhance_forecast_html()` (app.py:169), which injects
  a `<style>` patch + a share-button/JS enhancement (`copyShareLink`/
  `robustShareForecast`, builds `${origin}/share/<resort>/<elevation>` links) before
  returning. Edit the file on disk; it is not served raw. Confidence: verified.
- **Dynamic per-resort WhatsApp/OG sharing (NEW):**
  - `@app.route('/share/<resort>/<elevation>')` → `share_preview()` (app.py:505)
    `render_template_string`s a per-resort HTML page with live `og:title` /
    `og:description` / `og:image` (1200×630) + `twitter:card=summary_large_image`.
    `forecast.html` has **zero static `og:`/`twitter:` meta** (`grep -c 'property="og:'
    forecast.html` → 0) — all sharing meta is emitted by this route.
  - `@app.route('/share-card/<resort>/<elevation>.png')` → `share_card_png()` →
    `_share_card_png(summary)` (app.py:381) renders a 1200×630 PNG per resort with
    **Pillow** (alpine night-mountain scene, per-resort headline, big snow number,
    status pill, all-elevations strip). Cache-Control `public, max-age=300`.
  - **SVG fallback:** `@app.route('/share-card/<resort>/<elevation>.svg')` →
    `share_card_svg()`; `share_card_png` falls back to it on any Pillow exception.
  - **Fonts are repo-bundled:** `fonts/DejaVuSans.ttf` + `fonts/DejaVuSans-Bold.ttf`.
    `_font()` (app.py:335) tries the bundled path FIRST (then `/usr/share/fonts/...`,
    then `load_default`) so the card renders deterministically on Vercel/Lambda — no
    system-font dependency, no tofu. Confidence: verified.
  - `_forecast_summary(resort, elevation)` (app.py:102) builds per-resort data (snow,
    rain, peak wind, status, best window, next3, all_elevations, updated stamp).
    Status thresholds: `Good ✅` (snow≥20, rain≤8, wind≤45), else `Watch ⚠️`
    (snow≥6 or rain≤18), else `Low ⛔`.
- **Front-end still fetches DATA from GitHub raw, not app.py.** `forecast.html`
  fetches `raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/
  all-forecasts.json` (+ `metadata.json`), `{cache:'no-store'}` (line 23). `app.py`
  ALSO exposes `/data/<filename>` via `send_from_directory`, but the live page uses
  the GitHub-raw URL. `data/all-forecasts.json` is still the frozen deployed contract.
  Confidence: verified 2026-07-11.
- **No `/og/*` static-card route.** `vercel.json` has NO `/og/` route and there is no
  `og/` directory — the live share card is the DYNAMIC `/share-card/*.png`. (v1 of a
  sibling fact sheet mentioned a static `/og/(.*)` route; that is NOT in the repo.)
  Confidence: verified (grep of vercel.json + `ls og/` empty).

## Traps (each cost real time — see snowforcast-failure-archaeology)

| Trap | Detail | Confidence |
|---|---|---|
| Green Action ≠ correct data | The 3-hourly cron commits whatever it scrapes; a markup/rate-limit break commits empty/garbage JSON with no gate. | verified (no test gate) |
| `enhanced_snow_forecast_parser.py` is a STUB | Returns random sample data (lines ~175-232); does NOT parse `forecast-table__table`. Do not treat as a real parser. | verified (0 grep hits) |
| Real table-parsers | `generate_static_data.py`, `app.py`, `analyze_html.py`, `snow_forecast_parser.py` all key on `forecast-table__table`/row data-attrs — a markup change breaks them together. | verified |
| `all-forecasts.json` = frozen contract | Add fields additively only; never rename/remove — the deployed page reads it by raw URL and breaks silently otherwise. | verified (owner-confirmed) |
| Silent 2300m snow-line | Historical bug (fixed `bfff7287`): a missing elevation key fell back to Val Thorens' 2300m for other resorts. FAIL LOUD — never default. | verified |
| `main` is force-pushable | A merged redesign PR (`d6e679e1`) was force-push-wiped from history. Treat main as append-only. | verified |
| Committed secret in history | Weather Unlocked key/app_id recoverable at `d65ce5a2` (removed `bfff7287`); rotate, treat as compromised. Refer by SHA, never echo the literal. | verified |
| Canonical HTML is now Flask-served | `forecast.html` is still the canonical page, but is now SERVED + enhanced through `app.py` (`_serve_forecast_html`/`_enhance_forecast_html`), not shipped raw. Edit the file; test via `python3 app.py`, not by opening the file. `forecast_new.html` = alt; `forecast-dark/modern.html`, `comprehensive.html`, `index-static.html` are experiments. | verified 2026-07-11 |
| Share meta lives in app.py, not the HTML | Do NOT add static `og:`/`twitter:` tags to `forecast.html` — sharing is dynamic per-resort via `/share/<resort>/<elevation>`. Adding static tags would be dead/misleading. | verified 2026-07-11 |
| Share card depends on Pillow + bundled fonts | If Pillow is missing or `fonts/DejaVuSans*.ttf` are removed, `/share-card/*.png` degrades (SVG fallback / `load_default` tofu). Keep both in the repo. | verified 2026-07-11 |
| Skill-weighting is dormant | `data/skill.json` MAE all 0.0, `consensus.skill_weights` null → the "skill-weighted consensus" is a plain **median**. Don't advertise "skill-weighted/AI". | verified |

## Flaky / network-dependent areas

- Anything touching `snow-forecast.com` (all real parsers), `open-meteo.com`,
  `ensemble-api.open-meteo.com`, `api.met.no` — intermittent failures are
  network/site, not code. No retry/backoff in `generate_static_data.py`
  (27 sequential no-delay requests, single UA, no cookie). Confidence: verified.
- `_share_card_png` renders per request with `random`/`math` (procedural snow scene);
  visual output is non-deterministic in layout details but font rendering is
  deterministic (bundled DejaVu). Confidence: verified (read app.py:381+).

## Env quirks

- iCloud path with spaces ("Mobile Documents") — quote all shell paths; unquoted
  `xargs`/`ls` pipelines word-split (this bit `fable.local/install.sh`).
- System Python 3.10 lacks `bs4`; CI pins 3.11 and installs a hand-typed dep
  subset (`pip install requests beautifulsoup4 lxml`, omits flask AND Pillow) that
  can drift from `requirements.txt`. No lockfile — the CI subset does not cover the
  share layer, but CI only runs the scraper, so that is currently harmless.

## Cross-references (sibling skills)

- `snowforcast-architecture-contract` — app.py primary serving layer, data GitHub-raw, frozen JSON.
- `snowforcast-build-deploy-and-operations` — Vercel routing, Pillow, bundled fonts, cron Actions.
- `snowforcast-link-preview-and-positioning` — dynamic `/share` + `/share-card` system, copy/positioning rules.
- `snowforcast-frontend-ui-contract` — the Codex-redesigned `forecast.html` served via `_enhance_forecast_html`.
- `snowforcast-change-control` — canonical-file + fail-loud + env-secrets rules.
- `snowforcast-failure-archaeology` — the traps above, by SHA.

## Maintenance

Update this atlas when a run discovers a new trap or a command changes. Bump the
version and the recorded-HEAD line. Do not let entries outlive their re-check
trigger silently — a stale atlas that reads authoritative is worse than none.
