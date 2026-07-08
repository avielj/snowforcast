---
name: snowforcast-change-control
description: >-
  The non-negotiable rules that gate EVERY change to the snowforcast ski-forecast
  dashboard, each tied to the incident that created it. READ THIS FIRST before
  editing the scraper (generate_static_data.py / app.py / snow_forecast_parser.py /
  enhanced_snow_forecast_parser.py), the data contract (data/all-forecasts.json),
  or any front-end HTML (forecast.html, forecast_new.html). Load when the task
  touches: scraping, forecast JSON fields, fallback/default values, missing-data
  handling, secrets/API keys, which HTML page is "real", Vercel/app.py, or the
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
in Open-Meteo model data, and writes `data/all-forecasts.json`. Two static HTML
pages fetch that JSON straight from GitHub raw and render it. A cron GitHub Action
re-scrapes every 3 hours and commits the result. Audience: the owner and ski
buddies planning trips over WhatsApp — **no meteorology background assumed.**

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
  `'Val-Thorens': {'bot': 2300, 'mid': 2800, 'top': 3230}` (as of 2026-07-08,
  `generate_static_data.py:485`). Per-resort elevations must come from that
  resort's own config, never a shared default.

- **`fill_missing_days_from_openmeteo` fabricates data that is indistinguishable
  from scraped data.** In `generate_static_data.py` (verified 2026-07-08, function
  at line ~364), when a scraped forecast is short on days, the code synthesizes
  extra days from Open-Meteo daily averages and INVENTS wind, feels-like, and the
  AM/PM/Night snow split, landing them in the same fields as real scraped values
  with **no marker**. That is exactly the failure mode this rule forbids.

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
   *additive* change — allowed under Rule 2.
3. The existing `fill_missing_days_from_openmeteo` output is a **known,
   pre-existing violation** — do not copy its pattern, and if you touch that
   function, add the missing labels rather than extending the unlabeled fabrication.

> Cross-ref: `snowforcast-data-integrity-and-validation` is how you *measure*
> that data is real vs fabricated. `snowforcast-failure-archaeology` has the full
> 2300 m narrative. This skill only states the rule.

---

## Rule 1 — `data/all-forecasts.json` is a FROZEN DEPLOYED CONTRACT

Both live front-ends fetch it directly from GitHub raw, **not** from `app.py`:

```
https://raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/data/all-forecasts.json
```

Verified 2026-07-08: this exact URL appears in `forecast.html:961` and
`forecast_new.html:919`.

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
`grep -o 'snowfall_range\|snowfall_models\|snowfall_sources' data/all-forecasts.json | sort -u`
(432 occurrences each as of 2026-07-08), plus an additive `"extended"` block.
Follow that pattern for any new field.

---

## Rule 2 — Only TWO HTML files are canonical

| File | Status | Evidence |
|---|---|---|
| `forecast.html` | **CANONICAL** — the `index.html` redirect target + a `vercel.json` static build | `index.html` redirects `window.location.href = 'forecast.html'`; `forecast.html` is a `@vercel/static` build in `vercel.json` |
| `forecast_new.html` | **CANONICAL alternate** — dark theme, linked from `forecast.html`, fetches the same JSON | `forecast.html:948` links `forecast_new.html`; both fetch the same raw URL |
| `forecast-dark.html` | EXPERIMENT | — |
| `forecast-dark2.html` | EXPERIMENT | — |
| `forecast-modern.html` | EXPERIMENT | — |
| `comprehensive.html` | EXPERIMENT | — |
| `index-static.html` | EXPERIMENT (broken: `link rel=stylesheet href="forecast.html"`) | — |

> Note: `vercel.json` also lists `forecast-dark.html` and `forecast-modern.html`
> as static builds, but the owner's canonical set is **only** `forecast.html` +
> `forecast_new.html`. Treat the others as experiments regardless of their
> presence in `vercel.json`.

**The rule: never edit an experiment assuming it ships.** If you change UI
behavior, change it in `forecast.html` (and `forecast_new.html` if the change
applies to the alternate). Do not "fix" `forecast-modern.html` and expect users
to see it.

> Cross-ref: `snowforcast-frontend-ui-contract` for how the canonical pages fetch
> and render, and the rendering fragility to avoid.

---

## Rule 3 — Secrets are env-only. Never hardcode a fallback secret.

**The rule:** all secrets come from the environment (`os.environ`) or a
gitignored `.env`. Verified 2026-07-08: `.env` and `.env.local` are in
`.gitignore`; key reads use `os.environ.get('OPENWEATHER_API_KEY')`
(`app.py:30`, `openweather_integration.py:16`, `generate_static_data.py:524`).
**Never** write a literal key as a default/fallback, e.g.
`key = os.environ.get('X') or 'abc123'` — that defeats the whole point.

**Why (incident):** a Weather Unlocked key and `app_id` (values REDACTED — never
copy a live secret into a skill file) were hardcoded and committed. They were
removed from HEAD, but **remain recoverable in git history** — verify by SHA,
without echoing the secret:
`git show d65ce5a2:weatherunlocked_integration.py | grep -iE 'app_id|app_key'`
(the add is `d65ce5a2`, the removal `bfff7287`; confirmed 2026-07-08). Because the
secret is in history, treat that key/app_id as **compromised — rotate, never
reuse.**

**Corrective control to preserve:** commit `bfff7287` added the guard
`if not self.app_id or not self.app_key:` (verified present in that commit's
diff) so a missing secret fails cleanly instead of falling back to a baked-in
value. Weather Unlocked was later removed entirely in `06121221`; if you
reintroduce any keyed API, reproduce that guard pattern.

> Cross-ref: `snowforcast-build-deploy-and-operations` for how env/secrets are
> configured and set locally and on Vercel.

---

## Rule 4 — A green data-refresh Action does NOT mean the data is correct

**There is NO code/test/lint/type CI gate in this repo.** The only automation is
a cron that commits whatever it scrapes.

Verified 2026-07-08 (`.github/workflows/`):

- `update-forecast.yml` — `cron: '0 */3 * * *'` (every 3 hours), runs
  `python3 generate_static_data.py`, then
  `git ... || (git commit -m "Update forecast data - $(date -u)" && git push)`.
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

## Rule 5 — `app.py` (Flask/Vercel) is SECONDARY. Do not "fix the site" by editing it.

**The rule:** the static pages do **not** depend on `app.py`. Production is the
**committed-JSON-from-GitHub-raw path** (Rule 1). `app.py` is the Vercel dynamic
route (`/api/*` and catch-all in `vercel.json`), but the canonical front-ends
never call it — they hit `raw.githubusercontent.com` directly.

So: if the live site shows wrong/stale data, the fix is almost never in `app.py`.
The likely culprits are the scraper (`generate_static_data.py`, the CI script) or
the JSON contract. Changing `app.py` will *look* like a fix locally and change
**nothing** for users on the static pages.

> Note: `app.py` contains its own copy of the fragile scraper
> (`forecast-table__table` at `app.py:173`) — one of four near-duplicate parsers.
> See `snowforcast-scraper-resilience-campaign` for keeping all four in sync.

---

## Pre-flight checklist (run before you edit)

- [ ] Am I about to add a default / fallback / "if missing, use X"? → **STOP.**
      Rule 0. Fail loud or label synthetic instead.
- [ ] Am I changing a field name/path/type in `all-forecasts.json`? → **STOP.**
      Rule 1. Additive only.
- [ ] Am I editing an HTML file that is not `forecast.html` or
      `forecast_new.html`? → It's an experiment. Rule 2.
- [ ] Am I about to write a literal API key/secret anywhere? → **STOP.** Rule 3.
      Env-only.
- [ ] Am I trusting a green Action as proof the data is right? → Rule 4. Inspect
      the JSON yourself.
- [ ] Am I "fixing the site" by editing `app.py`? → Rule 5. Wrong layer.

## When NOT to use this skill

- You want to understand **why** something broke, with evidence and status →
  `snowforcast-failure-archaeology`.
- You want the **design rationale / invariant mechanics** behind these rules →
  `snowforcast-architecture-contract`.
- You are triaging a **live symptom** right now → `snowforcast-debugging-playbook`.
- The scraper is **actually broken** and you need to repair selectors →
  `snowforcast-scraper-resilience-campaign`.

This skill is only the enforceable rules plus a one-line incident anchor each.
Keep narratives, design, and repair procedures in their home skills.

---

## Provenance and maintenance

All facts verified against the working tree on **2026-07-08** (HEAD `06121221`).
Re-verify anything volatile with:

```bash
# Rule 0 — fabrication / defaults still present?
sed -n '360,452p' generate_static_data.py        # fill_missing_days fabrication block (exact constants catalogued in data-integrity PART A)
grep -n "2300" generate_static_data.py           # per-resort elevation config (~:485)

# Rule 1 — frozen JSON URL + additive consensus fields present
grep -n "raw.githubusercontent.com" forecast.html forecast_new.html
grep -o 'snowfall_range\|snowfall_models\|snowfall_sources' data/all-forecasts.json | sort -u

# Rule 2 — canonical HTML wiring
grep -n "forecast.html" index.html               # redirect target
grep -n "forecast_new.html" forecast.html         # alternate link
grep -n "@vercel/static" vercel.json

# Rule 3 — secrets env-only + history leak + guard
cat .gitignore | grep -n "\.env"
grep -rn "os.environ.get('OPENWEATHER_API_KEY')" *.py
git show d65ce5a2:weatherunlocked_integration.py | grep -iE 'app_id|app_key'  # secret add (removed in bfff7287)
git show bfff7287 | grep "if not self.app_id or not self.app_key"

# Rule 4 — only cron automation, no test/lint gate
ls .github/workflows/
grep -n "cron\|python3\|git commit" .github/workflows/update-forecast.yml

# Rule 5 — app.py is the dynamic route, front-ends hit raw directly
grep -n "app.py\|@vercel" vercel.json
grep -n "forecast-table__table" app.py
```

If any of these drift (line numbers move, fields change, URLs differ), update the
corresponding rule here and re-date it. Line numbers are the most likely to drift;
the *rules* should not.
