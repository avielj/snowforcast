---
name: snowforcast-link-preview-and-positioning
description: >-
  How the shared snowforcast forecast link presents itself when dropped into a
  WhatsApp chat — the Open Graph / link-preview cards and the standards a good
  card must meet. HOME OF THE CAPSTONE: 4–5 WhatsApp link-preview / OG card
  options (og:title / og:description / og:image / twitter:card + image sizes).
  Load when the task touches: link previews, social/WhatsApp sharing, Open Graph
  or Twitter card meta tags, og:image generation, how the link "looks" when
  shared, external positioning/tagline, or the trust/honesty of the shared
  preview copy. Covers what is feasible on the static (Vercel-served) path vs
  the Vercel/app.py dynamic path, and the fail-loud rule for a baked-in OG
  image. NOT for the
  in-page UI (use snowforcast-frontend-ui-contract), NOT for the plain-language
  glossary the copy draws on (use snowforcast-meteorology-for-laypeople), NOT for
  README/internal docs (use snowforcast-docs-and-writing).
---

# snowforcast Link Preview & Positioning

**What this skill is for.** The snowforcast link gets shared socially — one ski
buddy pastes the URL into a WhatsApp group and everyone sees a preview card
*before* anyone taps through. This skill is the home of the **capstone
deliverable**: 4–5 Open Graph / WhatsApp link-preview card options for that
shared link, plus the standards any card must meet and the two-host constraints
on how you can actually serve it.

**This skill is external positioning only.** It governs the card the outside
world sees. It does **not** govern the page itself.

> **Boundary — when NOT to use this skill:**
> - Editing the in-page dashboard UI → `snowforcast-frontend-ui-contract`.
> - Choosing the plain-language words / avoiding jargon in the copy → the
>   glossary lives in `snowforcast-meteorology-for-laypeople`; this skill only
>   applies those words to the card.
> - README / DEPLOYMENT / setup docs → `snowforcast-docs-and-writing`.
> - What the numbers *mean* (median, model spread, ranges) →
>   `snowforcast-consensus-and-model-reference`.
> - Any change to the scraper, JSON contract, or which HTML is canonical → gated
>   by `snowforcast-change-control`. **This skill may not route around it.**

---

## 30-second orientation (verified ground truth, 2026-07-08)

- The shared link is a **static HTML page**. `index.html` is a JS redirect
  (`window.location.href = 'forecast.html'`, `index.html`) and
  **`forecast.html` is canonical**; `forecast_new.html` is the live dark
  alternate linked from it. Both fetch the frozen JSON from
  `https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json`
  (verified: `forecast.html:961`, `forecast_new.html:919`).
- **There are currently NO Open Graph or Twitter meta tags in either page.**
  Verified 2026-07-08: `grep -in 'og:\|twitter:' forecast.html forecast_new.html`
  returns only `<meta charset>`, `<meta viewport>`, and `<title>`. **This
  capstone is greenfield — you are adding the first cards, not editing existing
  ones.**
- **Vercel is the sole live host** (verified 2026-07-08:
  `https://snowforcast.vercel.app/forecast.html` → **200**). `vercel.json` builds
  `forecast.html` etc. as `@vercel/static`, plus `app.py` as `@vercel/python` for
  `/api/*` and the catch-all. GitHub Pages
  (`https://avielj.github.io/snowforcast/…`) is documented but **NOT enabled** →
  **404**; do not treat it as a live host. The shared link is the **static**
  `forecast.html` served by Vercel. (The page's JSON *data* comes from
  `raw.githubusercontent.com` — that is GitHub **raw**, not GitHub **Pages**;
  keep the two distinct.)
- `requirements.txt` has **no image library** (`requests`, `beautifulsoup4`,
  `lxml`, `flask` only — verified 2026-07-08). Nothing generates an image today.

---

## THE HARD RULE THIS SKILL INHERITS — fail loud, even in the card

`snowforcast-change-control` **Rule 0** is *fail loud, never silently substitute
a default*. It applies to the preview card too.

> **A static OG image (or og:description) generated from data must never bake in
> a stale or default number that misleads before the page loads.**

Why this bites *specifically* on the card:

1. An OG image is **fetched and cached by WhatsApp when the link is first
   shared** — often once, sometimes for days. The number frozen into the image
   can be far staler than the page, which re-fetches live JSON on every load.
2. The data itself refreshes only **every 3 hours** (the `update-forecast.yml`
   cron), and a scrape can silently fail (green Action ≠ correct data — see
   `snowforcast-scraper-resilience-campaign`). A card that asserts "40 cm
   Thursday" can outlive the truth by days.
3. This is the exact failure class the whole project exists to prevent: the 2300 m
   default that silently showed one resort's number for another. A card that
   shows a placeholder/default snowfall figure is the same sin in a more public
   place.

**Rules for a data-derived card:**

- **Never** embed a hardcoded/placeholder number ("00 cm", "-- cm", a demo
  value) in a committed OG image. If real data is missing, the card must fall
  back to a **data-free** design (brand + generic promise), not a fake number.
- If you show a number, **stamp its as-of time** ("as of Mon 13:00") so a stale
  card is self-evidently old, and keep the number a **range** not a false-precise
  point (see honest-positioning below).
- **Prefer a data-free evergreen card** for the capstone default. It cannot go
  stale, needs no regeneration pipeline, and cannot violate Rule 0. Data-in-card
  is an *advanced, opt-in* option with a regeneration cost (below).

---

## Copy standards every card must meet

The audience is the owner + ski buddies planning trips over WhatsApp with **no
meteorology background** (see `snowforcast-meteorology-for-laypeople`). The card
is seen by people who have not opened the page.

| Standard | Rule | Fail example → Fix |
|---|---|---|
| **Zero meteorology jargon** | No "freezing level", "snow line", "water-equivalent", "mm vs cm", model names (AROME, ICON, ECMWF, GFS, MET-Norway), "ensemble", "p10/p90". | ~~"6-day multi-model ensemble, freezing level 2300 m"~~ → "Snow coming to the Alps this week?" |
| **First-glance clarity** | A buddy glancing at the preview must get *"is there snow coming?"* answered, or clearly know the link answers it. Title readable in ~1 second. | ~~"Snowforcast — resort weather dashboard"~~ → "Will it snow at your resort this week?" |
| **Stable, trustworthy tone** | Calm, factual, no hype, no exclamation-storm, no emoji-spam. This is a trust product; it must read like it. One tasteful snow emoji max. | ~~"❄️❄️ EPIC POW ALERT!! 🔥"~~ → "Fresh snow outlook for 9 Alps resorts. ❄️" |
| **Names the resorts / scope** | The value is "our resorts in one place". Say it plainly. | "Snow outlook for Val Thorens, Cervinia, St Anton and 6 more." |
| **No false precision** | The card promises a *look*, not a guarantee. Never "guaranteed 40 cm". | "How much snow, and how sure we are." |

Pull the actual resort list from the JSON so copy never drifts:

```bash
# Verified 2026-07-08: 9 resorts
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"
# -> ['Val-Thorens','Cervinia','Via-Lattea','Monterosa-Ski','Gudauri','St-Anton','Alpe-d-Huez','La-Plagne','Mount-Hermon']
```

---

## Honest positioning — what the card may and may NOT claim

The card is marketing surface. It must not overclaim what the system does.

- **Do NOT say "skill-weighted AI forecast" (or "AI-weighted", "self-learning",
  "skill-tuned").** The skill-weighting scheme is **dormant**: verified
  2026-07-08, `data/all-forecasts.json` → every resort's
  `consensus.skill_weights` is `null`, and the blend `method` is a plain
  `"median"`. The scoring in `forecast_skill.py` is a research proxy (it scores
  forecasts against *other forecasts*, not measured snow — see
  `snowforcast-forecast-skill-methodology`). Advertising skill-weighting would be
  a lie the code does not back.
- **Honest framings that ARE true today:** "combines several weather models",
  "shows a snow *range*, not just one guess", "tells you how much the models
  disagree". These map to real emitted fields (`snowfall_range`,
  `snowfall_models`, `consensus.method = "median"`).
- **If the card shows uncertainty, show it honestly.** The system's genuine
  edge is *honest uncertainty* (see `snowforcast-calibration-and-honest-
  uncertainty`, which is explicit that calibration is an **open** problem). So a
  card may say "with a range" but must **not** say "calibrated confidence" or
  "know exactly how much to trust it" — the project cannot yet back that claim.
- **Represent a range as a range.** "20–40 cm" not "30 cm". The range is the
  honest signal; collapsing it to a point contradicts the product's whole thesis.

Positioning tagline candidates (all honest as of 2026-07-08 — pick per card):

- "Snow outlook for our Alps resorts — with how sure we are."
- "Several weather models, one snow range per resort."
- "Is there snow coming? Check before you book."

---

## THE CAPSTONE — 4–5 card options

Each option is a full, paste-ready `<meta>` block for the `<head>` of
`forecast.html` (and mirror into `forecast_new.html`). **These are proposals for
the owner to choose from — do not merge one silently; adding meta tags to the
canonical front-end is a change gated by `snowforcast-change-control` and
`snowforcast-frontend-ui-contract`.**

> **CRITICAL crawler fact:** WhatsApp/Facebook/Twitter crawlers **do not run
> JavaScript**. The page injects data via `fetch()` at runtime, so **any
> JS-injected meta tag is invisible to the preview**. Every tag below MUST be
> **static, committed into the HTML `<head>`**. `og:image` MUST be an
> **absolute `https://` URL** to a repo-hosted asset — crawlers cannot use
> relative paths or `data:` URIs for `og:image`.

Set the canonical shared origin first. **Vercel is the sole live origin**
(verified 2026-07-08 → 200), so use it consistently for every absolute `og:url` /
`og:image`. GitHub Pages is 404/not enabled — do **not** build a card URL on
`github.io` (it would 404 and produce a broken preview):

```
OG_ORIGIN = https://snowforcast.vercel.app     # the live host (GitHub Pages is 404/not enabled)
```

### Option A — Evergreen, data-free (RECOMMENDED default)

Cannot go stale, no pipeline, cannot violate Rule 0. This should ship first.

```html
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Snowforcast">
<meta property="og:title" content="Will it snow at your resort this week?">
<meta property="og:description" content="Fresh-snow outlook for 9 Alps resorts — Val Thorens, Cervinia, St Anton and more. See how much, and how sure. ❄️">
<meta property="og:url" content="OG_ORIGIN/forecast.html">
<meta property="og:image" content="OG_ORIGIN/og/snowforcast-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Snowforcast — snow outlook for Alps ski resorts">
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Will it snow at your resort this week?">
<meta name="twitter:description" content="Fresh-snow outlook for 9 Alps resorts. See how much, and how sure. ❄️">
<meta name="twitter:image" content="OG_ORIGIN/og/snowforcast-card.png">
```

The image `og/snowforcast-card.png` is a **hand-made static graphic** (brand +
tagline + snowy-mountain motif). No numbers → nothing to go stale.

### Option B — Scope-forward ("all our resorts in one place")

Same tag skeleton as A; swap the copy:

```html
<meta property="og:title" content="Snow outlook for our Alps resorts, in one place">
<meta property="og:description" content="Val Thorens, Cervinia, Via Lattea, Monterosa, St Anton, Alpe d'Huez, La Plagne, Gudauri, Mount Hermon — one page, updated through the day.">
```

Honest ("updated through the day" — the cron is 3-hourly), lists the real 9.

### Option C — Question-hook, minimal

Leans entirely on first-glance clarity. Good if the group cares only "pow or no".

```html
<meta property="og:title" content="Is there snow coming? ❄️">
<meta property="og:description" content="Quick snow check for our ski resorts before you plan the weekend.">
```

### Option D — Honest-uncertainty positioning

Advertises the true edge without overclaiming (see honest-positioning rules).

```html
<meta property="og:title" content="How much snow — and how sure we are">
<meta property="og:description" content="Several weather models, one snow range per resort, so you see the disagreement instead of a single guess.">
```

Note: says "range" and "disagreement" (backed by `snowfall_range` /
`consensus.method="median"`), **not** "calibrated" or "AI-weighted".

### Option E — Data-in-card (ADVANCED, opt-in, has a cost)

The only option that puts a live number in the preview. **Do not choose this
unless you also build and verify the regeneration + fail-loud pipeline below.**

```html
<meta property="og:title" content="Snow this week: up to 20–40 cm at Val Thorens">
<meta property="og:description" content="Snow outlook across 9 Alps resorts, as of Mon 13:00. Tap for the full week. ❄️">
<meta property="og:image" content="OG_ORIGIN/og/snowforcast-latest.png">
```

Requirements before E may ship:
1. A generator that reads `data/all-forecasts.json` and renders
   `og/snowforcast-latest.png` — **no image lib is installed today** (`grep -i
   pillow requirements.txt` → none), so this adds a dependency (change-control
   gate).
2. Wired into `update-forecast.yml` so the image regenerates every 3 hours with
   the data (currently that Action only commits `data/*.json`).
3. **Fail-loud:** if the chosen number is missing/null, the generator emits the
   **data-free Option A image**, never a placeholder number. The `og:title`/
   `og:description` static fallback must also be data-free (a crawler that
   fetched before regeneration must not see a stale number baked in the HTML).
4. Always stamp "as of <time>" and use a **range**, never a false-precise point.

---

## Image spec for a WhatsApp-good card

| Spec | Value | Confidence |
|---|---|---|
| Canonical OG size | **1200 × 630 px** (`summary_large_image` standard) | Established OG standard |
| `og:image:width/height` tags | Set them explicitly (helps WhatsApp show the large card vs a tiny thumbnail) | Best practice |
| File format | PNG or JPG (WhatsApp does **not** reliably render SVG or WebP previews) | Best practice, **candidate** — re-verify by testing a real share |
| File size | Keep well under ~300 KB; smaller = more reliably fetched/cached by WhatsApp | Widely-cited limit, **candidate** — not repo-verified |
| URL | Absolute `https://`, publicly reachable, no auth/redirect wall | Hard requirement |
| Text safety | Keep title text away from edges; WhatsApp may crop toward center on some clients | Best practice |
| Aspect for WhatsApp thumbnail | 1200×630 shows a large card when width/height are declared and the image is reachable; otherwise WhatsApp shrinks to a small left thumbnail | **Candidate** — verify by sharing the real link |

> The size/format/limit rows are **external best practice as of 2026-07, not
> verifiable against this repo**. Treat them as candidate defaults and confirm by
> pasting the real link into a WhatsApp chat once live (crawler behavior drifts).

---

## Two-host constraints — what is feasible where

| Concern | Vercel static (`@vercel/static`) — the real shared path | Vercel `app.py` (Flask) path |
|---|---|---|
| Serve static meta tags | ✅ Committed in `forecast.html` `<head>`, served statically (`vercel.json` `@vercel/static`) | ⚠️ `app.py` could render tags, but it is **not** the pasted shared URL |
| Serve a committed OG image | ✅ Commit `og/*.png`, reference by absolute **Vercel** URL | ✅ Also servable statically |
| Dynamic per-request OG image | ❌ Impossible — no server, no build step you control per request | ⚠️ *Technically* possible via an `app.py` route, but the **static pages do not depend on `app.py`** and the shared link is the static one, so a dynamic endpoint would not be the URL people paste |
| JS-injected meta tags | ❌ Crawlers don't run JS — invisible | ❌ Same |
| Regenerate data-in-card image | ⚠️ Only via the 3-hourly `update-forecast.yml` cron committing a new PNG | ⚠️ Same cron; `app.py` is not in the crawl path |

**Takeaway:** for the canonical shared link, treat it as a **static-only**
problem. Meta tags and image must be **committed artifacts**. Do not design an OG
solution that depends on `app.py` being hit — the shared link doesn't go there
(see `snowforcast-architecture-contract` for why the GitHub-raw static path is
the real one). Do not inject tags with JS.

---

## Self-contained / asset-embedding realities

- **The `og:image` must be a repo-hosted absolute URL — no external CDN.** Two
  reasons: (1) a third-party CDN is a dependency/availability/privacy risk for a
  link you hand to friends; (2) it can rate-limit or disappear, breaking the
  preview. Commit the PNG to the repo and serve it from the same origin as the
  page.
- **`data:` URIs do not work for `og:image`.** Crawlers need a fetchable
  `https://` URL. (Inline `data:` embedding is only relevant to Claude *Artifact*
  previews, not to a WhatsApp OG card — don't conflate the two.)
- **The in-page assets stay self-contained too.** Fonts/images the card's design
  reuses on the page must be inlined or repo-hosted, consistent with the
  front-end's existing self-contained approach — see
  `snowforcast-frontend-ui-contract`. Do not add a Google-Fonts/CDN dependency
  to the page just to match a card's typography.

---

## Ship checklist (before proposing a card for merge)

- [ ] Owner has picked one option (A–E). Default recommendation is **A**.
- [ ] Copy passes all five Copy Standards (jargon-free, first-glance clear,
      stable tone, names scope, no false precision).
- [ ] Positioning passes honesty rules: **no** "skill-weighted / AI-weighted",
      **no** "calibrated confidence"; any range shown as a range.
- [ ] Tags are **static in `<head>`**, not JS-injected; mirrored into
      `forecast_new.html`.
- [ ] `og:image` is an absolute repo-hosted `https://` URL, 1200×630, PNG/JPG,
      < ~300 KB, with `og:image:width/height` set.
- [ ] If data-in-card (Option E): regeneration wired into `update-forecast.yml`,
      and the **fail-loud fallback to a data-free image** is implemented and
      tested. No placeholder number can ever ship.
- [ ] Change routed through `snowforcast-change-control` (editing canonical
      front-end HTML) — not merged silently.
- [ ] Verified by pasting the real link into a WhatsApp chat and eyeballing the
      preview (crawler behavior is not repo-verifiable).

---

## Provenance and maintenance

Everything below is re-verifiable with one command from the repo root. Re-run if
a claim feels stale. Date-stamped facts were true **2026-07-08**.

```bash
# No OG/Twitter tags exist yet (capstone is greenfield):
grep -in 'og:\|twitter:' forecast.html forecast_new.html   # expect: none

# Canonical redirect target:
grep -n "location.href" index.html                          # -> 'forecast.html'

# Both front-ends fetch the frozen JSON from GitHub raw (static path is real):
grep -in "raw.githubusercontent" forecast.html forecast_new.html

# Skill-weighting is DORMANT (so 'skill-weighted AI' copy is a lie):
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));print(d['Val-Thorens']['bot']['consensus']['skill_weights'], d['Val-Thorens']['bot']['consensus']['method'])"
# expect: None median

# The 9 resorts the copy must match:
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"

# No image library installed (Option E adds a dependency):
grep -in "pillow\|PIL" requirements.txt                     # expect: none

# Data refresh cadence (why a baked number goes stale) — 3-hourly:
grep -n "cron" .github/workflows/update-forecast.yml        # -> '0 */3 * * *'

# Serving of the static page (Vercel builds it as @vercel/static):
cat vercel.json                                             # @vercel/static forecast.html + @vercel/python app.py

# Live host is Vercel; GitHub Pages is NOT enabled (so OG_ORIGIN = the Vercel origin):
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/forecast.html      # expect 200
curl -so /dev/null -w '%{http_code}\n' https://avielj.github.io/snowforcast/forecast.html # expect 404
```

**Known drift risks to re-check:**
- WhatsApp image size/format limits (300 KB, no SVG/WebP) are **external best
  practice, not repo-verified** — confirm by sharing the real link.
- `skill_weights` is `null` **today**; if the skill-weighting scheme is ever
  activated (see `snowforcast-forecast-skill-methodology`), revisit the honest-
  positioning ban on "skill-weighted" language.
- `vercel.json` also statically builds `forecast-dark.html` and
  `forecast-modern.html`, but per `snowforcast-change-control` those are
  **experiments** — only `forecast.html` (canonical) and `forecast_new.html`
  (alternate) carry the cards.
- The live shared origin is **Vercel** (`snowforcast.vercel.app` → 200, verified
  2026-07-08); GitHub Pages (`avielj.github.io/snowforcast`) is documented but
  **not enabled** (→ 404). `OG_ORIGIN` is therefore the Vercel origin — do **not**
  hardcode a `github.io` URL. Re-check with
  `curl -so /dev/null -w '%{http_code}' <url>` if hosting may have changed.
