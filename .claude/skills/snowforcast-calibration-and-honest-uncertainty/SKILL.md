---
name: snowforcast-calibration-and-honest-uncertainty
description: >-
  The honesty guard rail for any "how much to trust this number" feature on the
  snowforcast dashboard: the project has no observed-snow labels, so it may not
  claim calibrated confidence. Load when someone wants to add a "confidence",
  "trust score", "% chance", "80% range", "calibrated interval", "probability of
  snow", or "reliability" to the UI or data; when tempted to call snowfall_range a
  confidence interval or the median "skill-weighted"; or when asked whether the
  ranges are trustworthy. Do NOT load for HOW forecast skill is computed or
  run/repaired (use snowforcast-forecast-skill-methodology), for the shipped
  consensus mechanics — what snowfall_range / snowfall_models / p10 / p90 mean
  today (use snowforcast-consensus-and-model-reference), or to write the
  user-facing wording of a range/label (use
  snowforcast-meteorology-for-laypeople).
---

# snowforcast — Calibration & Honest Uncertainty (research frontier)

This is the project's **north-star ambition** and its **honesty guard rail** in one
place. The ambition: don't just show a snowfall number — tell the user how much to
trust it, with ranges/confidence that are actually *calibrated*. The guard rail:
**the project cannot yet prove any calibration, so it must never claim one.**

This skill is **aspirational + protective**, not a runbook you execute today. There
is no "run the calibration" command because the data to calibrate against does not
exist in this repo. Read this before you add anything trust-flavored to the UI or
data, or before you write copy that implies statistical confidence.

All file/line references are against the repo state on **2026-07-08**. Re-verify with
the commands in "Provenance and maintenance" if files have moved.

**This is a research/design reference, not a rules gate.** It never authorizes
changing the scraper, the frozen JSON contract, or the front-end. Any change you
scope here must still clear `snowforcast-change-control` (the rules gate) and
`snowforcast-architecture-contract` (why the system is shaped this way). This skill
does not route around them.

---

## Scope boundary — read the sibling instead when

| You want to… | Read instead |
|---|---|
| Understand HOW model skill is scored today (git-replay, proxy truth, `1/(MAE+0.5)`) or run/repair that scoring | `snowforcast-forecast-skill-methodology` |
| Know what `snowfall_range` / `snowfall_models` / `snowfall_sources` / p10 / p90 mean *as shipped* | `snowforcast-consensus-and-model-reference` |
| Write the actual user-facing words for a range/label | `snowforcast-meteorology-for-laypeople` |
| Enforce that no fabricated/default value entered the data | `snowforcast-data-integrity-and-validation` |
| Know what you may not change / clear a change | `snowforcast-change-control` |
| Confirm a class of "fix" isn't a known dead end | `snowforcast-failure-archaeology` |

---

## The honesty constraint (non-negotiable — read this first)

Before anything else, internalize these four facts. Every idea in this skill is
subordinate to them.

1. **The skill scheme is DORMANT.** The `1/(MAE+0.5)` model-weighting in
   `forecast_skill.py` / `multi_model.py` is written but not applied. As shipped
   today the consensus is a **plain unweighted median**. (Mechanics:
   `snowforcast-consensus-and-model-reference`. How scoring runs:
   `snowforcast-forecast-skill-methodology`.)

2. **The skill score measures forecasts against OTHER FORECASTS, not snow.**
   `forecast_skill.py` uses the **day-of forecast as a stand-in for what actually
   fell** (`observations.setdefault(date_str, snowfall)` at `forecast_skill.py:79`;
   the docstring calls it "the best available proxy for what actually happened",
   lines 7-13). It never sees a measured centimetre of snow. This is a
   **proxy-truth** number: a model scored partly against itself.

3. **True calibration needs observed-snowfall labels the project does not collect.**
   There is no station report, resort snow-stake reading, or SNOTEL/SWE feed
   anywhere in this repo. Without ground truth you cannot answer the only question
   that makes a range "calibrated": *did the 80% range contain the real snowfall
   80% of the time?*

4. **Therefore: never present current output as validated calibration.** No
   "confidence", "% chance", "80% interval", "calibrated", or "accuracy N%" wording
   in the UI, data, docs, or commit messages unless it is backed by observed labels
   and a reliability diagram. Today none of it is.

> If you remember one sentence: **`snowfall_range` is model *disagreement*, not a
> probability.** Selling disagreement as confidence is the exact overclaim this
> skill exists to stop.

---

## What we have today (the honest starting material)

Two real, already-shipped uncertainty signals — good raw material, not calibrated
output:

| Signal | What it is | Where | What it is NOT |
|---|---|---|---|
| `snowfall_range` `[low, high]` | Spread across the ~5-7 model values for that day, widened by the ensemble p10/p90 | `multi_model.py:241-248` | Not a confidence interval; not tied to any observed frequency |
| ensemble `p10` / `p90` | 10th/90th percentile across ~30 perturbed GFS members (one model's internal spread) | `fetch_ensemble_daily`, `multi_model.py:71-117` | Not the spread of *reality*; one model's self-perturbation only |
| `snowfall_sources` | How many independent values backed the median (guarded `>= 2`) | `multi_model.py:249` | Not a trust score; more sources ≠ more correct |

Front-end currently renders the range as
`"{low}–{high}cm spread · {N} models"` (`forecast.html:2307`, `forecast_new.html:1464`),
and only when the range is `>= 1cm` wide. **This skill endorses only the word
"spread" in that string.** "spread" correctly frames the width as model
*disagreement*, not confidence — it is load-bearing; keep it, and do not upgrade it
to "range we're 80% sure of" or similar.

**The `· {N} models` portion is NOT endorsed here.** It is flagged for lay-rewrite
by `snowforcast-meteorology-for-laypeople`, whose rule is that a source count must
read **"{N} forecasts checked", never "{N} models"** on first glance. Its "Model
names must NOT appear raw in the UI" section lists this exact "N models" tooltip
wording under **Known current gap (2026-07-08)** as "the exact wording this skill
exists to fix." So: preserve "spread", but expect "· {N} models" to change to lay
phrasing under that skill's ownership. Do **not** treat the whole string as
frozen-correct just because "spread" is right — the wording skill owns the *words*;
this skill owns only the claim that the *number* is disagreement, not probability.

**The goal** is to make this uncertainty *first-class and trustworthy*: build on
`snowfall_range` + ensemble p10/p90, and — only once labels exist — turn "spread"
into a range whose coverage is measured and honest. Until then, the goal is to
present spread *without lying about what it is*.

---

## What real calibration would require (the missing pipeline)

To legitimately claim "this 80% range contains the truth 80% of the time," the
project would need **all** of the following. None exist today; each is a candidate,
not a plan.

1. **An observed-snowfall data source.** Station or resort snow reports, a snow-stake
   / new-snow feed, or a modelled-analysis proxy (e.g. an ERA5-style reanalysis).
   Must cover the same resorts/elevations the dashboard forecasts. *(open — no
   source chosen or wired.)*

2. **A labeling pipeline.** For each `(resort, elevation, date)` that was forecast,
   record what actually fell, keyed the same way the forecast JSON is keyed, and
   stored as an append-only observed-truth series separate from the forecast files.
   *(open.)*

3. **Reliability / coverage diagnostics.** With labels in hand, compute the
   diagnostics that define calibration:
   - **Coverage** — of all days with an 80% range, what fraction actually landed
     inside it? (Target ≈ 80%. Below → overconfident/too narrow; above → too wide.)
   - **Reliability diagram** — bucket predicted probabilities/quantiles, plot
     predicted vs observed frequency; the diagonal is perfect calibration.
   - **Sharpness** — how narrow the ranges are *subject to* staying calibrated
     (narrow-and-calibrated is the win; narrow-and-wrong is the failure mode).
   - Optionally a proper score (CRPS / pinball loss) to compare candidate
     uncertainty models. *(open — no code computes any of these against real snow.)*

**Vocabulary (define once):**
- **Calibration** — do stated probabilities/ranges match observed frequencies. An
  80% range is calibrated iff truth falls inside it ~80% of the time over many days.
- **Coverage** — the *measured* hit-rate of a range. The empirical check on
  calibration.
- **Sharpness** — how tight the ranges are. Only meaningful *after* calibration is
  established; a sharp but miscalibrated range is confidently wrong.
- **Ground truth / label** — a measured value of what actually happened. The thing
  this project does **not** have for snowfall.
- **Proxy truth** — a stand-in used because ground truth is missing (here: the
  day-of forecast). Enables *relative* model comparison, never absolute calibration.

---

## Pitfalls that corrupt the range TODAY

Even setting calibration aside, three known issues distort the *current* spread. A
range built on a poisoned distribution is worse than no range — treat these as
blockers before trusting any width.

| Pitfall | Mechanism | Effect on the range | Cross-ref |
|---|---|---|---|
| **MET Norway snow-ratio under-estimate** | `fetch_met_norway_daily` estimates snow from precip with a crude `1mm ≈ 1cm` heuristic + symbol match (`multi_model.py:143-147`). Owner has observed MET Norway coming out **~10x lower** than the NWP `snowfall_sum` models. | Drags the **low** end of `[low, high]` down and skews the median toward zero → range looks wider and lower than reality. | `snowforcast-consensus-and-model-reference` (source mechanics), `snowforcast-data-integrity-and-validation` (detecting it) |
| **Fabricated / default fill values in the distribution** | Any silent default substituted for missing real data (the class behind the 2300m snow-line incident) would enter `model_values` and become a `min`/`max`/median input. | A made-up number defines or widens the range → uncertainty that describes fiction, not weather. | `snowforcast-data-integrity-and-validation`, `snowforcast-change-control` (FAIL-LOUD rule) |
| **Degenerate `skill.json` (all MAE = 0.0)** | Current `skill.json` shows every scored model at `mae: 0.0` (all-zero summer forecasts scored against all-zero day-of proxy). `1/(0+0.5)=2.0` — the *maximum* possible weight. | Implies **perfect skill / false confidence**. If weighting were ever activated on this, it would hard-weight a model the data cannot actually vouch for. | `snowforcast-forecast-skill-methodology` |

> **The MET-Norway factor (~10x) is owner-reported and not independently re-measured
> here** — in July every resort's `snowfall_range` is `[0.0, 0.0]` (no snow to
> disagree about; confirmed against `data/all-forecasts.json` 2026-07-08), so the
> distortion is invisible off-season. Treat the exact multiple as **candidate**; the
> direction (under-estimate → low-skew) is the load-bearing claim.

---

## Interim honest presentation (what to do until labels exist)

Do NOT wait for a full calibration pipeline to be *honest*. The interim policy:

- **Express spread as best case / worst case, not confidence.** The width tells the
  user how much the models *disagree* — a legitimate, useful signal — as long as it
  is never dressed as a probability. Approved framing: "models disagree", "spread",
  "range across forecasts", "best case … worst case". Banned until backed by labels:
  "confidence", "N% chance", "80% sure", "calibrated", "accuracy", "probability of
  snow".
- **Hand the exact words to the wording skill.** Any user-facing label lives with
  `snowforcast-meteorology-for-laypeople` — it owns tone and layperson clarity for
  the WhatsApp/ski-buddy audience. This skill owns *what may be claimed*; that skill
  owns *how it's phrased*. One home per fact: do not write final UI copy here.
- **Keep the `>= 1cm` gate.** Only show a spread when it is meaningfully wide
  (`forecast.html:2305`); a 0.2cm "spread" is noise and reads as false precision.
- **Fix the poison before widening the story.** The MET-Norway skew and any
  fabricated-fill path must be resolved (via the data-integrity / change-control
  skills) before the range is worth featuring more prominently.

### Pre-flight checklist before adding ANY trust/confidence element

Do not ship an uncertainty/confidence feature unless every box is checked:

- [ ] Does it claim calibration (%, "N% sure", "80% range", "accuracy")? → **STOP**
      until observed-snow labels + a coverage diagnostic exist.
- [ ] Is the wording "spread"/"disagreement"/"best-worst case" (allowed) rather than
      "confidence"/"probability" (blocked)?
- [ ] Have you confirmed no MET-Norway skew or fabricated default is inflating the
      distribution for the days shown? (`snowforcast-data-integrity-and-validation`)
- [ ] Is `skill.json` non-degenerate (not all `mae: 0.0`) *if* the feature leans on
      skill weights at all? (`snowforcast-forecast-skill-methodology`)
- [ ] Does the final copy go through `snowforcast-meteorology-for-laypeople`?
- [ ] Does the change respect the frozen JSON contract and clear
      `snowforcast-change-control`?

---

## Frontier ideas — worth exploring vs out of scope

Keep ambition **proportionate to a hobby dashboard shared over WhatsApp**. Ideas
below are candidates only; none is committed work, and none may ship as "calibrated"
without the missing pipeline above.

**Worth exploring (proportionate, incremental honesty):**
- A tiny observed-snow labeler for the ~5 tracked resorts (even manual/occasional
  station or resort-report scraping) — the single unlock that turns everything else
  from proxy to real. Highest leverage.
- Once labels exist: a **coverage number** ("over the last N snow days, the shown
  range contained the actual new snow M% of the time") — the first *earned* trust
  statement the project could make.
- Empirical **range widening/narrowing** so stated coverage matches observed
  coverage (conformal-style adjustment: inflate/deflate `[low, high]` by a factor
  fit on labels).
- Fixing the MET-Norway snow ratio so the *disagreement* signal is honest even
  before calibration.

**Out of scope for this project (disproportionate):**
- Training a bespoke ML post-processor / neural ensemble calibrator.
- Bayesian model-averaging or a full BMA/EMOS stack.
- Per-hour or spatially-gridded probabilistic fields.
- Anything requiring a data-science pipeline heavier than the existing
  scrape-and-commit cron. If a proposal needs infrastructure the 3-hourly GitHub
  Action can't carry, it is out of scope by definition.

**Reality check:** the meaningful frontier here is not a fancier model — it is
**getting even a little bit of real ground truth and being honest about coverage.**
Better calibration with no labels is impossible; honest disagreement-spread with
zero labels is already achievable and is the near-term target.

---

## Provenance and maintenance

**Last verified: 2026-07-08** against `forecast_skill.py`, `multi_model.py`,
`data/skill.json`, `data/all-forecasts.json`, `forecast.html`, `forecast_new.html`,
and `.github/workflows/update-skill.yml`.

Re-verify each volatile claim with:

```bash
# (1) Skill weighting is DORMANT: proxy-truth line + the ≥2-scored-models guard.
grep -n "observation proxy\|best available proxy" forecast_skill.py
sed -n '206,214p' multi_model.py            # weights only apply if len(weights) >= 2

# (2) skill.json is degenerate (all MAE 0.0) → false-confidence risk if activated.
grep -n '"mae"' data/skill.json

# (3) Scoring runs weekly but its output is unused (dormant). Confirm the workflow.
sed -n '28,31p' .github/workflows/update-skill.yml

# (4) The range is model spread + ensemble p10/p90, NOT a confidence interval.
sed -n '240,249p' multi_model.py

# (5) MET Norway snow estimated at 1mm≈1cm (the ~10x-underestimate heuristic).
sed -n '143,147p' multi_model.py

# (6) Front-end wording is "spread", gated at ≥1cm — keep it non-probabilistic.
grep -n "cm spread\|snowfall_range\[1\] - day.snowfall_range\[0\]" forecast.html forecast_new.html

# (7) Off-season all ranges are [0,0] → MET-Norway skew invisible in July.
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));import re;print('inspect any extended_forecast[*].snowfall_range')"
```

Facts most likely to drift, and their trigger:
- **Dormancy** — flips ON automatically once ≥2 models per resort reach `n >= 5` in
  `skill.json` (`multi_model.py:214`). If that happens, the "honest headline" and the
  degenerate-`skill.json` pitfall must be re-checked immediately — activation on
  `mae: 0.0` scores is exactly the false-confidence failure. See
  `snowforcast-forecast-skill-methodology`.
- **MET-Norway ~10x factor** — owner-reported, unverified off-season. Re-measure the
  first time real winter snow is in `snowfall_models` (compare `met_norway` vs the
  `*_seamless` values on a snowy day) and update the pitfall's magnitude/label.
- **The word "spread"** — if any front-end or doc upgrades it toward
  "confidence"/"probability", that is an overclaim regression this skill exists to
  block; treat as a `snowforcast-change-control` matter, not a copy tweak.
- **New observed-snow source** — the day a label pipeline lands, most of this skill's
  "open/candidate" items become live; rewrite the honesty constraint from "no labels"
  to "labels exist, here is the measured coverage."
