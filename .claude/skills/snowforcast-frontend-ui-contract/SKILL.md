---
name: snowforcast-frontend-ui-contract
description: >-
  Read BEFORE any front-end / UI edit to snowforcast. Explains which HTML files
  are actually live (only forecast.html + forecast_new.html), how they fetch the
  frozen all-forecasts.json directly from GitHub raw (not from app.py), the
  additive-only JSON field contract, the recurring "table went invisible"
  rendering fragility (do NOT reach for !important), the fact that there is NO
  automated UI test (eyeballing the rendered page is the only safety net), the
  first-glance social-share audience (ski buddies over WhatsApp), and the
  fail-loud rule (a failed resort must show a visible no-data state, never a
  blank cell that looks like zero snow). Triggers: editing forecast.html,
  forecast_new.html, the recurring invisible-table rendering fragility (its fix and
  prevention), CSS/layout changes, changing how the page reads JSON, styling the
  headline snow number. For triaging the acute live symptom ("the table is blank
  right now") start at snowforcast-debugging-playbook, which owns first contact and
  routes here.
---

# Snowforcast Front-End UI Contract

You are about to change the user-facing web page. This file tells you **which
file is real, where its data comes from, and the specific ways this page has
broken before** so you do not re-break it. Read it fully before your first edit.

`snowforcast` is a ski-resort snow-forecast dashboard. The audience is the owner
plus a small group of ski buddies who plan trips together and share the page
link over WhatsApp. None of them know meteorology.

---

## 0. TL;DR — the five rules

1. **Only two HTML files ship.** `forecast.html` (canonical) and
   `forecast_new.html` (linked dark alternate). Every other `*.html` is a dead
   experiment. Never edit one and assume it is live.
2. **The page fetches data from a hardcoded GitHub raw URL**, not from `app.py`.
   One URL, no "source detection." Do not invent a switching mechanism.
3. **The JSON contract is frozen.** Read fields defensively; tolerate new
   fields; never assume a field that might be absent.
4. **Do not fix invisible-table bugs with `!important`.** That exact path was
   tried and reverted twice on 2025-11-22. Compare against last-known-good.
5. **There is no automated UI test.** Your only verification is opening the
   rendered page and confirming the table shows real numbers. Do it every time.

---

## 1. Which files are real (verified 2025-11 / 2026-07)

| File | Status | Role |
|------|--------|------|
| `forecast.html` | **CANONICAL — LIVE** | ~96 KB monolith. The `index.html` redirect target. A `@vercel/static` build. This is *the* front-end. |
| `forecast_new.html` | **LIVE (alternate)** | ~63 KB dark-theme alternate, linked from `forecast.html` (line 948: `<a href="/forecast_new.html">✨ Try the New Dark Design →</a>`). Fetches the **same** data URL. |
| `index.html` | LIVE (redirect only) | 462-byte page whose only job is `window.location.href = 'forecast.html'`. Do not add logic here. |
| `forecast-dark.html` | EXPERIMENT | Present in `vercel.json` builds/routes but **not** linked from the canonical page; treat as legacy. Do not rely on it. |
| `forecast-modern.html` | EXPERIMENT | In `vercel.json` but not the live UX path. |
| `forecast-dark2.html` | EXPERIMENT | Not in `vercel.json`, not linked. Dead. |
| `comprehensive.html` | EXPERIMENT | Dead. |
| `index-static.html` | EXPERIMENT | Dead. |
| `vt_page.html` | NOT A PAGE | A captured snow-forecast.com scrape sample used for parser work. Never serve it. |

**Rule:** if you are asked to "change the site," you change `forecast.html`
(and usually mirror the change into `forecast_new.html`). Touching any other
`*.html` changes nothing a user sees and wastes the edit.

> Note: `vercel.json` still lists `forecast-dark.html` and `forecast-modern.html`
> as static builds/routes. Their presence in Vercel config does **not** make them
> canonical — the canonical UX is the `index.html → forecast.html → forecast_new.html`
> chain. If you prune them, that is a `snowforcast-change-control` / operations
> decision, not a UI-contract change.

---

## 2. Where the data comes from (the real path)

Both live pages fetch the frozen JSON **directly from GitHub raw**, client-side:

```js
// forecast.html:961
const GITHUB_DATA_URL = 'https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json';
// forecast_new.html:919 uses the same URL (as GITHUB_URL)
```

The fetch happens client-side (`forecast.html:1808`, inside `loadForecast`),
caching the whole blob in `allForecastsData` after the first call.

**Critical correction to the docs:** `README.md:51` claims `forecast.html` has
"automatic source detection (static vs. live)". **This is false.** There is
exactly one hardcoded URL and no detection logic. Do not write code that assumes
a static-vs-live switch exists, and do not "restore" one. (If you touch the
README, that drift is owned by `snowforcast-docs-and-writing`.)

- `app.py` (Flask) is the Vercel **dynamic** path and can serve data, but the
  static pages **do not depend on it**. The committed-JSON-from-GitHub-raw path
  is the one real users hit. Treat `app.py` as secondary; changing it does not
  change what the static page shows.

### JSON shape you are reading

Top level is an object keyed by **resort name** (`Val-Thorens`, `Cervinia`,
`Via-Lattea`, `Monterosa-Ski`, `Gudauri`, `St-Anton`, `Alpe-d-Huez`,
`La-Plagne`, `Mount-Hermon` as of 2026-07). Each resort holds elevation bands
keyed `bot` / `mid` / `top`, each with a list of forecast days.

The page reads it defensively today, e.g.:

```js
snowfallRanges.push(day.snowfall_range || null);              // forecast.html:1289,1594
if (day.snowfall_range && (day.snowfall_range[1] - day.snowfall_range[0]) >= 1) {
    const sources = day.snowfall_sources ? ` · ${day.snowfall_sources} models` : '';   // :2306
}
```

**Copy that discipline.** `snowfall_range`, `snowfall_models`,
`snowfall_sources`, and the extended block were **added additively** — older
data would not have them, so every read guards with `|| null` / `if (field)`.

---

## 3. The frozen field contract

`data/all-forecasts.json` is a **deployed contract**, not just a local file. The
live page reads it over the network with no schema negotiation.

**Rules for the UI side:**

- **Read defensively.** Never do `day.snowfall_range[0]` without first checking
  `day.snowfall_range` exists. The blob you get in production may be older or
  newer than the one on your disk.
- **Tolerate additive fields.** New fields may appear. Your rendering must not
  break when it sees a key it does not recognize — just ignore it.
- **Never assume a field the JSON might not carry.** If a resort or a day is
  missing a field, render a no-data state (Section 6), not a guessed value.
- **You may not rename or remove existing fields/paths** to suit the UI. That is
  producer-side and is gated by `snowforcast-architecture-contract` and
  `snowforcast-change-control`. Existing fields disappearing = the live page
  breaks silently for every user.

---

## 4. Rendering fragility — the invisible-table saga

**This page's forecast table/grid has rendered completely invisible before, and
the "obvious" CSS fix made it worse.** Verified from git history:

| Commit | Date | What happened |
|--------|------|---------------|
| `89ab11c8` | 2025-11-22 | "Fix forecast grid visibility with **important** CSS rule" — the band-aid. |
| `6ddcfc08` | 2025-11-22 | "Revert forecast.html to working version (6bf2089)" — band-aid reverted. |
| `28f1070d` | 2025-11-22 | "Revert forecast.html to version 66c62ab" — reverted again. |

Both reverts landed the **same day** as the `!important` fix. The lesson:
**`!important` did not fix the visibility bug; it papered over it and the change
had to be rolled back twice.**

### Discipline when the table/grid is blank or invisible

1. **Do NOT add `!important`.** It is not a fix here; it is a known dead end.
   (See `snowforcast-failure-archaeology` for the full CSS-visibility story.)
2. **Diff against last-known-good** instead of patching forward blind:
   ```bash
   # find the last commit that touched the file and eyeball the working version
   git log --oneline -- forecast.html | head
   git diff 6bf2089 -- forecast.html        # 6bf2089 = a known-working baseline
   ```
   If a recent commit made it disappear, prefer reverting to the last version
   that rendered over stacking CSS overrides.
3. **Suspect the data path before the CSS.** A blank grid is often "the fetch
   failed / the resort key is missing," not a stylesheet problem — check the
   browser console for the fetch error first (Section 6).
4. **Test the rendered page** (Section 5) before and after — a CSS change that
   "looks right" in the source is not verified until the table draws.

This is a UI-local guardrail. The full incident log lives in
`snowforcast-failure-archaeology`; the rule that forbids re-running it lives in
`snowforcast-change-control`.

---

## 5. Verification — there is no test, so eyeball it deliberately

**No automated UI test exists.** `test_openmeteo.py` and `test_vt_scrape.py` are
manual network scripts, not a UI suite, and the only automation (the 3-hourly
data-refresh GitHub Action) commits scraped data — it does **not** render or
check the page. A green Action tells you nothing about whether the page draws.

**Your only safety net is opening the rendered page and confirming the table
shows real numbers.** Do this every time you touch a live HTML file.

### Checklist — run after every UI edit

- [ ] Open the page and confirm the **forecast table/grid renders** (not blank).
- [ ] Confirm cells show **real numbers**, not `undefined`, `NaN`, `null`, or empty.
- [ ] Switch resort and elevation band (`bot`/`mid`/`top`) — each still renders.
- [ ] Open the browser console — **no red errors**, and you see
      `✓ Loaded all forecasts from GitHub`.
- [ ] Trigger a failure case (e.g. a resort key that is not in the JSON) and
      confirm you get the **visible error banner**, not a blank/zero cell.
- [ ] Repeat for `forecast_new.html` if you mirrored the change.

### How to open it

```bash
# Local, quickest: serve the repo root and load the canonical page
cd "$(git rev-parse --show-toplevel)"
python3 -m http.server 8000
# then open http://localhost:8000/forecast.html   (and /forecast_new.html)
```

Because the page pulls data from GitHub raw at runtime, the **local file renders
against live production data** — you do not need a local data server. That also
means it is safe to eyeball the deployed URL directly as the final check. Both
count as verification; do at least one, deliberately.

---

## 6. Fail loud — never show a silent default

The worst class of bug in a forecast product is **silently showing wrong
numbers**. A blank cell reads as "zero snow." A defaulted value reads as truth.
Both destroy trust more than a visible error does.

**Rules:**

- A missing or failed resort/elevation/day must produce a **visible "no data"
  state**, never a blank cell and never a silently substituted default.
- Never carry one resort's value into another as a fallback. (This is the same
  class of bug as the infamous 2300 m snow-line default that silently applied
  Val Thorens' elevation to other resorts — see `snowforcast-change-control`.)
- Any fallback that must exist has to be **visibly labeled as a fallback** in
  the UI, not disguised as real data.

**What the code does today (keep it this way):** `loadForecast` throws on a
missing resort or elevation and renders a banner instead of blank cells —

```js
// forecast.html:1819-1827
const resortData = allForecastsData[currentResort];
if (!resortData) { throw new Error(`No data available for ${currentResort}`); }
const data = resortData[currentElevation];
if (!data) { throw new Error(`No data available for elevation ${currentElevation}`); }
// ...caught at :1840-1844 -> shows #error banner: "❌ " + err.message
```

`forecast_new.html` has the same pattern (visible `#error` element, `catch`
sets it visible at ~line 1165-1168). If you add new rendering, extend this
fail-loud pattern to it — guard the read, and on absence show the visible
no-data/error state rather than letting `undefined` fall through into a cell.

---

## 7. First-glance / social-share constraints

The link is dropped into a WhatsApp group of skiers with **no meteorology
background**. Design for the two-second glance:

- The **headline number** (how much snow) and a **trust cue** (how sure / how
  many models agree, e.g. the `snowfall_range` spread) must read instantly,
  above the fold, without scrolling or interpretation.
- Do **not** surface raw jargon in the primary view: freezing level, snow line,
  mm-vs-cm water equivalent, or model names (AROME/ICON/ECMWF/GFS/MET-Norway).
  If a concept must appear, it needs a plain-language label.
- **Wording is not decided here.** For every user-facing label, defer to
  `snowforcast-meteorology-for-laypeople` — that is the single home for
  plain-language phrasing. Do not invent competing wording in the HTML.

The uncertainty/range is a *feature* for this audience ("how much to trust
today's number"), not clutter — see `snowforcast-consensus-and-model-reference`
and `snowforcast-calibration-and-honest-uncertainty` for what the numbers mean.

---

## 8. When NOT to use this skill

| You need… | Use instead |
|-----------|-------------|
| The exact plain-language wording of a label | `snowforcast-meteorology-for-laypeople` |
| The WhatsApp Open Graph / link-preview card (the capstone) | `snowforcast-link-preview-and-positioning` |
| Rules for changing the JSON producer / additive-only enforcement | `snowforcast-architecture-contract`, `snowforcast-change-control` |
| The full incident history behind these rules | `snowforcast-failure-archaeology` |
| Triaging a live "something looks wrong" symptom | `snowforcast-debugging-playbook` |
| Measuring that the data is actually correct | `snowforcast-data-integrity-and-validation` |
| Fixing the scraper that produces the JSON | `snowforcast-scraper-resilience-campaign` |
| Editing README/DEPLOYMENT docs | `snowforcast-docs-and-writing` |

**Never route around change control.** If your UI change requires a JSON field
to change, stop and go through `snowforcast-change-control` first.

---

## Provenance and maintenance

Facts here were verified against the repo on **2026-07-08** (git history dates
are from the commit metadata, 2025-11-22). Re-verify volatile claims with:

```bash
# Canonical URL chain: index -> forecast.html, and the alternate link
grep -n "location.href" index.html
grep -n 'href="/forecast_new.html"' forecast.html

# The single hardcoded data URL in each live page (no source detection)
grep -n "raw.githubusercontent" forecast.html forecast_new.html

# The client-side fetch site
grep -n "fetch(GITHUB_DATA_URL)" forecast.html

# The false README claim (docs drift)
grep -n "automatic source detection" README.md

# The !important CSS revert saga (should show fix + two reverts on 2025-11-22)
git log --oneline --all | grep -iE "important|Revert forecast"
git show -s --format="%ci %s" 89ab11c8 6ddcfc08 28f1070d

# Fail-loud error handling still in place
grep -n "No data available for" forecast.html

# Which HTML files Vercel builds (canonical vs experiment)
grep -n "static\|\.html" vercel.json

# Top-level JSON keys (resort list may grow additively)
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"
```

If line numbers cited above have drifted, re-grep for the string rather than
trusting the number — the file is a ~96 KB monolith and lines move.
