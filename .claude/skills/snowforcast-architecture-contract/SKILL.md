---
name: snowforcast-architecture-contract
description: >-
  Load before touching the snowforcast data pipeline (generate_static_data.py,
  multi_model.py, forecast_skill.py), the all-forecasts.json contract, or the
  resort roster. Explains the load-bearing design decisions and invariants a
  change must not violate, plus the known-weak points, so you understand WHY the
  system is shaped the way it is before editing it. Read when you are about to:
  add/rename a resort or elevation, add a JSON field, change consensus/skill
  logic, alter git-history retention, or reason about why there is "no database".
  Triggers: "why is it built this way", "add a resort", "add a field to the
  JSON", "consensus invariant", "skill scoring", "git history datastore",
  "graceful degradation", "prune history".
---

# snowforcast Architecture Contract

This is the **why** behind the snowforcast pipeline. It is a reference, not a
rulebook. It tells you which decisions are load-bearing so you do not
accidentally saw through a beam.

**snowforcast** = a ski-resort snow-forecast dashboard for the owner and a few
ski buddies who plan trips over WhatsApp. 9 resorts x 3 elevations. No
meteorology knowledge assumed by the audience.

## When to use this skill

Use it **before** editing any of: `generate_static_data.py`, `multi_model.py`,
`forecast_skill.py`, `data/all-forecasts.json` (the contract), or the resort
dictionaries. Read it to understand the shape of the system.

## When NOT to use this skill (go here instead)

| You want to… | Go to |
|---|---|
| Know the enforceable "you must not" rules that gate a change | `snowforcast-change-control` (first stop before any edit) |
| Fix a broken snow-forecast.com scraper / re-derive CSS selectors | `snowforcast-scraper-resilience-campaign` |
| Understand the consensus/skill **math** and its honesty caveats | `snowforcast-consensus-and-model-reference` |
| Evaluate forecast skill rigorously (replay method, proxy-truth pitfall) | `snowforcast-forecast-skill-methodology` |
| Triage a live symptom on the site or in the data | `snowforcast-debugging-playbook` |
| Check whether a dead end was already tried | `snowforcast-failure-archaeology` |
| Measure that data is actually right (QA substitute) | `snowforcast-data-integrity-and-validation` |
| Edit the front-end HTML safely | `snowforcast-frontend-ui-contract` |

This skill does **not** contain enforceable rules and it never routes around
change control.

---

## 1. Git history IS the datastore AND the training set

There is **no database**. Verified: a grep for `sqlite|postgres|redis|psycopg|mysql|mongodb`
across every `.py` returns **nothing**.

Instead:

- The 3-hourly GitHub Action (`.github/workflows/update-forecast.yml`, cron
  `0 */3 * * *`) runs `generate_static_data.py` and **commits whatever it
  scraped** with the message `Update forecast data`.
- As of **2026-07-08** the repo has **2016 commits total, of which 1938 are
  these `Update forecast data` bot commits** (78 are real human commits). Those
  bot commits **are the store**: every 3 hours, a full snapshot of every
  resort/elevation forecast is frozen into git.

Because the snapshots accumulate, git history is **also the training set**.
`forecast_skill.py` replays past commits to score how wrong each model was:

- `daily_commits()` (line ~39) walks `git log --since=… --format=%H %cI -- <path>`
  and keeps the latest commit per calendar day.
- `load_extended()` (line ~52) reads a historical file with
  **`git show <commit_hash>:<path>`** — literally checking out an old version of
  `data/<resort>-mid.json` to see what each model predicted N days ahead.
- The day-of forecast is used as the "observation proxy" (its honesty caveat
  lives in `snowforcast-forecast-skill-methodology` — do not restate it here).

### Consequence you must internalize

**Pruning, squashing, or shallow-fetching the history silently destroys skill
scoring.** The weekly skill job (`.github/workflows/update-skill.yml`, cron
`0 3 * * 1`) **must** check out with `fetch-depth: 0` (it does — verified) so the
full history is present. `forecast_skill.py`'s own docstring says: *"Requires
full git history (actions/checkout with fetch-depth: 0)."*

Note the asymmetry: the **3-hourly** `update-forecast.yml` checkout has **no**
`fetch-depth` (shallow is fine — it only appends a commit). Only the **skill**
job needs the deep history. Do not "helpfully" prune old bot commits to slim the
repo; you would be deleting training data.

---

## 2. The two-stage data pipeline

`generate_static_data.py::main()` (line ~464) loops **9 resorts x 3 elevations**
and does two stages per elevation:

**Stage 1 — scrape + base extended forecast**
1. `fetch_forecast(resort, elevation)` (line ~182) scrapes snow-forecast.com. It
   locates `soup.find('table', class_='forecast-table__table')` (line ~209) —
   this selector is the fragile core (see scraper skill).
2. `fetch_openmeteo_extended(...)` (line ~103) pulls a 16-day Open-Meteo forecast
   and `fill_missing_days_from_openmeteo(...)` (line ~364) pads the scraped days
   out to a 7-day table.

**Stage 2 — fold in extra models**
3. `multi_model.enrich_extended_forecast(...)` (line ~596) adds the other weather
   models and builds the consensus (Section 3). Guarded by
   `if MULTI_MODEL_AVAILABLE` and wrapped in try/except.

Finally `main()` writes each per-elevation `data/<resort>-<elevation>.json` and
the combined **`data/all-forecasts.json`** (line ~611), plus `data/metadata.json`.

### app.py is a parallel, largely-unused path

`app.py` (Flask) **duplicates the entire scrape/parse logic** — it has its own
`forecast-table__table` parse at line ~173 and its own `resort_url_mapping`. It
serves dynamic routes (`/api/forecast`, `/val_thorens_forecast.json`, etc.) and
is the Vercel dynamic target. **But the deployed static pages do not depend on
it** — they fetch the committed JSON from GitHub raw (Section 5). Treat `app.py`
as **secondary**: a change to the real pipeline is a change to
`generate_static_data.py` + `multi_model.py`, not `app.py`.

---

## 3. Consensus invariants (do not break these thresholds)

All in `multi_model.py`. The consensus is a **median across independent models**,
optionally skill-weighted. Two hard thresholds guard against garbage:

| Invariant | Where | Rule |
|---|---|---|
| **>=2 non-null sources to build a consensus** | `apply_consensus`, lines ~236-239 | `pairs = [(v, w) for m,v … if v is not None]`; `if len(pairs) < 2: continue`. With <2 real values it **leaves the raw single value untouched** — it does not invent a consensus. |
| **>=2 skill-scored models to weight at all** | `load_skill_weights`, line ~214 | `return weights if len(weights) >= 2 else {}`. |
| **>=5 samples for a model to earn a weight** | `load_skill_weights`, line ~210 | a model is weighted only if `mae is not None and stats.get('n',0) >= 5`. |

Consequence: if fewer than 2 models have a track record, `load_skill_weights`
returns `{}`, every model gets neutral weight `1.0`, and the result is a **plain
unweighted median**. As of **2026-07-08** the deployed data shows
`"method": "median"` and `"skill_weights": null` — i.e. weighting is currently
**dormant** across the board (this dormancy and its math are owned by
`snowforcast-consensus-and-model-reference` and the skill-methodology skill).

**If you change these thresholds you change what the site shows.** Lowering the
`>=2 sources` gate would let a single model masquerade as a consensus — a
fail-loud violation (Section 4). Do not touch them without change control.

---

## 4. Graceful degradation — in deliberate tension with FAIL-LOUD

Every external fetch is **individually** try/except-wrapped so one dead source
does not sink the whole run:

- `multi_model.enrich_extended_forecast` wraps each of the three fetches
  separately (multi-model, ensemble, MET Norway) at lines ~284-306, prints a
  `⚠ … fetch failed` warning, and continues. If **all three** die it returns the
  data unchanged (`if not multi and not ensemble and not met: return`, line ~302).
- `generate_static_data.py::main()` wraps the scrape and the OpenWeather combine
  in try/except (lines ~546-570) and prints `✗ Error…` / `⚠ OpenWeather fetch
  failed`.

**This is intended.** Degrading to *fewer sources* is correct behaviour — the
consensus just narrows.

**The tension:** degrading to fewer real sources is fine; **silently emitting a
fabricated or default value in place of missing real data is NOT.** The worst
incident this project ever had was exactly that: a `2300m` snow-line default
(Val Thorens' `bot` elevation — see `resort_coords`/`elevation_heights`, where
`'Val-Thorens': {'bot': 2300, …}`) silently applied to **other** resorts. For a
forecast product, a silently-wrong number erodes trust more than a visible gap.

The rule that operationalizes this — **FAIL LOUD; never silently substitute a
default; any fallback must be visibly labeled in both data and UI** — is
enforced by `snowforcast-change-control` and catalogued in
`snowforcast-failure-archaeology`. When you add a degradation path, ask: *does it
drop a source (fine) or does it fabricate a value (forbidden)?*

---

## 5. all-forecasts.json — the frozen deployed contract

Both front-ends fetch this file **directly from GitHub raw**, not from `app.py`:

```
https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json
```

(hardcoded in `forecast.html` as `const GITHUB_DATA_URL`, line ~961 — verified).

**Fields may be added additively; existing fields/paths must never change,
move, or disappear**, or the live page breaks silently. The consensus fields
(`snowfall_range`, `snowfall_models`, `snowfall_sources`) and the `extended`
block were all added this additive way.

### Verified field inventory (as of 2026-07-08)

Top-level: object keyed by internal resort name → `{ bot, mid, top }`.

Each **elevation object** has:
`days`, `last_updated`, `resort`, `elevation`, `snow_conditions`, `extended`,
`consensus`.

- **`days[]`** (scraped 7-day table): each day = `{ name, date (day-of-month as
  string, e.g. "6"), am, pm, night }`; each of `am/pm/night` =
  `{ condition, temperature, feels_like, snow, rain, wind }`.
- **`snow_conditions`**: `{ "Top snow depth", "Bottom snow depth",
  "Fresh snowfall depth", "Last snowfall", "Snow Alerts" }` (scraped strings).
- **`extended`**: `{ extended_forecast[], last_updated, source, elevation,
  elevation_used }`.
  - **`extended_forecast[]`** (the model-rich block): each day =
    `{ date ("YYYY-MM-DD"), day_name, temp_max, temp_min, precipitation, rain,
    snowfall, weather_code, freezing_level_min, freezing_level_max,
    snowfall_range [low,high], snowfall_sources (int), snowfall_models {…} }`.
- **`consensus`**: `{ method, models[], skill_weights, generated }`.

### The consensus sources that map into `snowfall_models`

Built in `apply_consensus` (lines ~227-234) and `FORECAST_MODELS`
(`multi_model.py:27`). Up to **seven** keys, from four independent origins:

| Key | Origin |
|---|---|
| `openmeteo_best_match` | the base Open-Meteo extended day (`day['snowfall']`) |
| `meteofrance_seamless` | Open-Meteo multi-model (Meteo-France AROME/ARPEGE) |
| `icon_seamless` | Open-Meteo multi-model (DWD ICON) |
| `ecmwf_ifs025` | Open-Meteo multi-model (ECMWF IFS) |
| `gfs_seamless` | Open-Meteo multi-model (NOAA GFS) |
| `met_norway` | MET Norway `api.met.no`, independent, no key |
| `ensemble_median` | Open-Meteo ensemble API (~30 perturbed GFS members) |

`snowfall_sources` = count of **non-null** values actually present that day (7 in
the sample data; **minimum 2** by the Section-3 invariant). Note the brief's
"6 sources" is imprecise — the code lists **7 possible keys**; corrected here.

---

## 6. Resort identity — three parallel dicts + a URL map

A resort's identity is spread across **three parallel dictionaries in
`generate_static_data.py::main()`, all keyed by the internal name**:

- `resort_coords` (line ~471) — `{lat, lon}`
- `elevation_heights` (line ~484) — `{bot, mid, top}` metres per resort
- `snow_forecast_names` (line ~497) — maps internal name → snow-forecast.com name

Plus `app.py`'s own `resort_url_mapping` (line ~147) for the Flask path.

**Internal names are not the same as the scrape URLs.** The non-identity mappings:

| Internal name | snow-forecast.com name |
|---|---|
| `Via-Lattea` | `Sestriere` |
| `Monterosa-Ski` | `Champoluc` |
| `Mount-Hermon` | `mounthermon` |

(The other six map to themselves.) The 9 resorts are: `Val-Thorens`, `Cervinia`,
`Via-Lattea`, `Monterosa-Ski`, `Gudauri`, `St-Anton`, `Alpe-d-Huez`,
`La-Plagne`, `Mount-Hermon`. Each has three elevations: **`bot`, `mid`, `top`**.

**To add or rename a resort you must update all three dicts in
`generate_static_data.py` AND the `resort_url_mapping` in `app.py`** — a
mismatch means a resort silently scrapes the wrong URL or gets no coordinates.
Do this under change control.

---

## 7. Known-weak points (documented, not yet fixed)

These are real soft spots. They are catalogued here so you do not "discover"
them as bugs, and so you handle them with care. Fixes belong to the sibling
skills noted.

1. **MET Norway snow is a crude heuristic.** `fetch_met_norway_daily`
   (lines ~143-147) estimates snow as `snow_cm = precip` when the symbol
   contains `'snow'` (full amount) or `precip * 0.5` for `'sleet'`, commented
   `1mm water equivalent ~ 1cm snow`. This is a fixed ratio with no
   temperature/density adjustment and is widely off from real snow-to-liquid
   ratios. Treat MET Norway's `snowfall` as the least trustworthy of the seven
   sources. The correct ratio discussion lives in
   `snowforcast-consensus-and-model-reference`; do not restate numbers here.

2. **Month/year rollover bug in date reconstruction.**
   `fill_missing_days_from_openmeteo` builds `existing_dates` from the scraped
   day-of-month integer plus **`datetime.now().year` / `.month`**
   (`generate_static_data.py`, lines ~382-384:
   `f"{today.year}-{today.month:02d}-{day_num:02d}"`). Around a month or year
   boundary the scraped table can list days that belong to the *next* month, so
   this stitches them to the *wrong* month — mismatching the Open-Meteo
   `YYYY-MM-DD` dates and mis-merging days. Low-frequency but real. Debugging
   angle lives in `snowforcast-debugging-playbook`.

3. **Front-end is decoupled from Flask; README overstates it.** `forecast.html`
   always fetches the hardcoded GitHub raw URL (line ~961) — there is **no**
   runtime "static vs. live" source detection. `README.md:51` claims
   *"automatic source detection (static vs. live)"*, which is **false** as
   written. Do not rely on that claim; do not "fix the front-end to match the
   README" — fix the README instead (owned by `snowforcast-docs-and-writing` and
   `snowforcast-frontend-ui-contract`).

---

## Provenance and maintenance

Every claim above was verified against the repo on **2026-07-08**. Volatile
facts are date-stamped. Re-verify with these one-liners (run from repo root):

```bash
# No database anywhere (expect zero matches):
grep -rniE 'sqlite|postgres|redis|psycopg|mysql|mongodb' ./*.py

# Total vs. bot commits (numbers drift — re-count):
git log --oneline | wc -l
git log --oneline | grep -c 'Update forecast data'

# Skill replay uses `git show <hash>:<path>` and needs full history:
grep -n "git('show'" forecast_skill.py
grep -n 'fetch-depth' .github/workflows/update-skill.yml   # expect: 0

# Consensus invariants still at these thresholds:
grep -n 'len(pairs) < 2' multi_model.py                    # >=2 sources gate
grep -n 'len(weights) >= 2' multi_model.py                 # >=2 models to weight
grep -n "get('n', 0) >= 5" multi_model.py                  # >=5 samples per model

# Consensus source roster:
grep -n 'FORECAST_MODELS =' multi_model.py

# Resort identity dicts + URL map:
grep -n 'resort_coords\|elevation_heights\|snow_forecast_names' generate_static_data.py
grep -n 'resort_url_mapping' app.py

# Frozen-contract fetch URL (front-end):
grep -n 'GITHUB_DATA_URL' forecast.html

# Known-weak points:
grep -n '1mm water equivalent' multi_model.py              # MET Norway heuristic
grep -n 'today.year' generate_static_data.py               # rollover bug
grep -n 'automatic source detection' README.md             # false claim

# Live JSON field inventory:
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));e=d['Val-Thorens']['mid'];print(list(e.keys()));print(list(e['extended']['extended_forecast'][0].keys()))"
```

If any command's output diverges from what this skill states, update the skill
rather than trusting the prose.
