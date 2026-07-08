---
name: snowforcast-forecast-skill-methodology
description: >-
  ADVANCED research-methodology + proof toolkit for evaluating forecast SKILL
  (per-model accuracy) rigorously in the snowforcast dashboard. It explains the
  git-history replay scorer (forecast_skill.py), why its current output is
  degenerate (all MAE=0.0, weighting dormant), and how to design an experiment that
  truly discriminates model quality. Load when: running or reading
  forecast_skill.py, interpreting data/skill.json, asked "which model is most
  accurate / is the skill weighting real", designing a backtest/accuracy
  experiment, understanding an all-MAE-0 degenerate result, or reasoning about
  git-as-training-set. Do NOT load for the aspirational calibration /
  honest-uncertainty framing (use snowforcast-calibration-and-honest-uncertainty),
  for validating routine data correctness rather than accuracy research (use
  snowforcast-data-integrity-and-validation), or for the consensus math the weights
  feed (use snowforcast-consensus-and-model-reference).
---

# snowforcast Forecast-Skill Methodology & Proof Toolkit

**What this is.** A runbook for one narrow, ADVANCED question: *how accurate is
each forecast model, and can we trust a number that claims to measure it?* The
repo ships a scorer (`forecast_skill.py`) that tries to answer this by replaying
git history. This skill teaches you how it works, why its current output is
**degenerate and must not be believed**, and how to build an experiment that
would actually discriminate models.

**Read this first (the one-sentence truth):** as of 2026-07-08 the skill scores
are **all MAE = 0.0** and the skill weighting is **DORMANT** (off). Any claim of
the form "model X is more accurate" or "the consensus is skill-weighted" is
**false today** and must carry the proxy caveat below.

**Zero-context reader?** Definitions before you go further:

| Term | Plain meaning (in this repo) |
|------|------|
| **Lead / lead time** | How many days *ahead* a forecast was made. Lead 0 = the forecast for today, made today. Lead 2 = what we predicted for a day, 2 days before it arrived. |
| **Observation / ground truth** | What *actually happened*. This repo has **no measured snowfall**; it substitutes the lead-0 forecast as a *proxy* for truth. That substitution is the whole problem. |
| **MAE** | Mean Absolute Error. Average of \|prediction − observation\| over samples. Lower = better. Units here are cm of snowfall. |
| **Skill weight** | A per-model multiplier used to weight the consensus median. Formula: `weight = 1 / (MAE + 0.5)`. Lower error → higher weight. |
| **Replay / backtest** | Re-reading old committed data to see what we *had predicted* at the time, then grading it. |
| **Proxy truth** | Using one forecast to stand in for the real observation because you don't have the real observation. |

---

## 1. The mechanism: how `forecast_skill.py` scores models

`forecast_skill.py` (stdlib-only — `argparse`, `json`, `subprocess`,
`datetime`; **no network**, **no third-party packages**) exploits an accident of
this project's design: the 3-hourly bot commits `data/*.json` into git forever,
so **git history IS a time-series of past forecasts**.

The flow, per resort, mid elevation (`data/<resort>-mid.json`):

1. **Pick one commit per calendar day** over a window (`daily_commits`,
   `forecast_skill.py:39-49`). Uses `git log --since=<date> --format=%H %cI --
   <path>`, keeps the newest commit of each day.
2. **Extract that day's forecast** by replaying the file *as it existed at that
   commit*: `git show <hash>:data/<resort>-mid.json`, then read
   `extended.extended_forecast[]` (`load_extended`, `forecast_skill.py:52-56`).
   This is the load-bearing trick — `git show <hash>:<path>` reconstructs the
   file content at an arbitrary past commit **without checking anything out**.
3. **Compute lead** for each forecast day: `lead = forecast_date − commit_date`
   in days (`forecast_skill.py:74`).
4. **Split into observations vs predictions** (`forecast_skill.py:78-85`):
   - `lead == 0` → treat that day's `snowfall` as the **observation proxy** for
     that date (keep the latest commit's value).
   - `1 <= lead <= 3` (`MAX_LEAD_DAYS = 3`) → record each model's predicted
     snowfall. Models come from `day['snowfall_models']`, or fall back to
     `{'openmeteo_best_match': snowfall}` when the historical commit predates
     multi-model data.
5. **Score** (`forecast_skill.py:87-92`): for each model, `MAE = mean(|pred −
   observation[date]|)` over dates that have both. Emit only models with
   `>= MIN_SAMPLES (5)` samples: `{'mae': round(...,2), 'n': <count>}`.
6. **Write `data/skill.json`** (`forecast_skill.py:123-125`) keyed by resort →
   models → `{mae, n}`.

**How the score becomes a weight (a different file):** `forecast_skill.py` only
*writes* MAE. The weighting lives in **`multi_model.py`**, not
`generate_static_data.py`:

- `load_skill_weights(resort)` (`multi_model.py:195-214`) reads `data/skill.json`
  and computes `weight = round(1.0 / (mae + 0.5), 3)` for each model with
  `mae is not None and n >= 5`.
- **Gate:** `return weights if len(weights) >= 2 else {}` (`multi_model.py:214`).
  If fewer than **two** models are scored for a resort, it returns `{}` →
  neutral, i.e. the consensus is a **plain unweighted median**. This is why the
  weighting is called *dormant*.
- `apply_consensus(...)` uses those weights in `weighted_median`
  (`multi_model.py:217-240`); `generate_static_data.py:596` invokes the whole
  chain via `multi_model.enrich_extended_forecast(...)`. The emitted method
  string is `'skill-weighted median' if weights else 'median'`
  (`multi_model.py:309`).

> Note: the module docstring in `forecast_skill.py:12-13` says
> "generate_static_data.py then uses those MAEs to weight" — that is *loosely*
> true (generate_static_data drives it) but the actual weighting code is in
> `multi_model.py`. Trust the line numbers above over the docstring.

---

## 2. THE FATAL PROXY PROBLEM — always disclose this

**A model is scored against the day-of forecast, which is frequently the same
model (or a consensus that includes it). That is near-circular. It measures a
model against *itself*, not against reality.**

Why it is broken:

- There is **no measured snowfall** anywhere in this project. The "observation"
  at `lead == 0` is *still a forecast* — snow-forecast.com / Open-Meteo's
  prediction for that day, made that day.
- So MAE answers "how much did the forecast for date D *drift* between L days
  out and day-of?" — a **consistency / stability** metric, **not accuracy**. A
  model that is confidently, consistently wrong scores a perfect MAE of 0.
- When `snowfall_models` is absent in old commits, both the prediction *and* the
  observation collapse to the single `openmeteo_best_match` value → you are
  literally subtracting a number from itself.

**Evidence it is degenerate right now** (`data/skill.json`, generated
2026-07-08): every scored model is `openmeteo_best_match` with `"mae": 0.0` for
all 5 resorts that had enough history. Two reinforcing causes:

1. **Self-comparison** (above): only one model is present across most of the
   history window, so prediction == observation → error 0.
2. **Off-season zeros:** it is July. Snowfall is `0.0` on essentially every day
   and every model (verified in `data/cervinia-mid.json` extended forecast). `0
   − 0 = 0`. MAE is trivially 0 and carries **no information**.

Because only one model clears `n >= 5` per resort, the `len(weights) >= 2` gate
fails and weighting stays off. Even if it turned on, MAE=0 → `weight =
1/0.5 = 2.0` for every model → still a plain median. **The system is currently
incapable of preferring one model over another.**

**Mandatory caveat to attach to any skill/accuracy claim:**

> "Skill scores in this repo compare a model against the day-of forecast (a
> proxy for truth, often the model's own output), not against measured snowfall.
> They measure forecast *stability*, not *accuracy*. Current values are MAE=0.0
> (degenerate: single-model history + off-season zeros) and the weighting is
> dormant. True model discrimination requires observed-snowfall labels the
> project does not yet collect."

---

## 3. How to run it (and what valid vs degenerate output looks like)

**Prerequisites** (all matter — a violation silently corrupts results):

- **Full git history.** The scorer reads old commits. `actions/checkout` MUST
  use `fetch-depth: 0`. `update-skill.yml:19-21` sets this; a shallow clone
  would see only recent commits and silently under-sample.
- **`data/metadata.json`** present with a `resorts` list (drives the loop;
  currently 9 resorts).
- **Committed history of `data/<resort>-mid.json`** — the 3-hourly
  `update-forecast.yml` bot is what creates it.

**Run it locally (read-only to the network; WRITES `data/skill.json`):**

```bash
# from repo root, with full history
python3 forecast_skill.py --days 45
```

- `--days N` sets the lookback window (default 45). Larger N = more samples but
  reaches back before multi-model data existed (only `openmeteo_best_match`
  there).
- No other flags exist. It always overwrites `data/skill.json`.

> Caution: running it commits nothing, but it **overwrites `data/skill.json`**
> in your working tree. If you only want to *inspect* behavior without touching
> the tracked file, copy the repo or redirect: run it in a throwaway checkout,
> or read the existing `data/skill.json` instead. Do not commit a locally
> regenerated skill.json casually — the weekly Action owns that file.

**Automation:** `update-skill.yml` runs it **weekly** (`cron: '0 3 * * 1'`,
Monday 03:00 UTC) or on manual `workflow_dispatch`, then commits `data/skill.json`
if it changed. This is **separate** from the 3-hourly `update-forecast.yml` that
refreshes the forecast data itself.

**Reading the result:**

| Output pattern | Verdict |
|---|---|
| Every model `mae == 0.0` | **DEGENERATE.** Self-comparison and/or off-season zeros. No information. Do not weight. (This is today's state.) |
| Only `openmeteo_best_match` scored per resort | **Immature.** History predates multi-model data; weighting correctly stays off (`len(weights) < 2`). |
| `>= 2` models, non-zero spread of MAE, `n` well above 5 | **Candidate-valid** *for stability* — but **still not accuracy** until the observation is real snowfall (Section 4). |
| A resort missing entirely | Not enough history yet (fewer than 5 samples), or its `-mid.json` was never committed. |

**Degenerate-case detector (paste-ready):**

```bash
# Flags the all-MAE-0 / single-model degenerate state programmatically.
python3 - <<'PY'
import json
s = json.load(open('data/skill.json'))
rows = [(r, m, st['mae'], st['n'])
        for r, rv in s.get('resorts', {}).items()
        for m, st in rv.get('models', {}).items()]
maes = [mae for *_, mae, _ in rows]
models = {m for _, m, *_ in rows}
all_zero = bool(maes) and all(mae == 0.0 for mae in maes)
single_model = len(models) <= 1
print(f"rows={len(rows)} distinct_models={sorted(models)}")
print(f"ALL_MAE_ZERO={all_zero}  SINGLE_MODEL_ONLY={single_model}")
if all_zero or single_model:
    print("VERDICT: DEGENERATE — do NOT trust these scores; weighting is dormant.")
else:
    print("VERDICT: non-degenerate stability scores (still NOT accuracy — see proxy caveat).")
PY
```

---

## 4. Designing an experiment that actually discriminates models

The proxy problem is not a bug to patch inside `forecast_skill.py` — it is a
**missing ingredient**: real observations. Fixing it is a data-collection
project. Design principles:

**a) Get a real ground truth.** You need *observed* snowfall per resort per day
from a source **independent of the models being graded** — e.g. a resort's own
reported new-snow, a station/SNOTEL-style measurement, or a webcam-derived
depth. Store it as its own labelled series (candidate field, e.g.
`observed_snowfall`, in a separate observations file). Until this exists, MAE
measures drift, not accuracy — full stop.

**b) Never grade a model against itself or against a single source.** With real
observations, the observation must come from a *different* pipeline than any
predicted model. Grading `openmeteo_best_match` against an Open-Meteo-derived
"truth" reintroduces circularity.

**c) Keep per-model histories separated.** The scorer already collects
per-model predictions (`snowfall_models`), which is correct. The design keeps
weighting **off until `>= 2` models each have `n >= 5`** (`multi_model.py:210,
214`). Respect this: a lone scored model would be *double-counted* (it would
weight the median toward itself with nothing to balance it). Do not lower the
`>= 2` gate to make weighting "turn on" — that manufactures false confidence.

**d) Discriminate, don't self-confirm.** A valid experiment must be able to
produce **different** MAEs for different models on the *same* observations. If
your setup can only ever return equal/zero MAE (e.g. because prediction and
observation share a source, or because it is off-season and everything is 0),
it cannot discriminate — reject it before drawing conclusions.

**e) Sample where there is signal.** Snowfall is zero-inflated (most days,
especially summer, are 0). An all-zero window makes every model look perfect.
Weight the evaluation toward **precipitating days**, or report MAE conditioned
on observed snowfall > 0, so a model that misses real storms is penalized.

**f) Account for lead time honestly.** Accuracy degrades with lead. Report MAE
per lead (1, 2, 3 days) rather than pooling, so "model X is good at 1 day but
bad at 3" is visible. The current code pools all 1-3 day leads into one MAE
(`forecast_skill.py:81-85`) — a candidate refinement, not a shipped feature.

**Traps to avoid** (each is a way to accidentally measure a model against
itself):

| Trap | Why it fails |
|---|---|
| Day-of forecast as "truth" | The current proxy. Circular. |
| Single data source for pred + obs | Subtracting a value from itself. |
| Off-season / zero-inflated window | Trivial MAE=0; no discrimination. |
| Turning weighting on with 1 model | Double-counts that model into its own weight. |
| Pooling all leads | Hides where a model actually breaks. |

---

## 5. Analysis hygiene & the git-as-training-set dependency

- **Detect the degenerate case programmatically** before trusting any weight —
  run the detector in Section 3 in CI or before quoting scores. Treat
  `ALL_MAE_ZERO` or `SINGLE_MODEL_ONLY` as a hard stop.
- **History pruning would silently invalidate every score.** The entire method
  depends on the 3-hourly bot commits remaining in git history. If anyone
  squashes, rebases, `git filter-repo`s, shallow-clones without `fetch-depth:
  0`, or garbage-collects old `Update forecast data` commits, the replay loses
  its "training set" and MAEs quietly change or vanish with **no error raised**.
  Before touching history or CI checkout depth, understand this dependency (and
  see `snowforcast-change-control` — history is effectively load-bearing data).
- **`skill.json` is derived, not authored.** Do not hand-edit it to "turn on"
  weighting. The only legitimate writer is `forecast_skill.py` via
  `update-skill.yml`.
- **A green Action means it ran, not that the score is meaningful.**
  `update-skill.yml` succeeds and commits `MAE=0.0` happily. CI green ≠ correct
  skill (same lesson as the scraper: see
  `snowforcast-scraper-resilience-campaign`).

---

## 6. Proof / sanity toolkit — validate a computation before trusting weights

The project has **no test framework**. `test_openmeteo.py` and
`test_vt_scrape.py` are **manual network probes** (both `import requests`; the
first hits `api.open-meteo.com`, the second scrapes snow-forecast.com), not a
suite. Treat them as *ad-hoc validation scripts you run by hand* — the same
posture you should take toward skill computations. Minimal checks before you
believe any weight:

**Check 1 — Does the replay see real history?**
```bash
# One commit per day should exist for a resort's mid file over the window.
git log --since=45.days --format='%cI' -- data/cervinia-mid.json | cut -c1-10 | sort -u | wc -l
```
Few/zero distinct days → shallow clone or pruned history → scores are invalid.

**Check 2 — Is the observation actually independent of the prediction?**
```bash
# Do old commits carry multiple models, or just the openmeteo fallback?
git show HEAD:data/cervinia-mid.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
    ex=d['extended']['extended_forecast']; \
    print('models on day0:', sorted((ex[0].get('snowfall_models') or {}).keys()))"
```
Only `openmeteo_best_match` → prediction and proxy-observation share a source →
self-comparison.

**Check 3 — Is there any signal, or is it all zeros?**
```bash
git show HEAD:data/cervinia-mid.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
    v=[x.get('snowfall') for x in d['extended']['extended_forecast']]; \
    print('nonzero snowfall days:', sum(1 for x in v if x), 'of', len(v))"
```
Zero nonzero days → any MAE is meaningless (off-season / no storms).

**Check 4 — Reproduce one MAE by hand.** Pick a model with `n >= 5` in
`skill.json`, manually pull a couple of `(prediction, observation)` pairs via
`git show <old-hash>:<path>` vs `git show <recent-hash>:<path>`, and confirm the
MAE the code reports matches your by-hand average. If it does not, the sampling
or lead computation is off — do not trust the file.

**Rule of thumb:** a weight is only trustworthy when Checks 1-3 all pass
(multi-day history, `>= 2` independent models, nonzero-snow signal) **and** the
observation is real measured snowfall (Section 4). Today none of that holds, so
the correct action is to leave weighting **dormant** and quote the proxy caveat.

---

## When NOT to use this skill

| You actually want... | Use instead |
|---|---|
| The aspirational calibration goal / honest-uncertainty framing (well-calibrated ranges, "how much to trust each number") | `snowforcast-calibration-and-honest-uncertainty` |
| To validate routine data correctness (is today's JSON right?), not accuracy research | `snowforcast-data-integrity-and-validation` |
| The consensus math the weights feed (median, snowfall_range, what each model is) | `snowforcast-consensus-and-model-reference` |
| Rules that gate any edit to scraper/data/front-end | `snowforcast-change-control` |
| Why the pipeline/JSON contract is shaped this way | `snowforcast-architecture-contract` |
| Whether a dead end was already tried | `snowforcast-failure-archaeology` |

This skill does not authorize changes to `data/skill.json`, the workflows, or
git history — route those through `snowforcast-change-control`.

---

## Provenance and maintenance

Verified against the repo on **2026-07-08**. Re-verify volatile facts with:

```bash
# Scorer mechanism (git-replay, lead split, MAE) — lines cited in this skill:
sed -n '38,92p' forecast_skill.py

# Weighting formula + the ">=2 models" dormancy gate:
sed -n '195,214p' multi_model.py

# Current skill.json state (expect MAE=0.0 / single model → degenerate as of 2026-07-08):
python3 - <<'PY'
import json; s=json.load(open('data/skill.json'))
print('generated:', s['generated'])
for r,rv in s['resorts'].items():
    for m,st in rv['models'].items(): print(r,m,st)
PY

# Weekly automation + fetch-depth:0 requirement:
sed -n '1,38p' .github/workflows/update-skill.yml

# forecast_skill.py is stdlib-only / no network (expect argparse,json,subprocess,datetime):
grep -nE '^(import|from) ' forecast_skill.py

# The "tests" are manual network probes, not a suite:
grep -nE 'import requests|BeautifulSoup|open-meteo|snow-forecast' test_openmeteo.py test_vt_scrape.py
```

Facts most likely to drift: the resort list in `data/metadata.json` (9 as of
this date); the MAE=0.0 degenerate state (will change once multi-model history
exceeds the 45-day window AND the season has real snow — re-run the Section 3
detector); the `--days 45` default; line numbers if the files are edited.
Anything in Section 4 (real observations, per-lead MAE) is **open/candidate**,
not implemented.
