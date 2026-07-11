---
name: snowforcast-frontend-ui-contract
description: >-
  Read BEFORE any front-end / UI edit to snowforcast. Explains that forecast.html
  is a Codex-redesigned single-page app (topbar with brand + "Share preview" /
  "Compact mode" buttons, hero, metrics grid, "Ride decision" section, hash
  routing #<resort>/<elevation>, localStorage favorites) that you EDIT as a static
  file but that is SERVED DYNAMICALLY through Flask (app.py `_serve_forecast_html`
  + `_enhance_forecast_html`), which injects a style patch and a share/JS
  enhancement at request time. Covers how the page fetches the frozen
  all-forecasts.json AND metadata.json directly from GitHub raw (cache:'no-store'),
  the additive-only JSON field contract, the recurring "table went invisible"
  rendering fragility (do NOT reach for !important), the fact that there is NO
  automated UI test (eyeballing the rendered page is the only safety net), the
  first-glance ski-buddy WhatsApp audience, that forecast.html carries NO static
  og:/twitter: tags (sharing is DYNAMIC via app.py /share/<resort>/<elevation>),
  and the fail-loud rule (a failed resort must show a visible no-data/error state,
  never a blank cell that reads as zero snow). Triggers: editing forecast.html,
  the invisible-table rendering fragility (its fix and prevention), CSS/layout
  changes, changing how the page reads JSON, editing the app.py enhancement layer,
  styling the headline snow number, hash routing / favorites / compact mode. For
  triaging the acute live symptom ("the table is blank right now") start at
  snowforcast-debugging-playbook, which owns first contact and routes here.
---

# Snowforcast Front-End UI Contract

You are about to change the user-facing web page. This file tells you **which
file is real, how it is actually served, where its data comes from, and the
specific ways this page has broken before** so you do not re-break it. Read it
fully before your first edit.

`snowforcast` is a ski-resort snow-forecast dashboard. The audience is the owner
plus a small group of ski buddies who plan trips together and share the page
link over WhatsApp. None of them know meteorology.

> Refreshed **2026-07-11** to match the post-Codex redesign. The domain content
> (JSON contract, fail-loud rule, invisible-table history, WhatsApp audience) is
> unchanged; the **file layout, the serving path, and the share mechanism** all
> changed. See "What changed" below.

---

## 0. TL;DR — the six rules

1. **One HTML file ships as the UX: `forecast.html`** — a Codex redesign
   (topbar, hero, metrics grid, "Ride decision", hash routing, favorites). Every
   other `*.html` is a dead experiment or an unlinked standalone. Never edit one
   and assume it is live.
2. **You edit `forecast.html` as a file, but it is served DYNAMICALLY.**
   `vercel.json` routes `/forecast.html` and `/` to `app.py`, which reads the
   file and runs it through `_enhance_forecast_html()` before returning it. What
   users see = the file **plus** an injected style patch and share/JS layer.
3. **The page fetches data from hardcoded GitHub raw URLs** — `all-forecasts.json`
   **and** `metadata.json`, both `cache:'no-store'`. One host, no "source
   detection." Do not invent a switching mechanism.
4. **The JSON contract is frozen.** Read fields defensively; tolerate new fields;
   never assume a field that might be absent.
5. **Do not fix invisible-table bugs with `!important`.** That exact path was
   tried and reverted twice on 2025-11-22. Compare against last-known-good.
6. **There is no automated UI test.** Your only verification is opening the
   rendered page and confirming the grid shows real numbers. Do it every time.

---

## What changed in the Codex redesign (read this first)

If your memory of this page is the old ~96 KB "dashboard that links to a dark
alternate," that is gone. Verified 2026-07-11:

- **`forecast.html` is now a minified ~46 KB single-page app** (~42 physical
  lines — everything is on a few long lines, so cite **strings/function names**,
  never line numbers). It is a self-contained SPA: topbar → hero → metrics grid →
  "Ride decision" section, with hash routing and localStorage favorites.
- **It is served through `app.py`, not statically.** `vercel.json` routes send
  `/forecast.html` **and** `/` to `app.py`; `index()` calls
  `_serve_forecast_html()` → `_enhance_forecast_html()`. So the page is edited as
  a file but SERVED + enhanced dynamically by Flask.
- **`forecast.html` no longer links to `forecast_new.html`.** The old "Try the
  New Dark Design" link is gone. `forecast_new.html` still exists as a file and
  is still built/routed statically at `/forecast_new.html`, but nothing in the
  canonical UX points at it — treat it as an unlinked standalone, not part of the
  live chain.
- **Sharing is DYNAMIC, not static tags.** `forecast.html` has **zero** `og:` /
  `twitter:` meta tags and no `OG:START` markers. The share button builds a
  `/share/<resort>/<elevation>` URL served by `app.py::share_preview()`, which
  renders the per-resort Open Graph page. See Section 7 and
  `snowforcast-link-preview-and-positioning`.

---

## 1. Which files are real (verified 2026-07-11)

| File | Status | Role |
|------|--------|------|
| `forecast.html` | **CANONICAL — LIVE (served via app.py)** | ~46 KB **minified** Codex SPA. Routed to `app.py` and returned through `_enhance_forecast_html()`. This is *the* front-end. |
| `app.py` | **LIVE — the serving + enhancement + share layer** | Reads `forecast.html`, injects the style patch + share JS, and owns `/share/*` and `/share-card/*`. Changing it **does** change what users see now. |
| `index.html` | LIVE (redirect only) | 462-byte page whose only job is `window.location.href = 'forecast.html'`. Do not add logic here. |
| `forecast_new.html` | STANDALONE (unlinked) | 63 KB dark alternate. Still built/routed statically at `/forecast_new.html`, but **no longer linked** from `forecast.html`. Not part of the canonical UX; do not assume edits here reach users. |
| `forecast-dark.html` | EXPERIMENT | In `vercel.json` builds/routes but not the live UX. Legacy. |
| `forecast-modern.html` | EXPERIMENT | In `vercel.json` but not the live UX. |
| `forecast-dark2.html`, `comprehensive.html`, `index-static.html` | EXPERIMENT | Not the live UX. Dead. |
| `vt_page.html` | NOT A PAGE | A captured snow-forecast.com scrape sample used for parser work. Never serve it. |

**Rule:** if you are asked to "change the site," you change **`forecast.html`**
(the file). If the change touches the injected share button, the resort
ordering, the eyebrow removal, or anything that only exists at request time, that
lives in **`app.py::_enhance_forecast_html`** — see Section 2.5. Touching any
other `*.html` changes nothing a user sees and wastes the edit.

> Note: `vercel.json` still lists `forecast-dark.html`, `forecast-modern.html`,
> and `forecast_new.html` as static builds/routes, but the **active** route for
> `/forecast.html` and `/` is `app.py`. Presence in Vercel config does not make a
> file canonical. Pruning the dead ones is a `snowforcast-change-control` /
> operations decision, not a UI-contract change.

---

## 2. Where the data comes from (the real path)

The page fetches its data **directly from GitHub raw**, client-side, from **two**
hardcoded URLs, both with `cache:'no-store'`:

```js
// forecast.html (minified) — the two data sources
'https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json'
'https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/metadata.json'
// fetched via: async function fetchJson(url){const r=await fetch(url,{cache:'no-store'...
```

`all-forecasts.json` carries the forecast blob; `metadata.json` carries the
"updated" timestamp / freshness (fetched with a `.catch()` so a missing metadata
file degrades gracefully). Both come from GitHub raw, **not** from `app.py`.

**Critical correction to the docs:** any doc claiming `forecast.html` has
"automatic source detection (static vs. live)" is **false.** There are hardcoded
URLs and no detection logic. Do not write code that assumes a static-vs-live
switch, and do not "restore" one. (README drift is owned by
`snowforcast-docs-and-writing`.)

### 2.5 app.py is now the PRIMARY serving layer (this inverted)

**Old docs said "treat app.py as secondary." That is now wrong.** `app.py` is the
route that actually answers `/forecast.html` and `/`, and it **rewrites the page
on the way out**. `_enhance_forecast_html(page_html)` does two things:

- **Style patch:** injects `<style>.eyebrow{display:none!important}...</style>`
  before `</head>`.
- **Share/JS enhancement:** injects a `<script>` before `</body>` that:
  - overrides the page's own `copyShareLink` with `robustShareForecast` (Web
    Share API → clipboard `navigator.clipboard` → `<textarea>` fallback →
    `window.prompt`), all building `${origin}/share/<resort>/<elevation>`;
  - adds a top **"🔗 Share forecast"** button into `.top-actions` and a toast;
  - re-orders `resortKeys()` by **country** (`COUNTRY_MAP`/`COUNTRY_ORDER` from
    `RESORT_INFO`) then favorite-first, then name;
  - removes the hero `#hero-eyebrow` and the hero `#share-btn` on render.

**Consequence for editing:** the enhancement wraps the page's own functions
(`resortKeys`, `renderHero`, `updateResortLinks`, `loadForecast`, `copyShareLink`)
by name. **If you rename those functions in `forecast.html`, the enhancement
silently no-ops** (it guards with `typeof … === 'function'`). Keep those names,
or update `_enhance_forecast_html` in the same change. This is the single sharpest
new footgun on the page.

### JSON shape you are reading

Top level is an object keyed by **resort name** (`Val-Thorens`, `Cervinia`,
`Via-Lattea`, `Monterosa-Ski`, `Gudauri`, `St-Anton`, `Alpe-d-Huez`,
`La-Plagne`, `Mount-Hermon` as of 2026-07-11). Each resort holds elevation bands
keyed `bot` / `mid` / `top` (`ELEVATIONS=['bot','mid','top']`), each with a list
of forecast days.

The page reads days defensively — fields seen in the live code include
`day.snowfall`, `day.snowfall_range`, `day.snowfall_sources`, `snowfall_models`,
`day.precipitation`, `day.temp_min`/`temp_max`, `day.condition`,
`day.weather_code`, `day.snow_forecast_com`, `day.openweather`, `day.day_name`.

**Copy that discipline.** `snowfall_range`, `snowfall_models`,
`snowfall_sources`, and the extended block were **added additively** — older data
would not have them, so every read must guard with `|| null` / `if (field)`.

---

## 3. The frozen field contract

`data/all-forecasts.json` is a **deployed contract**, not just a local file. The
live page reads it over the network with no schema negotiation.

**Rules for the UI side:**

- **Read defensively.** Never do `day.snowfall_range[0]` without first checking
  `day.snowfall_range` exists. The blob you get in production may be older or
  newer than the one on your disk.
- **Tolerate additive fields.** New fields may appear. Rendering must not break
  when it sees a key it does not recognize — just ignore it.
- **Never assume a field the JSON might not carry.** If a resort or a day is
  missing a field, render a no-data state (Section 6), not a guessed value.
- **You may not rename or remove existing fields/paths** to suit the UI. That is
  producer-side and gated by `snowforcast-architecture-contract` and
  `snowforcast-change-control`.

---

## 4. Rendering fragility — the invisible-table saga

**This page's forecast grid has rendered completely invisible before, and the
"obvious" CSS fix made it worse.** Verified from git history:

| Commit | Date | What happened |
|--------|------|---------------|
| `89ab11c8` | 2025-11-22 | "Fix forecast grid visibility with **important** CSS rule" — the band-aid. |
| `6ddcfc08` | 2025-11-22 | "Revert forecast.html to working version (6bf2089)" — band-aid reverted. |
| `28f1070d` | 2025-11-22 | "Revert forecast.html to version 66c62ab" — reverted again. |

Both reverts landed the **same day** as the `!important` fix. The lesson:
**`!important` did not fix the visibility bug; it papered over it and had to be
rolled back twice.**

> Extra hazard now: `forecast.html` is **minified** (a few very long lines) and
> the served page also carries the injected `.eyebrow{display:none!important}`
> from `_enhance_forecast_html`. A `git diff` on the file is harder to read, and a
> "why is X hidden?" bug can originate in the **injected** style, not the file —
> check both.

### Discipline when the grid is blank or invisible

1. **Do NOT add `!important`.** It is a known dead end here. (See
   `snowforcast-failure-archaeology` for the full CSS-visibility story.)
2. **Diff against last-known-good** instead of patching forward blind:
   ```bash
   git log --oneline -- forecast.html | head
   git diff 6bf2089 -- forecast.html        # 6bf2089 = a known-working baseline
   ```
   Prefer reverting to the last version that rendered over stacking overrides.
3. **Suspect the data path before the CSS.** A blank grid is often "the fetch
   failed / the resort key is missing," not a stylesheet problem — check the
   browser console for the fetch error first (Section 6).
4. **Check the injected layer.** If something is hidden/reordered only on the
   deployed/Flask-served page but not the raw file, the cause is
   `_enhance_forecast_html`, not the HTML.
5. **Test the rendered page** (Section 5) before and after.

The full incident log lives in `snowforcast-failure-archaeology`; the rule that
forbids re-running it lives in `snowforcast-change-control`.

---

## 5. Verification — there is no test, so eyeball it deliberately

**No automated UI test exists.** `test_openmeteo.py` and `test_vt_scrape.py` are
manual network scripts, not a UI suite, and the 3-hourly data-refresh Action only
commits scraped data — it does **not** render or check the page. A green Action
tells you nothing about whether the page draws.

**Your only safety net is opening the rendered page and confirming the grid shows
real numbers.** Do it every time you touch `forecast.html` or the enhancement.

### Two ways to open it — and they are NOT equivalent now

- **Raw file / plain static server** shows the Codex SPA **without** the app.py
  enhancement (no injected "🔗 Share forecast" top button, no country/favorite
  resort ordering, eyebrow not force-hidden). Good for fast layout/data checks.
- **Flask-served** (`python3 app.py`, or `vercel dev`) shows what production
  actually returns — the file **plus** the injected style + share JS. Use this to
  verify anything touching sharing, resort ordering, or `_enhance_forecast_html`.

```bash
cd "$(git rev-parse --show-toplevel)"

# A) raw SPA only (no enhancement) — quick layout/data check
python3 -m http.server 8000        # → http://localhost:8000/forecast.html

# B) production-equivalent (file + injected enhancement + /share, /share-card)
python3 app.py                     # → http://localhost:5000/forecast.html
```

Because the page pulls data from GitHub raw at runtime, it renders against **live
production data** either way — no local data server needed.

### Checklist — run after every UI edit

- [ ] The **forecast grid renders** (not blank); cells show **real numbers**, not
      `undefined`/`NaN`/`null`/empty.
- [ ] Switch resort and elevation band (`bot`/`mid`/`top`) — each still renders,
      and the URL hash updates to `#<resort>/<elevation>`.
- [ ] Reload on a deep-linked hash (`#Cervinia/mid`) — it restores that view.
- [ ] Toggle **Compact mode** and set a **favorite** — both persist across reload
      (localStorage), and favorite floats to the top of the resort list.
- [ ] Browser console: **no red errors**; the data load succeeds.
- [ ] Trigger a failure case (a resort key not in the JSON) → **visible error
      banner** (`#error`), not a blank/zero cell.
- [ ] If the change touches sharing/ordering/eyebrow, verify via the **Flask**
      path (B), and click **Share** → it produces a `/share/<resort>/<elev>` link.

---

## 6. Fail loud — never show a silent default

The worst class of bug in a forecast product is **silently showing wrong
numbers**. A blank cell reads as "zero snow." A defaulted value reads as truth.
Both destroy trust more than a visible error does.

**Rules:**

- A missing or failed resort/elevation/day must produce a **visible "no data"
  state**, never a blank cell and never a silently substituted default.
- Never carry one resort's value into another as a fallback. (Same class as the
  infamous 2300 m snow-line default that silently applied Val Thorens' elevation
  to other resorts — see `snowforcast-change-control`.)
- Any fallback that must exist has to be **visibly labeled as a fallback** in the
  UI, not disguised as real data.

**What the code does today (keep it this way):** `fetchJson` throws on a non-OK
response (`if(!r.ok)throw new Error(...)`); the init path throws
`'No resorts found in forecast data'` when the blob is empty; the `catch` hides
the loading state and reveals the `#error` banner
(`$('loading').style.display='none';$('error').style.display='block'`). Missing
per-cell values render an explicit `No data` state rather than blank. If you add
new rendering, extend this fail-loud pattern — guard the read, and on absence
show the visible no-data/error state rather than letting `undefined` fall into a
cell.

---

## 7. First-glance / social-share constraints

The link is dropped into a WhatsApp group of skiers with **no meteorology
background**. Design for the two-second glance:

- The **headline number** (how much snow) and a **trust cue** (how sure / how
  many models agree, e.g. the `snowfall_range` spread) must read instantly, above
  the fold, without scrolling or interpretation. The redesign's **hero** + **Ride
  decision** section (Ride status Good/Watch/Low · Best elevation · Best day) is
  where that glance lands — keep it honest and jargon-free.
- Do **not** surface raw jargon in the primary view: freezing level, snow line,
  mm-vs-cm water equivalent, or model names (AROME/ICON/ECMWF/GFS/MET-Norway). If
  a concept must appear, give it a plain-language label.
- **Wording is not decided here.** For every user-facing label, defer to
  `snowforcast-meteorology-for-laypeople` — the single home for plain-language
  phrasing. Do not invent competing wording in the HTML.

**The WhatsApp preview card is DYNAMIC, not a tag on this page.** `forecast.html`
has no `og:`/`twitter:` tags. The "Share preview" / "🔗 Share forecast" buttons
build `/share/<resort>/<elevation>`, which `app.py::share_preview()` renders as a
per-resort OG page (live `og:title`/`og:description`/`og:image`), with the image
served by `/share-card/<resort>/<elevation>.png` (`_share_card_png`, Pillow, with
`/share-card/….svg` fallback). **Do not add static `<meta property="og:*">` tags
to `forecast.html`** expecting them to drive previews — that is not the
mechanism. All of that is owned by `snowforcast-link-preview-and-positioning`.

The uncertainty/range is a *feature* for this audience ("how much to trust
today's number"), not clutter — see `snowforcast-consensus-and-model-reference`
and `snowforcast-calibration-and-honest-uncertainty` for what the numbers mean.

---

## 8. When NOT to use this skill

| You need… | Use instead |
|-----------|-------------|
| The exact plain-language wording of a label | `snowforcast-meteorology-for-laypeople` |
| The WhatsApp / Open Graph share system (`/share`, `/share-card`, the PNG card) | `snowforcast-link-preview-and-positioning` |
| Routing / Vercel / Pillow / fonts / deploy of the app.py-served page | `snowforcast-build-deploy-and-operations` |
| Rules for changing the JSON producer / additive-only enforcement | `snowforcast-architecture-contract`, `snowforcast-change-control` |
| The full incident history behind these rules | `snowforcast-failure-archaeology` |
| Triaging a live "something looks wrong" symptom | `snowforcast-debugging-playbook` |
| Measuring that the data is actually correct | `snowforcast-data-integrity-and-validation` |
| Fixing the scraper that produces the JSON | `snowforcast-scraper-resilience-campaign` |
| Editing README/DEPLOYMENT docs | `snowforcast-docs-and-writing` |

**Never route around change control.** If your UI change requires a JSON field to
change, stop and go through `snowforcast-change-control` first.

---

## Provenance and maintenance

Facts here were verified against the repo on **2026-07-11** (post-Codex
redesign). Git-history dates are from commit metadata (2025-11-22). Re-verify
volatile claims with:

```bash
# forecast.html is SERVED via app.py (routes send /forecast.html and / to app.py)
grep -A2 '"/forecast.html"' vercel.json
grep -n "@app.route('/')\|@app.route('/forecast.html')\|_serve_forecast_html\|_enhance_forecast_html" app.py

# forecast.html carries NO static OG/twitter tags and no OG markers (all → 0)
grep -c 'property="og:' forecast.html
grep -c 'name="twitter:' forecast.html
grep -c 'OG:START' forecast.html

# Codex redesign markers present (topbar / share / compact / hash / decision)
grep -oE 'topbar|Share preview|Compact mode|Ride decision|copyShareLink' forecast.html | sort -u
grep -o 'location.hash' forecast.html          # hash routing #<resort>/<elevation>
grep -o "STORAGE={[^}]*}" forecast.html         # localStorage favorite/compact/lastResort keys

# The redesign no longer links the dark alternate (expect NO output)
grep -o 'forecast_new.html\|New Dark Design' forecast.html

# Two hardcoded GitHub-raw data sources, cache:'no-store' (all-forecasts + metadata)
grep -oE "https://raw.githubusercontent.com[^'\"\\)]+" forecast.html | sort -u

# The dynamic share system lives in app.py (not tags on the page)
grep -n "def share_preview\|def share_card_png\|def _share_card_png\|def _forecast_summary" app.py

# Fail-loud error handling still in place
grep -o "No resorts found in forecast data" forecast.html
grep -o "if(!r.ok)throw new Error" forecast.html

# Pillow required for the PNG share card; fonts bundled for deterministic render
grep -i pillow requirements.txt
ls fonts/

# Top-level JSON keys (resort list may grow additively)
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"

# The !important CSS revert saga (fix + two reverts on 2025-11-22)
git log --oneline --all | grep -iE "important|Revert forecast"
git show -s --format="%ci %s" 89ab11c8 6ddcfc08 28f1070d
```

`forecast.html` is now **minified** — cite strings/function names, not line
numbers. If a `grep` string above stops matching, the file changed; re-derive the
fact from the code rather than trusting this doc.
