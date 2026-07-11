---
name: snowforcast-change-control
description: >-
  The non-negotiable rules that gate EVERY change to the snowforcast ski-forecast
  dashboard, each tied to the incident that created it. READ THIS FIRST before
  editing the scraper (generate_static_data.py / snow_forecast_parser.py /
  enhanced_snow_forecast_parser.py), the serving layer (app.py), the data
  contract (data/all-forecasts.json), or the front-end HTML (forecast.html). Load
  when the task touches: scraping, forecast JSON fields, fallback/default values,
  missing-data handling, secrets/API keys, which HTML page is "real", how the page
  is served (app.py / Vercel), the dynamic /share + /share-card layer, or the
  GitHub Actions data-refresh cron. If you are about to add a default, a fallback,
  or "fix" the site, STOP and read this first.
---

# snowforcast Change Control

The hard rules that gate every change. Break one and you re-break something that
already cost real debugging time. Each rule carries a one-line incident anchor so
you know it is not arbitrary.

**This is a rules gate, not a tutorial.** For *why* something broke, read
`snowforcast-failure-archaeology`. For *how the system is shaped*, read
`snowforcast-architecture-contract`. This skill only tells you what you may not
do — and no other skill may route around it.

## What this project is (30-second orientation)

`snowforcast` is a ski-resort snow-forecast dashboard. A Python scraper pulls
6-day forecasts from `snow-forecast.com` for ~10 resorts × 3 elevations, blends
in Open-Meteo model data, and writes `data/all-forecasts.json`. The canonical
front-end page (`forecast.html`) fetches that JSON straight from GitHub raw and
renders it; on Vercel that page is now **served and enhanced through `app.py`**,
which also renders the dynamic per-resort share/OG layer (see Rule 5). A cron
GitHub Action re-scrapes every 3 hours and commits the result. Audience: the
owner and ski buddies planning trips over WhatsApp — **no meteorology background
assumed.**

---

## Rule 0 (TOP RULE) — FAIL LOUD, NEVER SILENTLY SUBSTITUTE

> **Missing or failed real data must surface as a visible error in BOTH the JSON
> and the UI. Never a silent default.** For a forecast product, a silently-wrong
> number erodes trust more than a visible "data unavailable". If you cannot get
> real data, say so loudly — do not paper over it.

**Why this rule exists (incidents):**

- **The 2300 m elevation default.** A hardcoded snow-line / elevation default
  silently applied Val Thorens' bottom-station elevation (2300 m) to other
  resorts. Users saw plausible-looking numbers that were wrong. Verify the
  surviving config yourself: `grep -n 2300 generate_static_data.py` →
  `'Val-Thorens': {'bot': 2300, 'mid': 2800, 'top': 3230}` (as of 2026-07-11,
  `generate_static_data.py:485`). Per-resort elevations must come from that
  resort's own config, never a shared default.

- **`fill_missing_days_from_openmeteo` fabricates data that is indistinguishable
  from scraped data.** In `generate_static_data.py` (verified 2026-07-11, function
  at line 364, invoked at line ~585), when a scraped forecast is short on days, the
  code synthesizes extra days from Open-Meteo daily averages and INVENTS wind,
  feels-like, and the AM/PM/Night snow split, landing them in the same fields as
  real scraped values with **no marker**. That is exactly the failure mode this
  rule forbids.

  > The **exact fabricated constants** (the literal wind string, the feels-like
  > offsets, the snow-split fractions) live in ONE home — a fingerprint table in
  > `snowforcast-data-integrity-and-validation`, **PART A** — so that one code
  > change can't silently falsify multiple copies. Do not re-list the magic values
  > here; read them there.

**The rule you must follow:**

1. **Never add a "use a default when real data is missing" path.** If real data
   is missing, emit an explicit error/absent marker, not a plausible substitute.
2. **Any synthetic / interpolated / defaulted value MUST be labeled as such** in
   the JSON (e.g. a `synthetic: true` / `source: "openmeteo-fill"` marker on the
   value or day) **and** surfaced in the UI (a visible badge/asterisk), so a
   reader can tell fabricated from scraped. Adding such a marker field is an
   *additive* change — allowed under Rule 1.
3. The existing `fill_missing_days_from_openmeteo` output is a **known,
   pre-existing violation** — do not copy its pattern, and if you touch that
   function, add the missing labels rather than extending the unlabeled fabrication.

> Cross-ref: `snowforcast-data-integrity-and-validation` is how you *measure*
> that data is real vs fabricated. `snowforcast-failure-archaeology` has the full
> 2300 m narrative. This skill only states the rule.

---

## Rule 1 — `data/all-forecasts.json` is a FROZEN DEPLOYED CONTRACT

The front-end fetches it directly from GitHub raw. This is true **whether the page
is served statically or through `app.py`** — the serving change in Rule 5 did NOT
move the data source. The page reads:

```
https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json
```

Verified 2026-07-11: this exact URL appears in `forecast.html:23` (as the minified
`DATA_URL` const, alongside `META_URL` for `metadata.json`) and in
`forecast_new.html:919`. (`app.py` also exposes `/data/<filename>` via
`send_from_directory` at `app.py:594`, but the live page uses the GitHub-raw URL,
not that route.)

**The rule:**

| Allowed | Forbidden |
|---|---|
| ADD new fields additively | Rename any existing field |
| ADD a new nested block | Remove / drop any existing field or path |
| Add a `synthetic`/`source` marker (Rule 0) | Change the type or units of an existing field |
| | Reorder in a way a consumer depends on |

Existing fields and paths **must never change, rename, or disappear** — the live
page reads them by name and will break **silently** (no error, just blank or
wrong cells) if they move.

**Precedent for the ONLY safe way to extend it:** the consensus fields were added
purely additively and coexist with the originals. Verify they are present:
`grep -o 'snowfall_range\|snowfall_models\|snowfall_sources' data/all-forecasts.json | sort | uniq -c`
(216 occurrences each as of 2026-07-11), plus an additive `"extended"` block.
Follow that pattern for any new field.

---

## Rule 2 — `forecast.html` is the ONE canonical page — and it is now served THROUGH `app.py`

**Refreshed 2026-07-11 (post-Codex redesign):** the old "static build served
directly by `@vercel/static`" description is **superseded**. `forecast.html` is
still the canonical page and is still edited as a file on disk, but on Vercel the
route `/forecast.html` (and `/`) is now handled by `app.py`, which reads the file
and runs it through an enhancement pass before returning it.

| File | Status | Evidence (verified 2026-07-11) |
|---|---|---|
| `forecast.html` | **CANONICAL** — the `index.html` redirect target; served dynamically via `app.py::_serve_forecast_html()` → `_enhance_forecast_html()` | `index.html:9` `window.location.href='forecast.html'`; `vercel.json` route `{"src":"/forecast.html","dest":"app.py"}`; `app.py:496-498` `@app.route('/')` + `@app.route('/forecast.html')` → `index()` → `_serve_forecast_html()` (`app.py:326`) |
| `forecast_new.html` | **LEGACY / candidate-dead** — still a `@vercel/static` build with its own direct route, fetches the same JSON, but is **no longer linked** from `forecast.html` (the Codex redesign dropped the link) | still deployed via `vercel.json` route `/forecast_new.html → /forecast_new.html`; `grep -n forecast_new forecast.html` → **no match** (was linked before the redesign) |
| `forecast-dark.html`, `forecast-modern.html` | EXPERIMENT (listed as static builds in `vercel.json` with direct routes, but not the canonical page) | — |
| `forecast-dark2.html`, `comprehensive.html`, `index-static.html`, `vt_page.html` | EXPERIMENT / scratch | — |

**How `forecast.html` is served (verify before you assume static):** `app.py`
reads `forecast.html` from disk in `_serve_forecast_html()` and passes it through
`_enhance_forecast_html()` (`app.py:169`), which injects a JS enhancement —
country-ordered resort sorting, favorite pinning, and the share-button wiring
(`copyShareLink` → `/share/<resort>/<elevation>`). So the DOM the user gets is the
file **plus** the app.py enhancement. A change to page structure that the
enhancement hooks into (e.g. `resortKeys`, `currentResort`, `#top-share-btn` /
`#share-btn` / `[data-share-button]`) can break the enhancement even though the raw
file looks fine — and vice versa.

**The `forecast.html` page itself is the Codex redesign:** a topbar (brand mark +
"Share preview" / "Compact mode"), a hero, a metrics grid, a decision section, hash
routing (`#<resort>/<elevation>`), and favorites in `localStorage`. It carries **no
static `og:`/`twitter:` meta tags** (`grep -c 'property="og:' forecast.html` → 0);
sharing is dynamic and lives in `app.py` (Rule 5).

**The rule:**
- **Edit the canonical page as a file** (`forecast.html`) — but remember it is
  **served through `app.py`**, not shipped raw. If you change markup the
  `_enhance_forecast_html` script depends on, update the enhancement too.
- **Never edit an experiment assuming it ships.** Do not "fix"
  `forecast-modern.html`/`forecast-dark.html` and expect users to see it.
- Treat `forecast_new.html` as legacy: it is still deployed but nothing links to
  it. Do **not** invest UI changes there expecting users to reach it; if you
  believe it should be removed, that is an open question — confirm with the owner,
  do not silently delete a still-routed file.

> Cross-ref: `snowforcast-frontend-ui-contract` for how the canonical page fetches
> and renders and the rendering fragility to avoid; `snowforcast-link-preview-and-positioning`
> for the dynamic share/OG copy standards.

---

## Rule 3 — Secrets are env-only. Never hardcode a fallback secret.

**The rule:** all secrets come from the environment (`os.environ`) or a
gitignored `.env`. Verified 2026-07-11: `.env` and `.env.local` are in
`.gitignore` (`.gitignore:48-49`); key reads use `os.environ.get('OPENWEATHER_API_KEY')`
(`generate_static_data.py:524`, `openweather_integration.py:16`). **Never** write a
literal key as a default/fallback, e.g. `key = os.environ.get('X') or 'abc123'` —
that defeats the whole point.

> Note (refreshed 2026-07-11): `app.py` no longer reads `OPENWEATHER_API_KEY`
> directly — the old `app.py:30` read is gone now that `app.py` is a
> serving/share layer, not a scraper (Rule 5). The env-only rule is unchanged; only
> the evidence line moved.

**Why (incident):** a Weather Unlocked key and `app_id` (values REDACTED — never
copy a live secret into a skill file) were hardcoded and committed. They were
removed from HEAD, but **remain recoverable in git history** — verify by SHA,
without echoing the secret:
`git show d65ce5a2:weatherunlocked_integration.py | grep -iE 'app_id|app_key'`
(the add is `d65ce5a2`, the removal `bfff7287`; confirmed 2026-07-11). Because the
secret is in history, treat that key/app_id as **compromised — rotate, never
reuse.**

**Corrective control to preserve:** commit `bfff7287` added the guard
`if not self.app_id or not self.app_key:` (verified present in that commit's
diff, 2026-07-11) so a missing secret fails cleanly instead of falling back to a
baked-in value. Weather Unlocked was later removed entirely in `06121221`; if you
reintroduce any keyed API, reproduce that guard pattern.

> Cross-ref: `snowforcast-build-deploy-and-operations` for how env/secrets are
> configured and set locally and on Vercel.

---

## Rule 4 — A green data-refresh Action does NOT mean the data is correct

**There is NO code/test/lint/type CI gate in this repo.** The only automation is
a cron that commits whatever it scrapes.

Verified 2026-07-11 (`.github/workflows/`):

- `update-forecast.yml` — `cron: '0 */3 * * *'` (every 3 hours), runs
  `python3 generate_static_data.py`, then
  `git diff --quiet && git diff --staged --quiet || (git commit -m "Update forecast data - $(date -u)" && git push)`.
- `update-skill.yml` — `cron: '0 3 * * 1'` (weekly), scores models, commits.

Neither runs tests, lint, or type checks. `test_openmeteo.py` and
`test_vt_scrape.py` are **manual network scripts, not a suite** — nothing invokes
them in CI.

**The rule:**
- A ✅ on the Action means "the script ran and committed" — it says **nothing**
  about whether the numbers are right (the scraper can succeed at parsing garbage
  if the markup changed).
- After any change to the scraper or data pipeline, **you** are the gate: inspect
  the produced JSON before trusting it. Do not claim "CI passed so it's fine."

> Cross-ref: `snowforcast-scraper-resilience-campaign` (detect + repair scraper
> breakage), `snowforcast-data-integrity-and-validation` (how to check the JSON),
> `snowforcast-debugging-playbook` (live-symptom triage).

---

## Rule 5 — `app.py` now SERVES the site (and the share layer) — but data bugs still live in the scraper, not here

**Refreshed 2026-07-11 (post-Codex redesign):** the old "`app.py` is SECONDARY,
the static path is real" framing is **inverted**. `app.py` is now the **primary
serving path on Vercel**. `vercel.json` routes `/` and `/forecast.html`, plus
`/share/(.*)`, `/share-card/(.*)`, `/data/(.*)`, `/api/(.*)`, and the catch-all
`/(.*)`, all to `app.py`. It:

- **Serves the canonical page** — `_serve_forecast_html()` reads `forecast.html`
  and enhances it (Rule 2).
- **Renders the dynamic per-resort share/OG layer** — `@app.route('/share/<resort>/<elevation>')`
  (`app.py:505`) → `share_preview()` builds a per-resort HTML page with live
  `og:title`/`og:description`/`og:image` via `render_template_string`; and
  `@app.route('/share-card/<resort>/<elevation>.png')` (`app.py:548`) →
  `share_card_png()` → `_share_card_png()` (`app.py:381`) renders a 1200×630 PNG
  per resort with **Pillow** (`requirements.txt` includes `Pillow>=10.0.0`), using
  fonts bundled at `fonts/DejaVuSans[-Bold].ttf` so the card renders
  deterministically on Vercel/Lambda. An SVG fallback lives at
  `/share-card/<resort>/<elevation>.svg`.

**But the rule that survives:** the forecast **data** the page shows still comes
from `data/all-forecasts.json` fetched from **GitHub raw** (Rule 1), not from
`app.py`. So if the live site shows wrong/stale **numbers**, the fix is almost
never in `app.py` — the culprits are the scraper (`generate_static_data.py`, the
cron script) or the JSON contract. Editing `app.py` will change how the page/share
is *served and framed*, not the underlying forecast values.

**What `app.py` IS the right layer for now:** serving/enhancement of the page, the
`/share` OG page, the `/share-card` PNG/SVG, and the `/data`/`/api` routes. What it
is NOT: the source of truth for forecast numbers.

> Note (refreshed 2026-07-11): `app.py` **no longer contains a copy of the
> scraper** — the old `forecast-table__table` parser at `app.py:173` is gone
> (`grep -n 'forecast-table__table' app.py` → no match). `app.py` is now a
> serving/share layer. The near-duplicate parsers to keep in sync now live in the
> scraper modules; see `snowforcast-scraper-resilience-campaign`.

---

## Pre-flight checklist (run before you edit)

- [ ] Am I about to add a default / fallback / "if missing, use X"? → **STOP.**
      Rule 0. Fail loud or label synthetic instead.
- [ ] Am I changing a field name/path/type in `all-forecasts.json`? → **STOP.**
      Rule 1. Additive only.
- [ ] Am I editing an HTML file that is not `forecast.html`? → It's an experiment
      (or legacy `forecast_new.html`). Rule 2. And remember `forecast.html` ships
      **through `app.py`** — mind the `_enhance_forecast_html` hooks.
- [ ] Am I about to write a literal API key/secret anywhere? → **STOP.** Rule 3.
      Env-only.
- [ ] Am I trusting a green Action as proof the data is right? → Rule 4. Inspect
      the JSON yourself.
- [ ] Am I "fixing wrong NUMBERS" by editing `app.py`? → Rule 5. Wrong layer —
      data comes from the scraper/GitHub-raw JSON. (Serving, share, and OG *are*
      app.py's job.)

## When NOT to use this skill

- You want to understand **why** something broke, with evidence and status →
  `snowforcast-failure-archaeology`.
- You want the **design rationale / invariant mechanics** behind these rules →
  `snowforcast-architecture-contract`.
- You are triaging a **live symptom** right now → `snowforcast-debugging-playbook`.
- The scraper is **actually broken** and you need to repair selectors →
  `snowforcast-scraper-resilience-campaign`.
- You are working on the **share/OG copy or card design** →
  `snowforcast-link-preview-and-positioning`.

This skill is only the enforceable rules plus a one-line incident anchor each.
Keep narratives, design, and repair procedures in their home skills.

---

## Provenance and maintenance

All facts verified against the working tree on **2026-07-11** (HEAD `68e0e389`).
Re-verify anything volatile with:

```bash
# Rule 0 — fabrication / defaults still present?
sed -n '360,452p' generate_static_data.py        # fill_missing_days fabrication block (exact constants catalogued in data-integrity PART A)
grep -n "2300" generate_static_data.py           # per-resort elevation config (~:485)

# Rule 1 — frozen JSON URL (served page still fetches GitHub raw) + additive consensus fields
grep -n "raw.githubusercontent.com" forecast.html forecast_new.html   # forecast.html:23 (DATA_URL), forecast_new.html:919
grep -o 'snowfall_range\|snowfall_models\|snowfall_sources' data/all-forecasts.json | sort | uniq -c

# Rule 2 — canonical page served THROUGH app.py; forecast_new no longer linked
grep -n "forecast.html" index.html               # redirect target (:9)
grep -n "forecast_new" forecast.html || echo "forecast_new NOT linked (legacy)"
grep -n '"/forecast.html"' vercel.json           # route dest -> app.py
grep -n "@app.route('/forecast.html')\|def _serve_forecast_html\|def _enhance_forecast_html" app.py
grep -c 'property="og:' forecast.html            # 0 — no static OG (dynamic via /share)

# Rule 3 — secrets env-only + history leak + guard
grep -n "\.env" .gitignore
grep -rn "os.environ.get('OPENWEATHER_API_KEY')" *.py   # generate_static_data.py:524, openweather_integration.py:16 (NOT app.py anymore)
git show d65ce5a2:weatherunlocked_integration.py | grep -iE 'app_id|app_key'  # secret add (removed in bfff7287)
git show bfff7287 | grep "if not self.app_id or not self.app_key"

# Rule 4 — only cron automation, no test/lint gate
ls .github/workflows/
grep -n "cron\|python3\|git commit" .github/workflows/update-forecast.yml

# Rule 5 — app.py serves the page + dynamic share layer; data still GitHub-raw; no scraper here
grep -n '"dest": "app.py"' vercel.json
grep -n "def _serve_forecast_html\|def share_preview\|def share_card_png\|def _share_card_png" app.py
grep -n "forecast-table__table" app.py || echo "no scraper in app.py (moved out)"
grep -n "Pillow" requirements.txt && ls fonts/
```

If any of these drift (line numbers move, fields change, URLs differ), update the
corresponding rule here and re-date it. Line numbers are the most likely to drift;
the *rules* should not.
