---
name: snowforcast-scraper-resilience-campaign
description: >
  ADVANCED runbook for the project's #1 recurring pain: snow-forecast.com
  scraping breakage. Load this when the 3-hourly "Update forecast data" Action
  stops changing data, when a resort/elevation goes missing from
  data/all-forecasts.json, when snow numbers all read 0 or null, when the site
  markup or rate-limits appear to have changed, or when you must re-derive the
  CSS selectors and repair the parsers. Decision-gated: detect a break fast,
  tell a markup change apart from a rate-limit, re-derive selectors from a
  fresh page, repair the real parsers consistently, and fail loud instead of
  shipping fabricated or defaulted numbers. NOT for quick symptom routing (use
  snowforcast-debugging-playbook), for validating repaired output
  (snowforcast-data-integrity-and-validation), or for consensus math
  (snowforcast-consensus-and-model-reference).
---

# Snow-Forecast Scraper Resilience Campaign

**What this is.** An executable, gate-by-gate plan for the single hardest and
most recurring failure in `snowforcast`: the scrape of `snow-forecast.com`
breaks when their HTML markup or their rate-limits change. There is **no CI
test that catches this** — the only automation is a GitHub Action that runs
every 3 hours and commits whatever it scrapes. A green Action does **not** mean
the data is correct. This skill tells you how to know it broke, why it broke,
and how to fix it without silently shipping wrong numbers.

**Who this is for.** A zero-context engineer or a smaller AI model. Every term
is defined once. Every command is copy-pasteable. Work the gates in order; each
gate has an **expected observation** so you can tell "healthy" from "broken"
without guessing.

**Ground-truth date.** All file/line references verified against the repo on
**2026-07-08**. Re-verify with the commands in *Provenance and maintenance* at
the bottom before trusting any specific line number.

---

## Vocabulary (defined once)

| Term | Meaning in this repo |
|------|----------------------|
| **The scrape** | Fetching a `snow-forecast.com` resort page and pulling numbers out of its HTML table. |
| **The live parser** | `generate_static_data.py::fetch_forecast` — the ONLY parser the production Action runs. Everything else is secondary or dead. |
| **The Action** | `.github/workflows/update-forecast.yml`, cron `0 */3 * * *` (every 3h). Runs `python3 generate_static_data.py`, commits `data/*.json`. |
| **The contract** | `data/all-forecasts.json` — the frozen JSON both front-ends fetch from `raw.githubusercontent.com`. See `snowforcast-architecture-contract`. |
| **Selector** | A CSS class or `data-*` attribute the parser keys on, e.g. `forecast-table__table`, `data-row='snow'`, `snow-amount__value`. |
| **Markup change** | `snow-forecast.com` renamed/restructured its HTML. Fetch succeeds, selectors match nothing. |
| **Rate-limit / throttle** | `snow-forecast.com` served an error/empty/challenge page because we asked too fast. Selectors are fine; there's just no table in *this* response. |
| **Silent drop** | A resort/elevation that failed to scrape simply does not appear in the JSON — no error, exit code 0, Action still green. |
| **Fabricated fill** | Inventing numbers when real data is missing (a random value, a hard-coded default, another resort's value). The cardinal sin — see GATE 4. |

---

## The fragile core: what actually keys on the table

There are **four** Python files that parse `snow-forecast.com`'s forecast
table, plus one offline debug script. **They have already drifted** — do not
assume they are identical. Verified 2026-07-08:

| File / entry point | Role | Live? | Snow number read via |
|--------------------|------|-------|----------------------|
| `generate_static_data.py::fetch_forecast` | **The production parser** (the Action runs this) | **YES — this is the one that matters** | `span.snow-amount__value` `.text` (line ~280) |
| `app.py` (inline fetch at line ~161, + imports the two below) | Flask/Vercel *dynamic* path; static pages do **not** use it | Secondary (see architecture-contract: the GitHub-raw JSON is the real path) | `span.snow-amount__value` `.text` (line ~226) |
| `snow_forecast_parser.py::SnowForecastParser` | Used by `app.py` and by the unused `update_forecast.py` | Secondary | `div.snow-value[data-value]` (line ~216) — **DIFFERENT selector** |
| `enhanced_snow_forecast_parser.py::EnhancedSnowForecastParser` | Used by `app.py` | **Fabricates** — see below | Its live path invents random numbers; its table-reading helpers are **dead code** |
| `analyze_html.py` | Offline debug dumper for a saved page | Not in any pipeline | `span.snow-amount__value` (line ~89) — handy for GATE 2 |

**Shared invariants all real parsers depend on** (a markup change to any of
these breaks the scrape):

- `soup.find('table', class_='forecast-table__table')` — the forecast grid.
- `forecast_table.find('tr', {'data-row': '<row>'})` where `<row>` ∈
  `days, time, weather, temperature-max, temperature-chill, snow, rain, wind`.
- `row.find_all('td', class_='forecast-table__cell')` — the per-period cells.
- `days_row.find_all('td', class_='forecast-table-days__cell')` — day headers.
- Inside cells: `span.snow-amount__value`, `span.rain-amount__value`,
  `div.temp-value[data-value]`, `div.wind-icon[data-speed]`.

**Two drifts you must know before you "fix all four consistently":**

1. **Snow selector already differs.** `generate_static_data.py` + `app.py`
   read snow from `span.snow-amount__value`. `snow_forecast_parser.py` reads it
   from `div.snow-value[data-value]`. These are two different theories of the
   markup. Only the `snow-amount__value` theory is on the live path and known to
   currently work. If you re-derive the selector, update the live parser first,
   then decide whether the others are worth touching (they are secondary/dead).

2. **`enhanced_snow_forecast_parser.py` is a fabricating stub.** Its live method
   `_extract_comprehensive_weather_data` (line ~175) ALWAYS generates
   `random.randint(...)` sample data (line ~219: `snow_depth_cm =
   random.randint(0, 15)`). Its real table-reading helpers (`_extract_snow_data`
   etc.) are **defined but never called**. Treat this file as the living example
   of the GATE 4 anti-pattern, not as a parser to keep in sync.

**Consequence.** A markup change breaks the live parser (`generate_static_data`)
and the two `snow-amount__value` paths identically. "Fix all four consistently"
in practice means: **fix `generate_static_data.py::fetch_forecast` (mandatory),
mirror the change into `app.py`'s inline fetch (it shares the exact selectors),
and only touch `snow_forecast_parser.py` if you are deliberately reviving the
secondary path.** Do not waste time syncing the fabricating stub.

> Before editing any parser, read `snowforcast-change-control` — it gates every
> scraper edit. This skill does **not** route around it.

---

## GATE 1 — Detect a break fast

**Goal:** decide "healthy" vs "broken" in under two minutes, without trusting
the Action's green checkmark.

### Expected observation when HEALTHY (baseline, snapshot 2026-07-06)
- `data/all-forecasts.json` has **9 resorts × 3 elevations = 27** populated
  entries, each with a `days` array of length ~6–7.
- Resort keys are exactly:
  `Val-Thorens, Cervinia, Via-Lattea, Monterosa-Ski, Gudauri, St-Anton,
  Alpe-d-Huez, La-Plagne, Mount-Hermon`; elevations `bot, mid, top`.
- `data/` holds 30 JSON files: 27 per-resort-elevation + `all-forecasts.json`
  + `metadata.json` + `skill.json`.

### Expected observation when BROKEN
- One or more resort/elevation keys **missing** from `all-forecasts.json`
  (silent drop), OR
- `days` present but every `snow` cell is `"0"`/`null` across *all* resorts
  including ones that should have snow (a renamed `snow-amount__value` makes
  every read fall through to the `'0'` default at line ~284 — **days still
  present, so a naive "has days?" check will NOT catch this**), OR
- `metadata.json.last_updated` is stale (the 3-hourly commit stopped).

### The fast check (run locally — do NOT trust the Action)

The full run scrapes 27 pages sequentially with no delay and also hits OpenMeteo
16-day + multi-model consensus per elevation. It is **slow and network-bound**;
a 22-second partial run did **not** finish, and it is exactly where CI
timeouts / rate-limits show up. So probe first, run full only if needed.

```bash
cd /path/to/snowforcast

# 0) Dependencies (this repo's parser needs bs4; a clean machine won't have it).
python3 -c "import bs4" 2>/dev/null || pip install -r requirements.txt

# 1) Structural health of the CURRENTLY COMMITTED data (no network):
python3 - <<'PY'
import json
d = json.load(open('data/all-forecasts.json'))
expected = ['Val-Thorens','Cervinia','Via-Lattea','Monterosa-Ski','Gudauri',
            'St-Anton','Alpe-d-Huez','La-Plagne','Mount-Hermon']
elevs = ['bot','mid','top']
missing, nodays, allzero = [], [], []
for r in expected:
    for e in elevs:
        v = d.get(r, {}).get(e)
        if not isinstance(v, dict):            missing.append(f"{r}/{e}"); continue
        days = v.get('days') or []
        if not days:                           nodays.append(f"{r}/{e}"); continue
        snows = [ (p or {}).get('snow') for day in days
                  for p in (day.get('am'), day.get('pm'), day.get('night')) if p ]
        if snows and all(str(s) in ('0','None','') for s in snows):
            allzero.append(f"{r}/{e}")
print("entries present:", sum(isinstance(d.get(r,{}).get(e),dict) for r in expected for e in elevs), "/27")
print("MISSING (silent drop):", missing or "none")
print("present but NO days :", nodays or "none")
print("ALL-ZERO snow       :", allzero or "none")
print("last_updated        :", json.load(open('data/metadata.json')).get('last_updated'))
PY

# 2) One live probe of the live parser (fast — one request, not 27):
python3 - <<'PY'
import generate_static_data as g
r = g.fetch_forecast(resort='Val-Thorens', elevation='mid')
if r is None:
    print("PROBE: fetch_forecast returned None  -> table not found (GATE 3)")
else:
    n = len(r.get('days', []))
    d0 = r['days'][0] if n else {}
    print(f"PROBE: OK, {n} days; day0.am =", (d0.get('am') or {}))
PY
```

Interpretation:
- **`MISSING` non-empty** → those resorts silently dropped. Go to GATE 3.
- **`ALL-ZERO snow` = all 27** in a snowy month → likely a renamed snow
  selector. Go to GATE 2. (In **summer**, all-zero snow is *legitimate* — see
  the warning below.)
- **Probe prints `None`** → the live parser can't find `forecast-table__table`
  right now. Go to GATE 3 to decide markup-change vs rate-limit.
- **Probe prints days + snow** but committed JSON is stale → the Action isn't
  running/committing (an ops problem, not a parser problem — see
  `snowforcast-build-deploy-and-operations`).

> **SUMMER TRAP.** Today is a July date. Northern-hemisphere resorts in summer
> legitimately show `snow: "0"` and temps of +10 °C, and some resort pages may
> not publish a 6-day forecast table at all (→ `fetch_forecast` returns `None`
> → resort legitimately absent). **Do not "fix" a scraper that is correctly
> reporting no snow.** The discriminator is GATE 2: fetch a fresh page and look
> at whether the *table and selectors still exist*, not at whether the numbers
> are zero.

---

## GATE 2 — Re-derive the selectors from a fresh page

**Goal:** get a fresh resort page and confirm, against the live site, exactly
which classes/attributes carry the numbers — so any fix matches reality, not
memory.

**Expected observation:** the current markup still contains a
`table.forecast-table__table` with `tr[data-row='snow']` rows whose cells hold
the snow number; the selectors you re-derive extract the **same numbers the
site shows a human**.

### Fetch a fresh page (same URL shape the live parser uses)

The live parser builds: `https://www.snow-forecast.com/resorts/{name}/6day/{elev}`
where `{elev}` ∈ `bot|mid|top` and `{name}` is the **snow-forecast.com slug**,
which is NOT always the internal key. Verified mapping
(`generate_static_data.py` line ~497):

| Internal key | snow-forecast.com slug |
|--------------|------------------------|
| Val-Thorens | `Val-Thorens` |
| Cervinia | `Cervinia` |
| **Via-Lattea** | **`Sestriere`** |
| **Monterosa-Ski** | **`Champoluc`** |
| Gudauri | `Gudauri` |
| St-Anton | `St-Anton` |
| Alpe-d-Huez | `Alpe-d-Huez` |
| La-Plagne | `La-Plagne` |
| **Mount-Hermon** | **`mounthermon`** |

```bash
# Save a fresh page to disk (use the SAME UA the parser uses).
curl -sS \
  -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8' \
  'https://www.snow-forecast.com/resorts/Val-Thorens/6day/mid' \
  -o /tmp/sf_fresh.html
wc -c /tmp/sf_fresh.html   # a real page is tens–hundreds of KB; a few KB => block/challenge (GATE 3)
```

### Confirm the selectors the parser depends on

```bash
python3 - <<'PY'
from bs4 import BeautifulSoup
soup = BeautifulSoup(open('/tmp/sf_fresh.html','rb').read(), 'html.parser')
t = soup.find('table', class_='forecast-table__table')
print("forecast-table__table present:", bool(t))
if t:
    for row in ['days','time','weather','temperature-max','snow','rain','wind']:
        tr = t.find('tr', {'data-row': row})
        cells = tr.find_all('td', class_='forecast-table__cell') if tr else []
        print(f"  data-row={row:<16} present={bool(tr)} cells={len(cells)}")
    snow = t.find('tr', {'data-row':'snow'})
    if snow:
        vals = [ (c.find('span', class_='snow-amount__value') or {}) for c in
                 snow.find_all('td', class_='forecast-table__cell') ]
        print("  snow-amount__value found in cells:",
              sum(1 for v in vals if getattr(v,'text',None) is not None))
PY
```

**Read the result like this:**

| Fresh page shows | Meaning | Where to go |
|------------------|---------|-------------|
| Table present, all `data-row`s present, `snow-amount__value` found | Markup unchanged. The break (if any) was throttling. | GATE 3 (rate-limit branch) |
| Table present, but a `data-row` or `snow-amount__value` **missing/renamed** | **Markup change.** Re-derive the new class/attribute. | Below, then GATE 5 |
| Page is a few KB / challenge / no table | You got throttled — you're not looking at the real page. | GATE 3 (rate-limit branch) |

**To re-derive a renamed selector:** open `/tmp/sf_fresh.html`, find the number
you can see on the live site, and read the *actual* class/attribute wrapping it.
Grep is faster than eyeballing:

```bash
grep -oE 'class="[^"]*snow[^"]*"' /tmp/sf_fresh.html | sort -u
grep -oE 'data-row="[^"]*"'       /tmp/sf_fresh.html | sort -u
grep -oE 'class="[^"]*forecast-table[^"]*"' /tmp/sf_fresh.html | sort -u
```

Whatever the new class is, that string replaces the old one in
`generate_static_data.py::fetch_forecast` **first** (it's the live parser), then
mirror into `app.py`'s inline fetch. Do **not** change the JSON field names your
front-ends read — only the scraper-side selectors. (Field renames break the
frozen contract; see `snowforcast-architecture-contract` and
`snowforcast-frontend-ui-contract`.)

---

## GATE 3 — Rate-limit vs markup-change (do NOT conflate)

**Goal:** apply the right fix. These two failures look identical in the output
(missing/empty data) but need **opposite** responses.

**The discriminator is GATE 2's fresh fetch:**

| Signal | Diagnosis | Fix |
|--------|-----------|-----|
| Fresh page **has** `forecast-table__table` and all rows, but your *bulk* run dropped resorts | **Rate-limit / throttle.** The site served good HTML on a lone request but choked under 27 back-to-back requests. | **Slow down / look human** — do NOT touch selectors |
| Fresh page **lacks** the table or a row/selector even on a single clean request | **Markup change.** | **Re-derive selectors** (GATE 2) — do NOT add delays and hope |
| Fresh page is tiny / CAPTCHA / 403 / 429 | **Hard block.** | Back off hours; add headers; consider a slower cadence |

**Why throttling is plausible here (verified):** `fetch_forecast` makes **27
sequential requests with no `time.sleep` between them**, a single static desktop
User-Agent, and (unlike `app.py`) **no cookie**. `timeout=30`. There is no
retry/backoff. This is exactly the pattern that trips rate-limiters, and it is
where the CI job's slowness/timeouts originate.

**Rate-limit fix (the humane, low-risk changes):**
- Add a delay between resort fetches (e.g. `time.sleep(2–5)` in the loop in
  `main()` around line ~536). This is the single highest-value resilience change.
- Send a `Cookie` header like `app.py` already does (`'Cookie': 's_fid=browse'`,
  `app.py` line ~166) — the live parser omits it.
- On empty/short response, retry once after a longer sleep before giving up.
- Keep cadence sane: every 3h × 27 pages is already gentle; bursts are the
  problem, not total volume.

**Markup-change fix:** GATE 2. Re-derive, then GATE 5.

> Record which one it was in `snowforcast-failure-archaeology` so the next
> person doesn't re-run the wrong branch.

---

## GATE 4 — FAIL LOUD on an unrepairable scrape

**Goal:** guarantee that a resort/elevation you genuinely cannot scrape produces
a **visible** signal — never a silent default and never a fabricated number.
This is the incident this whole project exists to make impossible (the "2300 m
snow-line default that silently applied Val Thorens' elevation to other resorts"
class of bug).

**Current behaviour (verified) — know exactly where "silent" lives:**
- `fetch_forecast` returns `None` when `forecast-table__table` is absent
  (line ~210). Fine — `None` is honest.
- **BUT** the caller loop (`main()`, lines ~556–568) turns that honest `None`
  into a **silent drop**: it prints `✗ No data for …` to stdout and moves on.
  The resort/elevation is simply absent from `all-forecasts.json`, the Action
  **exits 0 and still commits**, and the front-end just shows fewer resorts.
  Nobody is paged.
- The `'0'` snow default (line ~284) and `'0'` rain default are *legitimate for
  genuinely-no-precip*, but they will also **mask a renamed snow selector** by
  turning every missing read into a plausible-looking zero. That is a
  silently-wrong path in disguise (caught by GATE 1's ALL-ZERO check + GATE 2).

**The rule (non-negotiable, owned by `snowforcast-change-control`):**
> Never substitute a default, another resort's value, or a random/sample number
> for missing real data. If real data is unavailable, the failure must be
> visible in BOTH the data and the UI. Any legitimate fallback (e.g. OpenMeteo
> filling missing days) must be **labelled as such** in the JSON so the UI can
> mark it.

**What "fail loud" should look like here (candidate — not yet implemented):**
- Make the bulk run **non-zero exit** or emit a machine-readable failure summary
  when the count of successfully-scraped resorts drops below a floor (e.g.
  `< 27` in ski season), so the Action's log/status reflects reality instead of
  green-on-empty. *Status: open — the current Action always exits 0.*
- Treat "table present but zero populated snow cells across all resorts" as a
  failure, not as valid data (distinguish from legitimate summer zeros by month
  or by presence of the `snow-amount__value` element vs the `'0'` fallback).

**What you must NOT do (the `enhanced_snow_forecast_parser.py` anti-pattern):**
never wire in a `random`/sample/hard-coded generator as a "temporary" fallback.
That file's `random.randint(0, 15)` snow (line ~219) is the museum exhibit of
this mistake — do not replicate it in the live path. See
`snowforcast-data-integrity-and-validation` for how to *measure* that no
fabricated value slipped in.

---

## GATE 5 — Verify + guard against silent regression

**Goal:** because **no CI catches scraper breakage**, define the manual check
that must pass before the next 3-hourly commit lands — and prove your fix works
end to end.

**Expected observation after a good fix:** a fresh full (or targeted) run
repopulates all 27 entries; snow values match what the live site shows a human
for a spot-checked resort; no resort silently missing; the committed JSON keeps
every existing field/path (contract intact).

### The manual verification checklist (run before you consider it fixed)

```bash
cd /path/to/snowforcast
python3 -c "import bs4" 2>/dev/null || pip install -r requirements.txt

# 1) Targeted live probes of the fixed parser (fast, a few resorts, incl. slug remaps):
python3 - <<'PY'
import generate_static_data as g
for name in ['Val-Thorens','Sestriere','Champoluc','mounthermon']:  # last three are remapped slugs
    r = g.fetch_forecast(resort=name, elevation='mid')
    ok = bool(r and r.get('days'))
    snow0 = (r['days'][0].get('am') or {}).get('snow') if ok else None
    print(f"{name:<14} ok={ok} day0.am.snow={snow0}")
PY

# 2) Full regenerate (SLOW & network-bound — expect minutes; watch for the
#    rate-limit symptom from GATE 3). Only after the probes pass.
python3 generate_static_data.py

# 3) Re-run GATE 1's structural check on the freshly generated data:
#    entries must be 27/27, MISSING none, and ALL-ZERO must make sense for the season.

# 4) Eyeball one number against the live site to confirm you didn't grab the wrong element:
#    open https://www.snow-forecast.com/resorts/Val-Thorens/6day/mid and compare a snow figure.
```

### Ad-hoc harnesses that exist (know their limits — they are NOT a test suite)

- `test_openmeteo.py` — a manual script that hits the **OpenMeteo** 16-day API
  for Val Thorens. Useful for confirming the *extended/consensus* leg, **not**
  the snow-forecast.com parser. Run: `python3 test_openmeteo.py`.
- `test_vt_scrape.py` — a manual script that scrapes **`valthorens.com`**
  (the resort's *official* site, `/en/infos-neige/`), **not**
  `snow-forecast.com`. It is **not** a direct harness for the fragile parser;
  don't mistake it for one.
- **For the snow-forecast.com parser, the real ad-hoc harness is calling
  `generate_static_data.fetch_forecast(...)` directly** (as in step 1) or
  `analyze_html.py` against a saved page.

There is **no** `pytest`/test framework and no CI gate on any of this. Do not
claim CI catches a scraper regression — it does not. Your green Action means
"the script exited 0", nothing more.

---

## CI provisioning hazard (scraper-specific one-liner)

A scraper fix that adds a new import must update the workflow's `pip install`
line, **not just `requirements.txt`** — the Action doesn't read `requirements.txt`.
Scraper-specific trap: `generate_static_data.py` imports `multi_model` /
`openweather_integration` under `try/except`, so a missing dep in either is
swallowed and **silently disables consensus/OpenWeather** while the Action stays
green — you get thinner data, not a crash.

**Canonical detail lives in one home:** the full hazard (both workflows, the
hand-typed `pip install requests beautifulsoup4 lxml` subset that omits `flask`
and ignores pins, the stdlib-only `update-skill.yml`, and the
`MULTI_MODEL_AVAILABLE`/`OPENWEATHER_AVAILABLE` silent-disable mechanism) is
documented once in **`snowforcast-build-deploy-and-operations` §3c**. Don't
re-document it here — update that section if the workflows change.

---

## Fast path (TL;DR checklist)

1. **GATE 1** — Run the structural check + one live probe. Missing resorts?
   All-zero snow out of season? Stale `last_updated`? → it's broken.
2. **GATE 2** — `curl` one fresh page with the parser's UA; confirm
   `forecast-table__table` + `data-row='snow'` + `snow-amount__value` still
   exist and extract real numbers.
3. **GATE 3** — Fresh page fine but bulk run drops resorts ⇒ **throttle** (add
   `time.sleep`, add cookie, retry). Fresh page missing selectors ⇒ **markup
   change** (re-derive). Never conflate.
4. **GATE 4** — Make failure loud; never default/fabricate. Fix the live parser
   in `generate_static_data.py` first, mirror into `app.py`.
5. **GATE 5** — Manually verify (probes + full run + structural recheck +
   eyeball one number) before the next cron commit. No CI will do this for you.
6. **CI hazard** — new import? update the workflows' install lines, not just
   `requirements.txt`.

**Do not route around `snowforcast-change-control`.** It gates every edit here.

---

## When NOT to use this skill (and where to go instead)

| You want to… | Use instead |
|--------------|-------------|
| Quickly route a live symptom ("which failure is this?") | `snowforcast-debugging-playbook` (start here for triage) |
| Confirm repaired output is *correct*, not just present | `snowforcast-data-integrity-and-validation` |
| Understand/verify the multi-model consensus math downstream of the scrape | `snowforcast-consensus-and-model-reference` |
| Know which rules gate a scraper/data/UI edit (and why) | `snowforcast-change-control` (**first stop before editing**) |
| Understand why the pipeline/contract is shaped this way | `snowforcast-architecture-contract` |
| Check whether a dead end was already tried | `snowforcast-failure-archaeology` |
| Edit the front-end that renders this data | `snowforcast-frontend-ui-contract` |
| Install/run/operate the app and its two cron workflows | `snowforcast-build-deploy-and-operations` |
| Word anything user-facing for the non-meteorologist audience | `snowforcast-meteorology-for-laypeople` |
| Reason about calibration / honest uncertainty of the numbers | `snowforcast-calibration-and-honest-uncertainty` |
| Evaluate forecast *skill* rigorously | `snowforcast-forecast-skill-methodology` |

---

## Provenance and maintenance

Facts here are grounded in the repo as of **2026-07-08**. Line numbers drift;
re-verify with these one-liners (run from the repo root):

```bash
# The live parser, its return-None, and the snow selector:
grep -n "def fetch_forecast\|forecast-table__table\|snow-amount__value\|return None" generate_static_data.py

# The silent-drop caller and the resort list / slug remap:
grep -n "No data for\|resorts = {\|snow_forecast_names\|time.sleep" generate_static_data.py

# All parsers that key on the forecast table (confirm the count and drift):
grep -rn "forecast-table__table\|snow-amount__value\|snow-value" *.py

# The fabricating stub (confirm it still ships random sample data):
grep -n "random.randint\|_extract_comprehensive_weather_data\|sample data" enhanced_snow_forecast_parser.py

# CI install lines (confirm the hazard is still live):
grep -n "pip install" .github/workflows/update-forecast.yml
grep -n "pip install\|python3 " .github/workflows/update-skill.yml

# Front-ends' data source (confirm the frozen-JSON contract path):
grep -n "raw.githubusercontent\|all-forecasts.json" forecast.html forecast_new.html

# Current data freshness & completeness:
python3 -c "import json;print(json.load(open('data/metadata.json'))['last_updated'])"
ls data/*.json | wc -l   # expect 30
```

**Open / candidate items (not proven, do not overclaim):**
- *Fail-loud exit code* (GATE 4): the Action currently always exits 0 on partial
  scrapes. A non-zero-exit / failure-floor guard is **proposed, not
  implemented**.
- *Rate-limit is the leading hypothesis* for bulk drops given 27 no-delay
  sequential requests, but it was **not reproduced live in this session** —
  `bs4` was absent from the authoring environment, so no live fetch was run
  here. Confirm empirically per GATE 3 before committing a throttle fix.
- *`snow-forecast.com` current markup* was **not** fetched during authoring
  (no network fetch performed here). The selectors listed are what the code
  depends on today, not a live confirmation that the site still serves them —
  GATE 2 is exactly the step that confirms this.
