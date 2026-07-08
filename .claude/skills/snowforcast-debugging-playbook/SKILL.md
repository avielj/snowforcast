---
name: snowforcast-debugging-playbook
description: >-
  Fast triage for a LIVE symptom on the snowforcast ski-forecast dashboard.
  Load this the moment something looks wrong on the site or in the data:
  a resort shows no/stale/blank numbers, numbers that look wrong or suspicious,
  a green GitHub Action but bad data committed, an invisible forecast table/grid
  in the browser, a consensus range that looks single-source or too narrow, skill
  weights all zero / MAE 0.0 on the live data, or days duplicated/missing near the
  1st of a month. This is the dispatcher that owns raw live-symptom strings and
  routes each to its owner skill. Gives a symptom -> likely
  cause -> discriminating experiment table that routes to the right fix, plus
  the costly traps that waste hours. Entry point / dispatcher, not the deep fix.
---

# snowforcast Debugging Playbook

You are triaging a **live symptom** on `snowforcast`, a ski-resort snow-forecast
dashboard. Your job here is **fast routing**: match the symptom, run one cheap
**discriminating experiment** to confirm the cause, then hand off to the sibling
skill that owns the actual repair. Do **not** start editing until the experiment
has told you which of two look-alike causes you actually have.

New to the repo? Read these three lines first, then use the table.

- The **live scraper** is `generate_static_data.py::fetch_forecast` (line ~182).
  It is the only parser GitHub Actions runs. The other three parsers
  (`app.py`, `snow_forecast_parser.py`, `enhanced_snow_forecast_parser.py`)
  are **not** on the live path.
- The **frozen contract** both front-ends read is
  `data/all-forecasts.json`, fetched over HTTPS from
  `raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json`
  — **not** from `app.py`. If it is in that file, the site shows it.
- The **canonical front-ends** are `forecast.html` (the redirect target) and
  `forecast_new.html` (dark alternate). Every other `.html` is an experiment.
  Editing an experiment changes nothing the user sees.

**Jargon, defined once:**
- **Live parser** — the function CI runs to scrape snow-forecast.com:
  `fetch_forecast` in `generate_static_data.py`.
- **Frozen contract** — `data/all-forecasts.json`. Fields may be *added*;
  existing fields must never change or vanish or the page breaks silently.
- **Discriminating experiment** — one command whose result tells two
  look-alike causes apart. Always run it before editing.
- **Silently-wrong** — the page shows a plausible number that is actually a
  default or fabricated value, with no error. The worst failure class here.
- **Synthetic / fabricated day** — a forecast day the scraper did not get from
  snow-forecast.com but which `fill_missing_days_from_openmeteo` invented from
  daily-average data (approximate feels-like, defaulted wind, guessed AM/PM/Night
  split). Currently **not labeled** in the JSON (see trap #2).

---

## The triage table

Find your symptom. Run the experiment. Follow the route. Details for each row
are in the numbered sections below.

| # | Symptom (what you see) | Most likely cause | Discriminating experiment | Route to |
|---|------------------------|-------------------|---------------------------|----------|
| 1 | A resort shows **no / stale / blank** numbers | `fetch_forecast` returned `None` (markup or rate-limit change) and the day was **silently dropped** | Fetch the resort's snow-forecast.com page fresh; check for `forecast-table__table` + `data-row='snow'` + `snow-amount__value` | **snowforcast-scraper-resilience-campaign** |
| 2 | Numbers **present but WRONG / suspicious** | A silent default or synthetic path filled in (fabricated wind / feels-like / AM-PM-Night split, or a hard-coded elevation) | Diff the suspect value against the live page **and** ask "did the scraper actually return this day, or did `fill_missing_days` invent it?" | **snowforcast-data-integrity-and-validation** |
| 3 | **Green Action** but bad/empty data on the site | The 3-hourly cron commits **whatever it scraped** — there is no correctness gate | Read the committed `data/*.json` **diff**, not the Action's green check | **snowforcast-data-integrity-and-validation** |
| 4 | Forecast **table / grid invisible** in the browser | The CSS visibility saga. Do **not** re-add `!important` band-aids | Diff current `forecast.html` against last-known-good; check console, not just the empty page | **snowforcast-frontend-ui-contract** |
| 5 | Consensus looks **single-source** / range too narrow | Fewer than 2 non-null models, or skill weighting assumed active when it is dormant | Confirm `snowfall_sources >= 2`; confirm `skill_weights` is `null` (that is expected today) | **snowforcast-consensus-and-model-reference** |
| 6 | Days **duplicated or missing** near the 1st of a month | `existing_dates` builds full dates with today's year/month for every day — rollover bug | Reproduce with a date that straddles a month boundary | **snowforcast-data-integrity-and-validation** |

---

## 1. A resort shows no / stale / blank numbers

**Cause.** `fetch_forecast` (`generate_static_data.py:182`) does
`forecast_table = soup.find('table', class_='forecast-table__table')` and, if that
is missing, `return None` (line ~211). Back in the main loop the guard is:

```python
if forecast_data and 'days' in forecast_data:   # generate_static_data.py ~line 554
    all_data[resort][elevation] = forecast_data
else:
    print(f"  ✗ No data for {resort} - {elevation}")   # silently continues
```

So a markup change or a rate-limit page makes the whole resort/elevation drop
out with no exception and no gate. The site then shows whatever was last
committed (stale) or nothing (blank).

**Discriminating experiment** — fetch the page the scraper fetches and check the
three selectors it depends on:

```bash
RESORT="Val-Thorens"; ELEV="mid"   # snow-forecast.com resort slug + bot|mid|top
curl -s -A "Mozilla/5.0" "https://www.snow-forecast.com/resorts/${RESORT}/6day/${ELEV}" \
  | grep -o -e 'forecast-table__table' -e "data-row=[\"']snow[\"']" -e 'snow-amount__value' \
  | sort | uniq -c
```

- **All three present** -> markup is fine; the problem is intermittent
  (rate-limit / timeout / transient). Re-run the data generation and re-check.
- **`forecast-table__table` missing, or `data-row='snow'` / `snow-amount__value`
  missing** -> the markup changed. This is the #1 recurring failure. **Stop
  here** and go to **snowforcast-scraper-resilience-campaign**, which walks the
  gated re-derivation of all four parsers from a fresh page.

Do **not** patch a selector inline and move on — a markup change breaks all four
near-duplicate parsers the same way, and the campaign exists to fix them
consistently. Respect **snowforcast-change-control** before touching the scraper.

---

## 2. Numbers present but WRONG / suspicious

The dangerous case: a plausible-looking number that is actually a default or a
fabricated value. For a forecast product, silently-wrong erodes trust more than a
visible error. Two known silent paths:

**(a) Synthetic days from OpenMeteo.** `fill_missing_days_from_openmeteo`
(`generate_static_data.py:364`) pads a resort up to 7 days using daily-average
data when the scraper returned fewer. Those invented days carry **fabricated**
wind, feels-like, and AM/PM/Night snow-split fields that look identical to scraped
values. As of 2026-07-08 they are **not** labeled synthetic anywhere in the JSON,
so from the front-end they are indistinguishable from real scraped days. (A
labeled-synthetic marker is a **candidate** improvement, not yet implemented.)

> The exact fabricated constants (literal wind string, feels-like offsets,
> snow-split fractions) are catalogued once as a **fingerprint table** in
> `snowforcast-data-integrity-and-validation`, **PART A** — that is the single
> home; use it to tell real-vs-invented apart. Not re-listed here to avoid drift.

**(b) A hard-coded default standing in for missing real data.** The archetype is
the historical **2300 m snow-line default** that silently applied Val Thorens'
elevation to other resorts. Note: the `2300` you will see today at
`generate_static_data.py:485` is a *legitimate* elevation config
(`'Val-Thorens': {'bot': 2300, ...}`), not that bug. The bug class — "use a
default when the real value is missing" — is what to hunt for. History is in
**snowforcast-failure-archaeology**.

**Discriminating experiment** — decide "real vs invented" for the suspect
day/value:

1. Diff the value against the live snow-forecast.com page for that resort/elevation.
   If they disagree, it did not come straight from the scrape.
2. Ask whether the scraper returned that many days. The fabricated fill has
   recognizable **fingerprints** — a fixed literal wind string, a feels-like that
   is exactly the temperature minus a round constant, a fixed AM/PM/Night snow
   split. Match against the fingerprint table in
   `snowforcast-data-integrity-and-validation` **PART A** rather than hard-coding
   the values here — that table is the single source, so one code change updates
   one place.

If it is a synthetic/defaulted value masquerading as real -> route to
**snowforcast-data-integrity-and-validation** (how to measure and fail loud). The
fix philosophy is fixed by **snowforcast-change-control**: **fail loud, never
silently substitute a default**; any fallback must be visibly labeled in both the
data and the UI.

---

## 3. Green Action but bad / empty data committed

**Cause.** The only automation is `.github/workflows/update-forecast.yml`
(cron `0 */3 * * *`, every 3 hours). Its commit step is:

```yaml
git add data/*.json
git diff --quiet && git diff --staged --quiet || (git commit -m "..." && git push)
```

There is **no correctness gate** — it commits whatever it scraped. A green check
means "the script exited 0 and something changed," **not** "the data is correct."
There is no test framework and CI catches no code regression.

**Discriminating experiment** — judge the diff, not the checkmark:

```bash
# The bot commits are titled "Update forecast data - <date>". Inspect the latest:
git log --oneline -5 -- data/
git show --stat HEAD -- data/all-forecasts.json      # what actually changed
git show HEAD -- data/val-thorens-mid.json | head -60 # eyeball real values
```

Look for: days that dropped to `0`, a resort whose block shrank or emptied,
`snowfall_sources` falling to `1`, or a burst of synthetic-looking values (trap
#2). If the committed data is wrong, route to
**snowforcast-data-integrity-and-validation** to build the pre/post-commit check
that should have caught it. Do **not** conclude "the pipeline is fine" from a
green Action — that is trap #1 below.

---

## 4. Forecast table / grid invisible in the browser

**Cause.** A recurring front-end rendering fragility: the data loads but the grid
renders blank. This has a scarred history — a `!important` "fix" that was
reverted twice (commits `89ab11c8` add, then reverts `28f1070d` and `6ddcfc08`).

**Do NOT re-add `!important` band-aids.** As of 2026-07-08 there are **zero**
`!important` rules in `forecast.html`/`forecast_new.html`; keep it that way.
Re-adding one re-opens a settled dead end.

**Discriminating experiment:**

```bash
# 1. Is the data actually arriving? Open DevTools Console + Network on the live page.
#    Confirm the fetch to raw.githubusercontent.com/.../all-forecasts.json returns 200
#    with a real body. A blank grid with good data = CSS/render; a failed fetch = data.
# 2. Compare the current front-end against the last-known-good version:
git log --oneline -- forecast.html | head
git diff <last-good-commit> HEAD -- forecast.html
```

- **Fetch failed / JSON malformed** -> this is really symptom #1/#3 (data), not a
  CSS problem. Re-route.
- **Data good, grid still blank** -> it is the render path. Fix by comparing
  against last-known-good `forecast.html` and reverting the offending change, not
  by forcing visibility. Route to **snowforcast-frontend-ui-contract** and obey
  **snowforcast-change-control** for front-end edits.

---

## 5. Consensus looks single-source / range too narrow

**Background.** `multi_model.py::apply_consensus` blends independent models into a
median with a spread range. Two guards matter:

```python
pairs = [(v, weights.get(m, 1.0)) for m, v in model_values.items() if v is not None]
if len(pairs) < 2:            # multi_model.py:237
    continue                  #   -> no consensus written for this day
consensus = weighted_median(pairs)
```

And the weighting is currently **dormant**. `load_skill_weights`
(`multi_model.py:195`) returns `{}` unless **>= 2** models have a track record
(`return weights if len(weights) >= 2 else {}`, line 214). Today only
`openmeteo_best_match` is scored in `data/skill.json`, so weights are empty and the
method is a plain `median`.

**Discriminating experiment:**

```bash
# How many models backed each consensus day, and is weighting on?
python3 - <<'PY'
import json
d = json.load(open('data/all-forecasts.json'))
c = d['Val-Thorens']['mid']['consensus']
print('method       :', c.get('method'))        # expect "median" today
print('skill_weights:', c.get('skill_weights'))  # expect None today
# snowfall_sources lives per-day inside the extended/consensus block; grep it too:
PY
grep -o '"snowfall_sources": [0-9]*' data/all-forecasts.json | sort | uniq -c
```

- `skill_weights: null` and `method: "median"` are **expected today** — that is
  not a bug. Do not "fix" it by assuming skill weighting should be active (trap
  #4).
- If many days show `snowfall_sources: 1` (or the field is absent), fewer than 2
  models returned data for those days, so the range collapses toward a single
  source. That is a data-availability question about the upstream models.

Route to **snowforcast-consensus-and-model-reference** to reason about what each
source is and how spread becomes the range. If a model is silently missing,
that overlaps symptom #1/#2.

---

## 6. Days duplicated or missing near the 1st of a month

**Cause.** `fill_missing_days_from_openmeteo` builds the set of dates it already
has using **today's** year and month for **every** day number:

```python
today = datetime.now()
day_num = int(day['date'])
existing_dates.add(f"{today.year}-{today.month:02d}-{day_num:02d}")   # line 384
```

Near a month boundary a scraped day like the 1st of next month gets stamped with
*this* month's year/month. The de-dup key then mismatches the OpenMeteo day's real
`YYYY-MM-DD`, so a day is either duplicated (padded again) or skipped. It only
bites around the 1st, which makes it easy to miss.

**Discriminating experiment.** Reproduce with a date that straddles a month
boundary. Inspect a resort's `days[].date` in the JSON around month-end and look
for a repeated or absent day number. Because the bug is date-dependent, verifying
it needs either a boundary date or a small unit reproduction of the key-building
logic. Route to **snowforcast-data-integrity-and-validation** for the fix and a
regression check; obey **snowforcast-change-control** before editing
`generate_static_data.py`.

---

## Costly traps (these waste hours)

| Trap | Why it burns you | What to do instead |
|------|------------------|--------------------|
| **Trusting a green Action = correct data** | The cron commits whatever it scraped; there is no correctness gate and no test suite. Green = "ran," not "right." | Read the `data/*.json` diff (symptom #3). |
| **Editing an experiment HTML** | `forecast-dark.html`, `forecast-dark2.html`, `forecast-modern.html`, `comprehensive.html`, `index-static.html` are experiments. Editing them changes nothing the user sees. | Edit only `forecast.html` (canonical) or `forecast_new.html` (dark alternate). |
| **Editing `app.py` to fix the static site** | The static pages fetch the frozen JSON from GitHub raw, not from `app.py`. `app.py` is the secondary Vercel dynamic path. | Fix the scraper (`generate_static_data.py`) and/or the committed JSON. |
| **"Fixing" the scraper by patching one parser inline** | A markup change breaks all four near-duplicate parsers the same way; the live one is `generate_static_data.py::fetch_forecast`. | Use snowforcast-scraper-resilience-campaign to repair all four consistently. |
| **Trusting `enhanced_snow_forecast_parser.py` output** | Its main weather path (`_extract_comprehensive_weather_data`) returns **random sample data**, not a real scrape. It is not on the live path. | Ignore it for live debugging; the live parser is `fetch_forecast`. |
| **Re-adding `!important` to fix the invisible grid** | It is a reverted dead end (commits `89ab11c8` -> reverts `28f1070d`, `6ddcfc08`). | Compare against last-known-good `forecast.html`; revert the offending change (symptom #4). |
| **Assuming skill weighting is active** | `skill_weights` is `null` and method is `median` today — by design, because only one model is scored. | Treat `null`/`median` as expected (symptom #5). |
| **Local Python 3.10 vs CI Python 3.11 skew** | Local interpreter is 3.10.0; the Action pins 3.11. Behavior can differ (dict/order, stdlib, f-string edge cases). | Reproduce CI issues under 3.11 before concluding "works on my machine." |

---

## When NOT to use this skill

This is the **dispatcher**. Hand off once you know the cause:

- **Deep, gated repair of a broken scraper** — the executable break-detect ->
  re-derive-selectors -> repair-all-four-parsers plan is
  **snowforcast-scraper-resilience-campaign**. This playbook only points you there.
- **A "fix" that feels like it should already have been done** — check
  **snowforcast-failure-archaeology** first (the CSS `!important` saga, the removed
  API key, the duplicate commits, the snow-line default). Don't re-run a solved
  dead end.
- **Building the measurement / QA itself** (how to prove data is right, how to
  fail loud on fabricated data) — **snowforcast-data-integrity-and-validation**.
- **The rules that gate any change** to scraper, data, or front-end —
  **snowforcast-change-control**. No fix routes around it.
- **Why the system is shaped this way / the JSON contract invariants** —
  **snowforcast-architecture-contract**.
- **UI wording, labels, meteorology for the audience** —
  **snowforcast-frontend-ui-contract**, **snowforcast-meteorology-for-laypeople**,
  **snowforcast-consensus-and-model-reference**.

---

## Provenance and maintenance

Everything below was verified against the repo on **2026-07-08**. Line numbers
and volatile facts drift; re-check with these one-liners before relying on them.

```bash
# Live parser + its three selectors (symptom #1)
grep -n "def fetch_forecast\|forecast-table__table\|data-row.*snow\|snow-amount__value" generate_static_data.py

# Silent-drop guard (symptom #1)
grep -n "if forecast_data and 'days' in forecast_data" generate_static_data.py

# Synthetic-day fabrication + month-rollover key (symptoms #2, #6)
# (exact fabrication fingerprints are catalogued in data-integrity PART A)
grep -n "def fill_missing_days_from_openmeteo\|existing_dates.add" generate_static_data.py

# Cron with no correctness gate (symptom #3)
grep -n "cron\|python-version\|git add data" .github/workflows/update-forecast.yml

# CSS saga: expect 0 !important today (symptom #4)
grep -c "!important" forecast.html forecast_new.html
git log --oneline 89ab11c8 28f1070d 6ddcfc08

# Consensus guards + dormant weighting (symptom #5)
grep -n "len(pairs) < 2\|len(weights) >= 2\|skill_weights" multi_model.py
grep -o '"method": "[a-z-]*"' data/all-forecasts.json | sort | uniq -c

# Canonical vs experiment front-ends, and the frozen-contract URL
grep -n "window.location.href" index.html
grep -n "raw.githubusercontent" forecast.html forecast_new.html

# enhanced parser is fake/sample data, not a live scraper (trap)
grep -n "sample data\|random" enhanced_snow_forecast_parser.py

# Local vs CI Python skew (trap)
python3 --version   # expect 3.10.x locally; CI pins 3.11 in the workflow above
```

**Known-uncertain / candidate items** (not fully provable from a static repo
read, kept honest):

- *Labeled-synthetic marker* — there is currently **no** marker distinguishing
  fabricated days from real ones. Adding one is a candidate improvement owned by
  snowforcast-data-integrity-and-validation, not an existing feature.
- *Month-rollover reproduction* — the bug at `generate_static_data.py:384` is
  clear from code, but confirming a specific duplicated/missing day requires a
  boundary date or a unit reproduction; it was not reproduced live here.
- *Selector counts (symptom #1 experiment)* — the `curl | grep` counts depend on
  snow-forecast.com's live markup at the moment you run it; treat a zero count as
  the signal, not the exact number.
