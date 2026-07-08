---
name: snowforcast-consensus-and-model-reference
description: >-
  The domain theory of the snowforcast dashboard's multi-model snowfall consensus
  as implemented: what the 6+1 model sources are, how they blend into a (currently
  plain, unweighted) median, and how model spread becomes snowfall_range + ensemble
  p10/p90. Load when reasoning about the numbers on the site: what "consensus" /
  "snowfall_range" / "snowfall_models" / "snowfall_sources" mean, why a day shows a
  range, whether the product is "skill-weighted" (it is NOT today), or how
  multi_model.py combines models. Do NOT load to explain these to non-meteorologist
  ski buddies (use snowforcast-meteorology-for-laypeople), for the open
  calibration-vs-real-snow question (use
  snowforcast-calibration-and-honest-uncertainty), or for HOW skill is scored by
  git-replay (use snowforcast-forecast-skill-methodology).
---

# snowforcast Consensus & Model Reference

The domain theory of multi-model snowfall consensus **as this repo actually
implements it** — not textbook meteorology. Read this to reason correctly about
the numbers the site shows before you touch `multi_model.py`, `forecast_skill.py`,
or any consensus field in the JSON.

**This is a reference, not a rules gate.** Do not change the scraper, the JSON
contract, or the front-end based on what you read here without first clearing
`snowforcast-change-control` (the rules gate) and `snowforcast-architecture-contract`
(why the system is shaped this way). This skill never routes around those.

**Scope boundary — read the sibling instead when:**

| You want to… | Read instead |
|---|---|
| Explain "median" / "AROME" / "p90" to ski buddies over WhatsApp | `snowforcast-meteorology-for-laypeople` |
| Reason about whether ranges are *truly calibrated* against real snow | `snowforcast-calibration-and-honest-uncertainty` |
| Understand HOW model skill is scored (git-replay, proxy truth) | `snowforcast-forecast-skill-methodology` |
| Know what you may not change | `snowforcast-change-control` |
| Understand why the pipeline is shaped this way | `snowforcast-architecture-contract` |

All line numbers below are against the repo state on **2026-07-08**. Re-verify with
the commands in "Provenance and maintenance" if the files have moved.

---

## The honest headline (read this first)

The docstrings, the `consensus.method` field, and casual conversation all say
**"skill-weighted median."** As shipped **today (2026-07-08) the consensus is a
plain, unweighted median.** The skill-weighting machinery is fully written but
**dormant** — no resort currently qualifies for weights (see
[Why weighting is dormant](#why-skill-weighting-is-dormant-today)).

**Rule for user-facing wording:** do NOT describe the product as "skill-weighted"
without this caveat. Say "median of several models," or "skill-weighting is built
but not yet active." Overstating this is exactly the kind of overclaim
`snowforcast-calibration-and-honest-uncertainty` exists to prevent.

---

## The 6 sources (+ ensemble) — what each one is

The consensus for one resort-elevation-day combines up to **7 independent
snowfall values**. All are keyed by the internal id used in
`snowfall_models` in the JSON.

| id in `snowfall_models` | What it is | Category | Where it comes from |
|---|---|---|---|
| `openmeteo_best_match` | Open-Meteo's default "best match" forecast — the base extended forecast already fetched for the day | Single NWP (auto-picked model blend) | The pre-existing `day['snowfall']` on the extended forecast (`multi_model.py:227`), originally `snowfall_sum` from the standard Open-Meteo `/v1/forecast` endpoint |
| `meteofrance_seamless` | Météo-France **AROME/ARPEGE** seamless product | NWP model (national — France) | Open-Meteo multi-model endpoint (`FORECAST_MODELS`, `multi_model.py:27`) |
| `icon_seamless` | DWD **ICON** seamless product | NWP model (national — Germany) | same multi-model endpoint |
| `ecmwf_ifs025` | **ECMWF IFS** 0.25° | NWP model (European centre) | same multi-model endpoint |
| `gfs_seamless` | NOAA **GFS** seamless product | NWP model (USA) | same multi-model endpoint |
| `met_norway` | **MET Norway** (`api.met.no`) post-processed public forecast, no API key | National service (independent, post-processed) | `fetch_met_norway_daily`, `multi_model.py:120` |
| `ensemble_median` | Median of the GFS **ensemble** members (perturbed runs) | Ensemble (spread of one model) | `fetch_ensemble_daily` from Open-Meteo ensemble API, `multi_model.py:71` |

Definitions of the jargon, used exactly as this repo uses them:

- **NWP model** = Numerical Weather Prediction model. A single deterministic
  physics run. AROME, ICON, ECMWF IFS, GFS are all NWP models. They are the
  *independent opinions* that make a median meaningful.
- **Seamless** = Open-Meteo's stitched product that splices a provider's
  high-resolution short-range model into its coarser long-range model so one
  series covers the whole horizon. `meteofrance_seamless` etc. are these.
- **Ensemble** = many slightly-perturbed runs of the *same* model to sample
  uncertainty. Here it is the **GFS** ensemble only (`ENSEMBLE_MODEL =
  'gfs_seamless'`, `multi_model.py:28`). Its median is one input value; its
  p10/p90 feed the uncertainty range (below).
- **National service** = a met agency's own published forecast. MET Norway is the
  one used here; it is independent of Open-Meteo, which is why it is valuable as a
  cross-check even though its snow number is crudely derived (see the caveat).

> Note: `openmeteo_best_match` is a single auto-selected blend, and the four
> `*_seamless`/`ifs025` models are the raw components. Treat "best_match" as
> *another opinion*, not as an average of the others.

---

## How the blend works (`apply_consensus`, `multi_model.py:217-269`)

For each day in the extended forecast:

1. **Collect values.** Build `model_values` = `{id: snowfall_cm}` from
   `openmeteo_best_match` (the base value) + each multi-model value present +
   `met_norway` (if present) + `ensemble_median` (if present). Missing sources are
   simply absent — nothing is fabricated. (`multi_model.py:227-234`)
2. **Guard: need ≥2 sources.** Build `pairs = [(value, weight)]` over non-null
   values. `if len(pairs) < 2: continue` — **a day with only one source gets NO
   consensus at all** (no `snowfall_range`, no override). (`multi_model.py:236-239`)
   See [the ≥2 guards](#the-2-guards-a-lone-source-is-never-a-consensus).
3. **Combine.** `consensus = weighted_median(pairs)`. With the shipped dormant
   weights every weight is `1.0`, so this is a **plain median**. (`multi_model.py:240`)
4. **Overwrite `snowfall`** with `round(consensus, 1)`. The consensus median
   *replaces* the day's headline snowfall number. (`multi_model.py:247`)
5. **Emit the extra fields** — see [the JSON contract](#how-consensus-maps-into-the-frozen-json-contract).
6. **Temperature** gets its own plain-median consensus (no range shown in UI),
   `multi_model.py:252-267`.

`weighted_median` (`multi_model.py:181-192`) is a true weighted median: sort by
value, walk cumulative weight, return the value where cumulative weight first
reaches half the total. With equal weights this returns the ordinary median.

---

## Uncertainty outputs — the honest-uncertainty signal

Two things carry "how much to trust this number." Both are plainly the **spread of
model disagreement** — min/max across the source values, widened by ensemble
percentiles. It is an honest signal of *how much the models disagree*, but it is
**uncalibrated**: not a validated confidence interval against observed snow, and
**not** "beyond state of the art." Selling model disagreement as trustworthy
confidence is exactly the overclaim `snowforcast-calibration-and-honest-uncertainty`
guards against (calibration there is an explicitly **open** problem):

### `snowfall_range` = model spread (disagreement)

`low, high = min(values), max(values)` across the collected sources
(`multi_model.py:241-242`). If the ensemble is present, the range is **widened**
to also cover the ensemble tails: `low = min(low, ens['p10'])`,
`high = max(high, ens['p90'])` (`multi_model.py:243-245`). Stored as
`snowfall_range: [low, high]`.

Interpretation: **a wide range means the models disagree** (or the ensemble is
spread), i.e. lower confidence. A tight range means they agree. This is the
honest-uncertainty signal — surface it, do not hide it.

### Ensemble p10 / p90

From `fetch_ensemble_daily` (`multi_model.py:107-116`): for each day, sum each
member's hourly snowfall to a daily total, then take the 10th/50th/90th
percentiles across members. p50 becomes `ensemble_median` (an input value); p10
and p90 widen `snowfall_range`.

### ⚠ The MET Norway caveat that can widen the range misleadingly

MET Norway has no direct snowfall field here. `fetch_met_norway_daily` estimates
it crudely (`multi_model.py:143-147`):

```python
snow_cm = 0.0
if 'snow' in symbol:
    snow_cm = precip          # 1mm water equivalent ~ 1cm snow
elif 'sleet' in symbol:
    snow_cm = precip * 0.5
```

The **`1mm water ≈ 1cm snow`** heuristic is a fixed 10:1 ratio and is only a rough
rule of thumb — real snow-to-liquid ratios range from ~6:1 (heavy wet snow) to
~20:1+ (cold dry powder). So the `met_norway` value can be systematically off in
either direction. Because `snowfall_range` is `min..max` over sources, **a single
off MET Norway value can stretch the range in a way that looks like real model
disagreement but is really just this heuristic.** When a range looks
suspiciously wide, check `snowfall_models['met_norway']` first — it is the usual
suspect. (This is a known-weak point; do not "fix" the ratio without reading
`snowfall-change-control` and `snowforcast-architecture-contract`.)

---

## The ≥2 guards — a lone source is never a consensus

Two separate guards, for two separate reasons. Do not remove either.

| Guard | Where | What it blocks | Why |
|---|---|---|---|
| **≥2 sources per day** | `apply_consensus`, `multi_model.py:237-238` (`if len(pairs) < 2: continue`) | Producing a "consensus" from a single available model on a given day | A single value is not a consensus and has no spread; a median/range of one number is meaningless and would fabricate false confidence. The day keeps its original single-source `snowfall` with no range. |
| **≥2 scored models (each n≥5)** | `load_skill_weights`, `multi_model.py:210,214` | Activating skill weights when fewer than two models have a track record | With one scored model, `weighted_median` would just double-count it (its weight dominates), which is worse than an equal-weight median. Returns `{}` → plain median. Also requires `n >= 5` samples per model before trusting its MAE. |

Bottom line: **a lone source is never trusted as consensus, and a lone scored
model never gets to steer the weights.** Both collapse gracefully to "use what we
have as a plain median" rather than inventing confidence.

---

## Why skill-weighting is dormant today

The intent (`load_skill_weights`, `multi_model.py:195-214`): weight each model by
`weight = 1 / (MAE + 0.5)` where MAE (mean absolute error, in cm) comes from
`data/skill.json`. Lower error → higher weight. The `+0.5` keeps weights finite
when MAE is ~0.

It is dormant because of **what `skill.json` currently contains**. As of
2026-07-08 the file scores **only `openmeteo_best_match`** for a handful of
resorts, all with `mae: 0.0`:

```json
"Val-Thorens": { "models": { "openmeteo_best_match": { "mae": 0.0, "n": 18 } } }
```

Two consequences, both by design:

1. `load_skill_weights` requires **≥2 models with `n >= 5`** (`multi_model.py:210,214`).
   Only one model is scored, so it returns `{}`.
2. `{}` → `apply_consensus` uses `weights.get(m, 1.0)` = every weight `1.0` →
   plain median. And `enrich_extended_forecast` sets
   `consensus.method = 'median'` and `consensus.skill_weights = null`
   (`multi_model.py:308-315`).

Verified in the shipped data: every `consensus` block in
`data/all-forecasts.json` has `"method": "median"` and `"skill_weights": null`.

> The `mae: 0.0` values are a *self-comparison artifact*: `forecast_skill.py`
> scores forecasts against the **day-of forecast as a proxy for observed snow**,
> and for `openmeteo_best_match` that proxy is essentially the same series, so the
> error collapses to ~0. This is exactly the proxy-truth pitfall — the detail of
> HOW that scoring works and why it is not real skill lives in
> `snowforcast-forecast-skill-methodology`; the "we don't yet have observed-snow
> labels" honesty lives in `snowforcast-calibration-and-honest-uncertainty`. Do
> not treat these MAEs as evidence the models are perfect.

`skill.json` is regenerated by the `update-skill.yml` GitHub Action
(`python3 forecast_skill.py --days 45`), so it will change on its own. Weighting
switches ON automatically only once ≥2 models each accumulate ≥5 scored samples —
which requires per-model history that only starts accruing from the first
multi-model commit. **Do not hard-code weights on or assume they are active.**

---

## How consensus maps into the frozen JSON contract

`data/all-forecasts.json` is a **frozen deployed contract** — both front-ends
fetch it directly from GitHub raw (see `snowforcast-change-control`). The
consensus fields were added **additively** and must stay additive: you may add new
fields, but existing paths must never change or disappear.

Two additive shapes:

**Per extended-forecast day** (added by `apply_consensus`, `multi_model.py:247-250`):

| Field | Type | Meaning |
|---|---|---|
| `snowfall` | number (cm) | **Overwritten** with the consensus median (was single-model) |
| `snowfall_range` | `[low, high]` cm | Model spread, widened by ensemble p10/p90 |
| `snowfall_sources` | int | How many independent values backed this day (= `len(pairs)`, always ≥2 when present) |
| `snowfall_models` | `{id: cm}` | Per-model values for transparency and skill scoring |

**Per resort-elevation node** (added by `enrich_extended_forecast`,
`multi_model.py:308-315`), under key `consensus`:

```json
"consensus": {
  "method": "median",              // or "skill-weighted median" when weights active
  "models": ["openmeteo_best_match", "meteofrance_seamless", "icon_seamless",
             "ecmwf_ifs025", "gfs_seamless", "met_norway", "ensemble_median"],
  "skill_weights": null,           // the weights dict, or null when dormant
  "generated": "2026-07-06T13:16:01"
}
```

Consumers reasoning about these fields:
- **A day may legitimately have NO consensus fields** (the ≥2-source guard, or all
  extra fetches failed). Front-ends must fall back to plain `snowfall` and not
  assume `snowfall_range` exists.
- `snowfall_sources` tells you how much the median is backed by. `< 2` cannot
  occur when the fields are present.
- `snowfall_models` is the ground truth for "why is the range this wide" — inspect
  it (especially `met_norway`).

Additive-only, no exceptions: adding a field is fine; renaming/removing
`snowfall`, `snowfall_range`, `snowfall_models`, `snowfall_sources`, or `consensus`
breaks the live page silently. That is a `snowforcast-change-control` matter.

---

## Graceful degradation (why numbers can be "thinner" some runs)

`enrich_extended_forecast` (`multi_model.py:272-316`) wraps each of the three
extra fetches (multi-model, ensemble, MET Norway) in its own try/except. Any one
failing prints a `⚠` and is simply omitted — the run continues with the remaining
sources. If **all three** fail, the day keeps its original single-model
`openmeteo_best_match` snowfall and gets no consensus fields. This is the correct
fail-soft behaviour: fewer sources, never fabricated ones. A green data-refresh
Action does **not** guarantee all sources were present — check `snowfall_sources`
and the `⚠` lines in logs.

---

## Quick reasoning checklist

Before you state anything about the numbers:

- [ ] Is it "skill-weighted"? **No, not today** — plain median (`skill_weights: null`).
- [ ] Does this day even have a consensus? Check for `snowfall_range` /
      `snowfall_sources` on the day; absent means single-source.
- [ ] Why is the range wide? Inspect `snowfall_models`; suspect `met_norway`
      (1mm≈1cm heuristic) and the ensemble p10/p90 widening.
- [ ] How many models back it? `snowfall_sources` (always ≥2 when present).
- [ ] Am I about to change a JSON field name? Stop — additive-only; go to
      `snowforcast-change-control`.

---

## Provenance and maintenance

Volatile facts in this skill and how to re-verify them (run from repo root):

```bash
# Consensus is a plain median with null weights across ALL shipped data?
grep -o '"method": "[^"]*"\|"skill_weights": null' data/all-forecasts.json | sort | uniq -c
#   expect: only "method": "median" and skill_weights: null (no "skill-weighted median")

# What does skill.json actually score right now? (dormancy check)
cat data/skill.json
#   expect: only openmeteo_best_match scored per resort -> <2 models -> weights dormant

# The 7 source ids and the ensemble/model constants
grep -n "FORECAST_MODELS\|ENSEMBLE_MODEL\|openmeteo_best_match\|met_norway\|ensemble_median" multi_model.py

# The ≥2-source guard, the ≥2-scored-models guard, and the 1mm≈1cm heuristic
sed -n '143,147p;210,214p;236,239p' multi_model.py

# The weight formula and where it (would) apply
grep -n "1.0 / (mae + 0.5)\|weight = 1\|weighted_median\|skill_weights" multi_model.py forecast_skill.py

# How consensus is invoked in the live generator
grep -n "enrich_extended_forecast\|MULTI_MODEL_AVAILABLE" generate_static_data.py

# Who regenerates skill.json (so you know weights can flip on automatically)
grep -n "forecast_skill.py\|skill.json" .github/workflows/update-skill.yml
```

**Last verified: 2026-07-08** against `multi_model.py`, `forecast_skill.py`,
`generate_static_data.py`, `data/skill.json`, and `data/all-forecasts.json`.

Facts most likely to drift, and their trigger:
- **Dormancy of skill-weighting** — flips ON automatically once ≥2 models each
  reach `n >= 5` in `skill.json`. Re-check `skill.json` and any `"method":
  "skill-weighted median"` / non-null `skill_weights` in the data. If it flips,
  update the "honest headline" and the user-facing-wording rule.
- **Source list** — if `FORECAST_MODELS` / `ENSEMBLE_MODEL` change, update the
  6-sources table and the ensemble-provider note (`ENSEMBLE_MODEL` is `gfs_seamless`
  today).
- **JSON field names** — should never change (frozen contract); if they do, it is
  a `snowforcast-change-control` incident, not a routine edit.
