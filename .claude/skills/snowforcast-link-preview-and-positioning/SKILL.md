---
name: snowforcast-link-preview-and-positioning
description: >-
  How the shared snowforcast forecast link presents itself when dropped into a
  WhatsApp chat — the DYNAMIC per-resort Open Graph / link-preview card system
  that app.py now serves, and the copy/honesty standards a good card must meet.
  The share system is a live pair of Flask routes: /share/<resort>/<elevation>
  (server-rendered OG page) and /share-card/<resort>/<elevation>.png (a 1200x630
  alpine card drawn with Pillow). Load when the task touches: link previews,
  social/WhatsApp sharing, Open Graph or Twitter card meta tags, og:image
  generation, the /share or /share-card routes, how the link "looks" when shared,
  external positioning/tagline, or the trust/honesty of the shared preview copy.
  NOT for the in-page UI (use snowforcast-frontend-ui-contract), NOT for the
  plain-language glossary the copy draws on (use
  snowforcast-meteorology-for-laypeople), NOT for README/internal docs (use
  snowforcast-docs-and-writing).
---

# snowforcast Link Preview & Positioning

**What this skill is for.** The snowforcast link gets shared socially — one ski
buddy pastes a URL into a WhatsApp group and everyone sees a preview card
*before* anyone taps through. This skill governs that card: the **dynamic
per-resort share system now built into `app.py`**, plus the copy and honesty
standards any card must meet.

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
> - How `app.py` serves and enhances the page overall, Vercel routing, Pillow /
>   fonts deps → `snowforcast-build-deploy-and-operations` and
>   `snowforcast-architecture-contract`.
> - Any change to the scraper, JSON contract, or which HTML is canonical → gated
>   by `snowforcast-change-control`. **This skill may not route around it.**

---

## 30-second orientation (verified ground truth, 2026-07-11)

The greenfield "add static `<meta>` tags to `forecast.html`, pick a card option
A–E" approach that earlier versions of this skill described is **SUPERSEDED**. A
dynamic per-resort share system already exists in `app.py`. This is what is real
today (Codex redesign, verified 2026-07-11):

- **`app.py` is the primary serving path.** `vercel.json` routes
  `/forecast.html → app.py` and has a catch-all `/(.*) → app.py`, plus explicit
  `/share/(.*)`, `/share-card/(.*)`, `/data/(.*)`, `/api/(.*) → app.py`
  (verified: `vercel.json` routes block). `forecast.html` is still committed as a
  file and listed as an `@vercel/static` build, but the **active route serves it
  through `app.py::_serve_forecast_html()`**, which reads the file and runs it
  through `_enhance_forecast_html()` (a style patch + a share-button/JS
  enhancement) before returning (`app.py:326`, `app.py:169`, `@app.route('/')`
  and `@app.route('/forecast.html')` at `app.py:496-497`).
- **`forecast.html` has NO Open Graph / Twitter meta tags** and injects its data
  via `fetch()` at runtime. Verified 2026-07-11: `grep -ic 'og:\|twitter:'
  forecast.html` → 0. So pasting the bare page URL would give a poor preview.
  That is *why* the share button does not share the page URL — it builds a
  `/share/<resort>/<elevation>` link (see below).
- **The share card is DYNAMIC and per-resort, served by two Flask routes:**
  - `@app.route('/share/<resort>/<elevation>')` → `share_preview()`
    (`app.py:505`) server-renders (via `render_template_string`) a per-resort
    HTML page whose `<head>` carries live `og:title` / `og:description` /
    `og:image` for that exact resort+elevation.
  - `@app.route('/share-card/<resort>/<elevation>.png')` → `share_card_png()` →
    `_share_card_png(summary)` (`app.py:548`, `app.py:381`) draws a **1200×630
    PNG** per resort with Pillow — the alpine night design (gradient sky, moon,
    layered snow-capped ridges, falling snow, hero snow number, status pill,
    3-day strip, "as of" stamp). SVG fallback at
    `/share-card/<resort>/<elevation>.svg` (`app.py:565`).
- **Pillow is now a dependency** (`requirements.txt` → `Pillow>=10.0.0`, verified
  2026-07-11) and **fonts are bundled** at `fonts/DejaVuSans.ttf` /
  `fonts/DejaVuSans-Bold.ttf`. `_font()` (`app.py:335`) loads the repo-bundled
  fonts first so the card renders deterministically on Vercel/Lambda with no
  system-font dependency and no emoji tofu.
- **Vercel is the sole live host.** Verified 2026-07-11:
  `/forecast.html`, `/share/Val-Thorens/top`, and `/share-card/Val-Thorens/top.png`
  all → **200** on `snowforcast.vercel.app`. GitHub Pages
  (`avielj.github.io/snowforcast`) is documented but **NOT enabled** → **404**.
- **The page's data still comes from GitHub raw**, not from `app.py`:
  `forecast.html` fetches
  `https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json`
  (and `metadata.json`) at runtime (`forecast.html:23`). `app.py` reads the same
  committed `data/all-forecasts.json` from disk to build the share card, so the
  card and the page draw from the same frozen JSON contract.

---

## Why the DYNAMIC design is the right shape (crawler facts)

> **CRITICAL crawler fact:** WhatsApp/Facebook/Twitter crawlers **do not run
> JavaScript**. The forecast page injects its data via `fetch()` at runtime, so
> the crawler that hits `forecast.html` sees no numbers and no OG tags — a bad
> preview.

The dynamic system solves this correctly:

1. `/share/<resort>/<elevation>` is **server-rendered by Flask**
   (`render_template_string`), so the OG tags are **already in the delivered
   HTML `<head>`** — no JS required. A crawler sees them immediately. This is the
   whole reason the share route exists instead of static tags on `forecast.html`.
2. `og:image` points at an **absolute `https://` URL** built from
   `request.url_root` → `/share-card/<resort>/<elevation>.png?v=2` (`app.py:516`).
   Crawlers can fetch it directly; no relative paths, no `data:` URIs.
3. The share button in `_enhance_forecast_html` builds the link from the
   currently-viewed resort/elevation
   (`${window.location.origin}/share/${resort}/${elevation}`, `app.py:198`), so
   each shared link previews the resort the sharer was actually looking at.

**Do not "fix" this back into static `<meta>` tags on `forecast.html`.** The
dynamic route is deliberate and correct for the no-JS crawler constraint.

---

## What the live routes actually emit (verified 2026-07-11)

**`/share/<resort>/<elevation>` (`share_preview`, `app.py:506-545`):**

- `title`  = `"{flag} {resort_name} {elevation_label} snow forecast"`
  (e.g. `"🇫🇷 Val Thorens Top snow forecast"`).
- `description` = `"{status_icon} {status} · {cm} snow · {mm} rain · wind {n} km/h"`
  (e.g. `"✅ Good · 34 cm snow · 4 mm rain · wind 22 km/h"`).
- Emits `og:type`, `og:site_name` (`SnowForecast`), `og:title`, `og:description`,
  `og:url`, `og:image` (+ `og:image:secure_url`, `og:image:type=image/png`,
  `og:image:width=1200`, `og:image:height=630`), and the matching
  `twitter:card=summary_large_image` / `twitter:title` / `twitter:description` /
  `twitter:image`. The visible body is a minimal card with an "Open live
  forecast" button linking to `/#<resort>/<elevation>`.
- **Fail-safe input handling:** `resort` and `elevation` are sanitized by
  `_safe_key()` (`app.py:35`, strips to `[a-z0-9-]`), and an unknown
  resort/elevation falls back to `Val-Thorens` / `top` — a **real** resort, never
  a placeholder number.

**`/share-card/<resort>/<elevation>.png` (`_share_card_png`, `app.py:381-493`):**

- 1200×630 RGB PNG, `optimize=True`. Response `Cache-Control: public,
  max-age=300` (`app.py:559`).
- Draws: `SNOWFORECAST` eyebrow, a size-to-fit `"{resort_name} {elevation_label}"`
  headline, a big hero `"{snow} cm"` + `snow this week`, a status pill coloured by
  status (**Good** green / **Watch** amber / **Low** red), a 3-day strip with
  vector snowflakes, a bottom row `Rain · Wind · Best`, the wordmark
  `snowforcast · 9 Alps resorts`, and an `as of {updated}` stamp.
- **Fail-loud / graceful:** on any Pillow error it falls back to
  `share_card_svg()` (`app.py:561-562`); if Pillow is unavailable it raises
  rather than shipping a blank. The numbers are always derived from the live
  summary — there is no hardcoded demo value in the card.

**Status thresholds** (from `_forecast_summary`, `app.py:132-137`, so card copy
matches the page): `Good` when total snow ≥ 20 cm **and** rain ≤ 8 mm **and**
peak wind ≤ 45 km/h; `Watch` when snow ≥ 6 cm **or** rain ≤ 18 mm; else `Low`.

---

## THE HARD RULE THIS SKILL INHERITS — fail loud, even in the card

`snowforcast-change-control` **Rule 0** is *fail loud, never silently substitute
a default*. It applies to the preview card too.

> **A share card generated from data must never bake in a stale or default
> number that misleads before the page loads.**

Why this bites *specifically* on the card, and how the current design handles it:

1. **WhatsApp caches the OG image when the link is first shared** — often once,
   sometimes for days — while the page re-fetches live JSON on every load. The
   card mitigates this two ways: it **stamps `as of {updated}`** so a stale card
   is self-evidently old, and the `og:image` URL carries a `?v=2` cache-bust
   token (`app.py:516`) plus a short `max-age=300` on the PNG response. If you
   change the card design, **bump that `?v=` token** or WhatsApp will keep
   serving the old cached image.
2. **The data refreshes only every 3 hours** (`update-forecast.yml`, cron
   `0 */3 * * *`) and a scrape can silently fail (green Action ≠ correct data —
   see `snowforcast-scraper-resilience-campaign`). The `as of` stamp is the honest
   signal that a card may be old.
3. This is the exact failure class the whole project exists to prevent: the old
   2300 m default that silently showed one resort's number for another. The
   current routes avoid it — an unknown resort falls back to a **real** resort
   (Val-Thorens/top), not a fabricated number, and the card only ever renders
   values pulled from the live summary.

**Rules when you touch the card generator or the share route:**

- **Never** introduce a hardcoded/placeholder number ("00 cm", "-- cm", a demo
  value) into `_share_card_png` or the share `description`. If a field is
  missing, render the honest fallback resort's real data or omit the field —
  never a fake number.
- **Keep the `as of {updated}` stamp.** Removing it would let a cached card
  outlive the truth invisibly.
- **Keep the range/point honesty** (see honest-positioning below): a card may
  show the median snow total, but must not dress a single number as a guarantee.

---

## Copy standards every card must meet

The audience is the owner + ski buddies planning trips over WhatsApp with **no
meteorology background** (see `snowforcast-meteorology-for-laypeople`). The card
is seen by people who have not opened the page.

| Standard | Rule | Fail example → Fix |
|---|---|---|
| **Zero meteorology jargon** | No "freezing level", "snow line", "water-equivalent", "mm vs cm", model names (AROME, ICON, ECMWF, GFS, MET-Norway), "ensemble", "p10/p90". | ~~"6-day multi-model ensemble, freezing level 2300 m"~~ → "Snow coming to the Alps this week?" |
| **First-glance clarity** | A buddy glancing at the preview must get *"is there snow coming?"* answered, or clearly know the link answers it. Title readable in ~1 second. | ~~"Snowforcast — resort weather dashboard"~~ → "🇫🇷 Val Thorens Top snow forecast" |
| **Stable, trustworthy tone** | Calm, factual, no hype, no exclamation-storm, no emoji-spam. This is a trust product; it must read like it. One tasteful snow emoji / status icon max. | ~~"❄️❄️ EPIC POW ALERT!! 🔥"~~ → "✅ Good · 34 cm snow · 4 mm rain · wind 22 km/h" |
| **Names the resort / scope** | The value is "our resorts in one place". The per-resort card names the resort in the title; the wordmark says `9 Alps resorts`. | "🇮🇹 Cervinia Mid snow forecast" |
| **No false precision** | The card promises a *look*, not a guarantee. Never "guaranteed 40 cm". | Show the number with an `as of` stamp; never "guaranteed". |

The current `share_preview` title/description already follow these. When editing
copy, pull the resort list from the JSON so nothing drifts:

```bash
# Verified 2026-07-11: 9 resorts
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"
# -> ['Val-Thorens','Cervinia','Via-Lattea','Monterosa-Ski','Gudauri','St-Anton','Alpe-d-Huez','La-Plagne','Mount-Hermon']
```

---

## Honest positioning — what the card may and may NOT claim

The card is marketing surface. It must not overclaim what the system does.

- **Do NOT say "skill-weighted AI forecast" (or "AI-weighted", "self-learning",
  "skill-tuned").** The skill-weighting scheme is **dormant**: verified
  2026-07-11, `data/all-forecasts.json` → `Val-Thorens.bot.consensus.skill_weights`
  is `null` and the blend `method` is a plain `"median"`. The scoring in
  `forecast_skill.py` is a research proxy (it scores forecasts against *other
  forecasts*, not measured snow — see `snowforcast-forecast-skill-methodology`).
  Advertising skill-weighting would be a lie the code does not back.
- **Honest framings that ARE true today:** "combines several weather models",
  "shows a snow *range*, not just one guess", "tells you how much the models
  disagree". These map to real emitted fields (`snowfall_range`,
  `snowfall_models`, `consensus.method = "median"`).
- **If the card shows uncertainty, show it honestly.** The system's genuine edge
  is *honest uncertainty* (see `snowforcast-calibration-and-honest-uncertainty`,
  which is explicit that calibration is an **open** problem). A card may say "with
  a range" but must **not** say "calibrated confidence" or "know exactly how much
  to trust it" — the project cannot yet back that claim.
- **Represent a range as a range.** The card currently shows a single median snow
  total per resort. If you add spread, show it as "20–40 cm" not a false-precise
  point. The range is the honest signal.

Positioning tagline candidates (all honest as of 2026-07-11 — for the wordmark or
a future evergreen fallback card):

- "Snow outlook for our Alps resorts — with how sure we are."
- "Several weather models, one snow range per resort."
- "Is there snow coming? Check before you book."

---

## Image spec for a WhatsApp-good card

The live card already meets the hard rows (1200×630, PNG, absolute https). Keep
it that way when editing.

| Spec | Value | Confidence |
|---|---|---|
| Canonical OG size | **1200 × 630 px** (`summary_large_image` standard) — matches `_share_card_png` `W, H = 1200, 630` | Verified in code |
| `og:image:width/height` tags | Set explicitly by `share_preview` (helps WhatsApp show the large card) | Verified in code |
| File format | PNG (WhatsApp does **not** reliably render SVG/WebP previews — the `.svg` route is a *fallback for rendering failure*, not the OG target) | Best practice, **candidate** — re-verify by testing a real share |
| File size | Keep well under ~300 KB; PNG saved with `optimize=True`. Re-check after any design change with a real byte count. | Widely-cited limit, **candidate** — not repo-verified |
| URL | Absolute `https://`, publicly reachable (`request.url_root` + `/share-card/…png?v=2`) | Verified in code |
| Cache-busting | `?v=2` query token on `og:image` + `max-age=300` — **bump `?v=` on any card redesign** or WhatsApp serves the stale cached image | Verified in code |
| Text safety | Keep title text away from edges; WhatsApp may crop toward center on some clients | Best practice |

> The size/format/limit rows are **external best practice as of 2026-07, not
> verifiable against this repo**. Treat them as candidate defaults and confirm by
> pasting the real `/share/<resort>/<elevation>` link into a WhatsApp chat once
> live (crawler behavior drifts).

---

## Where sharing is feasible — app.py is the whole story now

| Concern | Reality today |
|---|---|
| Serve OG meta tags a crawler can read | ✅ `/share/<resort>/<elevation>` is **server-rendered by Flask** — tags are in the delivered HTML, no JS needed. This is the shared link. |
| Serve a per-resort card image | ✅ `/share-card/<resort>/<elevation>.png` renders it on demand with Pillow; `.svg` is the fallback. |
| Dynamic per-request OG image | ✅ Now possible and **in use** — `app.py` is the serving path (`vercel.json` catch-all `/(.*) → app.py`). This is the change from the old static-only world. |
| JS-injected meta tags | ❌ Still invisible to crawlers — which is exactly why the tags are server-rendered, not injected into `forecast.html`. |
| Static `og:*.png` committed file | Not the mechanism. There is **no `/og/` route** in `vercel.json` (verified 2026-07-11, `grep -c '/og/' vercel.json` → 0). The card is generated dynamically; do not reintroduce a committed static OG file as "the" card. |

**Takeaway:** the shared link is `/share/<resort>/<elevation>`, served by
`app.py`. Do not design an OG solution around static tags on `forecast.html` or a
committed `og/*.png` — the dynamic route already handles the no-JS crawler
correctly. Edits to the card go in `app.py` (`_share_card_png`, `share_preview`,
`_forecast_summary`), gated by `snowforcast-change-control`.

---

## Self-contained / asset realities

- **Fonts are repo-bundled, not from a CDN.** `_font()` loads
  `fonts/DejaVuSans[-Bold].ttf` first (`app.py:339-344`) so the card renders
  deterministically on Vercel/Lambda. Do **not** add a Google-Fonts/CDN
  dependency for the card — it would break the serverless render and add a
  third-party availability risk. If you change the typeface, commit the `.ttf`
  into `fonts/` and load it the same way.
- **`og:image` must stay a same-origin absolute URL.** It is built from
  `request.url_root`, so it always matches the origin serving the page. Do not
  point it at an external CDN — a link you hand to friends must not depend on a
  third party that can rate-limit or disappear.
- **`data:` URIs do not work for `og:image`.** Crawlers need a fetchable
  `https://` URL — which the `/share-card/…png` route provides. (Inline `data:`
  embedding is only relevant to Claude *Artifact* previews, not a WhatsApp OG
  card — don't conflate the two.)

---

## Ship checklist (before changing the share card / route)

- [ ] Copy passes all five Copy Standards (jargon-free, first-glance clear,
      stable tone, names the resort/scope, no false precision).
- [ ] Positioning passes honesty rules: **no** "skill-weighted / AI-weighted",
      **no** "calibrated confidence"; any range shown as a range.
- [ ] OG tags stay **server-rendered** by `share_preview` (never JS-injected into
      `forecast.html`).
- [ ] `og:image` stays an absolute same-origin `https://` URL, 1200×630, PNG,
      with `og:image:width/height` set. If you redesigned the card, **bump the
      `?v=` cache token**.
- [ ] Card keeps the `as of {updated}` stamp and derives every number from the
      live summary — **no placeholder number** can ship.
- [ ] Unknown/malformed resort still falls back to a **real** resort, not a fake
      value (`_safe_key` + Val-Thorens/top fallback preserved).
- [ ] PNG stays well under ~300 KB (`optimize=True`); re-check byte size after a
      redesign.
- [ ] Change routed through `snowforcast-change-control` (editing `app.py` /
      canonical serving) — not merged silently.
- [ ] Verified by pasting the real `/share/<resort>/<elevation>` link into a
      WhatsApp chat and eyeballing the preview (crawler behavior is not
      repo-verifiable).

---

## Provenance and maintenance

Everything below is re-verifiable with one command from the repo root. Re-run if
a claim feels stale. Date-stamped facts were true **2026-07-11**.

```bash
# The share routes exist in app.py (dynamic OG page + PNG card + SVG fallback):
grep -n "@app.route('/share" app.py
grep -n "def share_preview\|def share_card_png\|def _share_card_png\|def _forecast_summary" app.py

# vercel.json routes /forecast.html, /share, /share-card, /data, /api, catch-all -> app.py:
grep -n '"dest": "app.py"' vercel.json
grep -c '/og/' vercel.json                      # expect 0 — there is NO static /og route

# forecast.html has NO OG/Twitter tags and injects data via JS (why sharing is dynamic):
grep -ic 'og:\|twitter:' forecast.html          # expect 0
grep -n "raw.githubusercontent" forecast.html   # data still comes from GitHub raw

# Pillow is now a dependency and fonts are bundled (card renders on Vercel):
grep -in "pillow\|PIL" requirements.txt          # -> Pillow>=10.0.0
ls fonts/                                         # -> DejaVuSans.ttf, DejaVuSans-Bold.ttf

# Card is 1200x630 and OG image is cache-busted:
grep -n "W, H = 1200, 630\|share-card/.*\.png?v=" app.py

# Skill-weighting is DORMANT (so 'skill-weighted AI' copy is a lie):
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));c=d['Val-Thorens']['bot']['consensus'];print(c['skill_weights'], c['method'])"
# expect: None median

# The 9 resorts the copy must match:
python3 -c "import json;print(list(json.load(open('data/all-forecasts.json')).keys()))"

# Data refresh cadence (why a baked number goes stale) — 3-hourly:
grep -n "cron" .github/workflows/update-forecast.yml   # -> '0 */3 * * *'

# Live host is Vercel; the dynamic routes are up; GitHub Pages is NOT enabled:
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/forecast.html            # expect 200
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/share/Val-Thorens/top    # expect 200
curl -so /dev/null -w '%{http_code}\n' https://snowforcast.vercel.app/share-card/Val-Thorens/top.png  # expect 200
curl -so /dev/null -w '%{http_code}\n' https://avielj.github.io/snowforcast/forecast.html      # expect 404
```

**Known drift risks to re-check:**
- WhatsApp image size/format limits (300 KB, no SVG/WebP preview) are **external
  best practice, not repo-verified** — confirm by sharing the real link. The
  `.svg` route is a render-failure fallback, not the OG target.
- If you redesign `_share_card_png`, WhatsApp will keep serving the cached image
  unless the `og:image` `?v=` token is bumped (currently `?v=2`, `app.py:516`).
- `skill_weights` is `null` **today**; if the skill-weighting scheme is ever
  activated (see `snowforcast-forecast-skill-methodology`), revisit the
  honest-positioning ban on "skill-weighted" language.
- `forecast.html` is still committed as a file and served through
  `_serve_forecast_html` + `_enhance_forecast_html`; `forecast-dark.html` /
  `forecast-modern.html` / `forecast_new.html` remain **experiments** per
  `snowforcast-change-control`. Only the `app.py` serving path carries the share
  system — do not add OG tags to the static files.
- The live shared origin is **Vercel** (`snowforcast.vercel.app` → 200, verified
  2026-07-11); GitHub Pages (`avielj.github.io/snowforcast`) is documented but
  **not enabled** (→ 404). The `og:image`/`og:url` are built from
  `request.url_root`, so they follow whatever origin serves the request — no
  hardcoded host to drift.
