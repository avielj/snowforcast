---
name: snowforcast-data-integrity-and-validation
description: >-
  MEASURE that snowforcast's data is right instead of eyeballing it — the closest
  thing to QA in a repo with no test framework, no CI code gates, and a 3-hourly
  bot that commits whatever it scrapes. Load this before trusting a data refresh,
  after editing generate_static_data.py / multi_model.py / forecast_skill.py, when
  a resort tile looks wrong, when snow numbers look too round or too flat, when
  skill.json looks degenerate (dormant weighting), when a snow-line/elevation looks
  copied across resorts, or whenever you need to prove committed data/*.json is real
  scraped data and not a synthetic fallback. Enforces FAIL-LOUD: catch
  silently-wrong or fabricated data before and after it commits. Triggers: "is the
  data correct", "validate the forecast JSON", "check the refresh", "degenerate
  skill.json / dormant weighting", "snowfall_range wrong", "synthetic data",
  "fill_missing_days", "data sanity check", "why does this resort look off".
---

# Snowforcast Data Integrity and Validation

## What this skill is for

This project has **no test framework, no CI code/lint/type gate, and no assertion
anywhere in the pipeline** (verified 2026-07-08). The only automation is a GitHub
Action that scrapes every 3 hours and **commits whatever it got** — a green Action
means "the script exited 0", *not* "the numbers are right". The two `test_*.py`
files are manual network scripts that `print()` and never assert.

So "QA" here means: **you, by hand, run a fixed set of measurements before you
trust a refresh.** This skill is that runbook. Every check below exists to make one
specific failure impossible: **silently showing wrong or fabricated numbers.**

> **Core threat model.** For a forecast product shared socially over WhatsApp, a
> *silently wrong* number erodes trust far more than a visible error. A blank cell
> says "we don't know". A confident "10 cm" that was fabricated by a fallback, or a
> snow line copied from another resort, is a lie the user acts on. **Every check in
> this skill makes silent-wrong-fallback detectable. FAIL LOUD instead.**

This skill does not fix anything. It **detects**. When a check fails, it routes you
to the sibling skill that owns the fix.

## When NOT to use this skill (route elsewhere)

| You actually want to… | Go to |
|---|---|
| Repair the scraper that produced bad data | `snowforcast-scraper-resilience-campaign` |
| Understand the rules a change must not break | `snowforcast-change-control` (first stop before editing) |
| Understand *why* the JSON contract is shaped this way | `snowforcast-architecture-contract` |
| Evaluate forecast **skill/accuracy over time** (research) | `snowforcast-forecast-skill-methodology` |
| Reason about calibrated ranges / confidence (research) | `snowforcast-calibration-and-honest-uncertainty` |
| Understand what each model/source *is* and how they blend | `snowforcast-consensus-and-model-reference` |
| Triage a live symptom fast (symptom → cause table) | `snowforcast-debugging-playbook` |
| Check whether a dead end was already solved | `snowforcast-failure-archaeology` |
| Run/deploy/configure the pipeline | `snowforcast-build-deploy-and-operations` |

This skill **measures**; it never routes around change control. If a check tells you
to edit the pipeline, read `snowforcast-change-control` first.

## Jargon, defined once

| Term | Meaning here |
|---|---|
| **Refresh** | One run of `generate_static_data.py` (scrape + enrich + write `data/*.json`). |
| **Real data** | Values scraped from snow-forecast.com or fetched live from Open-Meteo / MET Norway. |
| **Synthetic data** | Values *fabricated* by `fill_missing_days_from_openmeteo` to pad a short forecast to 7 days (default wind, offset feels-like, fixed snow split). Not measured, not scraped — invented. |
| **Consensus** | The blended snowfall for an extended-forecast day: a (currently plain) median across models, plus a `snowfall_range` = [low, high]. Lives in `data/*.json` under `extended.extended_forecast[]`. |
| **Skill weight** | `1 / (MAE + 0.5)` per model, meant to up-weight accurate models in the median. **Currently dormant** (always neutral). |
| **MAE** | Mean absolute error, in cm, of a model's snowfall vs the day-of forecast used as a truth *proxy*. Written to `data/skill.json`. |
| **Elevation** | `bot` / `mid` / `top` (bottom / mid / top of the resort). Every resort has all three. |
| **Frozen contract** | `data/all-forecasts.json` — both front-ends fetch it directly from GitHub raw. Fields may be *added*; existing ones must never change or vanish. |

## The ground truth you are validating against (verified 2026-07-08)

- **9 resorts** (`metadata.json` → `resorts`): Val-Thorens, Cervinia, Via-Lattea,
  Monterosa-Ski, Gudauri, St-Anton, Alpe-d-Huez, La-Plagne, Mount-Hermon.
- **3 elevations** each: `bot`, `mid`, `top` → **27 per-resort files** +
  `all-forecasts.json` + `metadata.json` + `skill.json`.
- Each per-resort file should carry `days` (7 short-range day objects with
  `am`/`pm`/`night`), `extended.extended_forecast` (16 daily objects with
  `snowfall`, `snowfall_range`, `snowfall_models`, `snowfall_sources`), and a
  `consensus` meta block.
- Snowfall units are **cm**. Temperatures **°C**.

---

## PART A — REAL vs SYNTHETIC: spot the fabrications

`generate_static_data.py::fill_missing_days_from_openmeteo` (defined at **line 364**;
the fabrication block is roughly **lines 382–445**, re-verify with the command in
Provenance) pads a short scrape up to 7 `days`. **It invents fields and does not
label them synthetic.** That unlabeled fabrication is the #1 silent-wrong risk in
the `days` array.

> **Single home for the fabricated-value constants.** This PART A fingerprint table
> is the canonical catalogue of the exact `fill_missing_days_from_openmeteo` magic
> values (literal wind strings, feels-like offsets, snow-split fractions). Sibling
> skills that invoke the FAIL-LOUD rule — `snowforcast-change-control` Rule 0 and
> `snowforcast-debugging-playbook` symptom #2 — state the *rule/symptom* and point
> here rather than re-listing the numbers, so one code change updates one place.
> Keep the exact constants here and nowhere else.

**Fabrication fingerprints — any of these in a `days[]` period means synthetic:**

| Field | Fabricated value / rule | Real-data behaviour |
|---|---|---|
| `wind` (am/pm) | literally `"10.0 km/h W"` | scraped wind varies: e.g. `"5.0 km/h NW"`, `"0.0 km/h NE"` |
| `wind` (night) | literally `"5.0 km/h W"` | varies |
| `feels_like` am | `temp_min - 3` (fixed offset) | scraped chill, not a fixed offset |
| `feels_like` pm | `temp_max - 2` | — |
| `feels_like` night | `temp_avg - 4` | — |
| snow split | Night `0.5` / AM `0.3` / PM `0.2` of the daily total | scraped per-period snow |
| condition | **same string** across am/pm/night for that day | usually differs by period |

**Check A1 — detect synthetic `days` periods.**

```bash
cd "<repo root>"
python3 - <<'PY'
import json, glob, os
BAD_WIND = {"10.0 km/h W", "5.0 km/h W"}
for f in sorted(glob.glob('data/*-*.json')):
    b = os.path.basename(f)
    if b in ('metadata.json','skill.json'): continue
    d = json.load(open(f))
    for i, day in enumerate(d.get('days', [])):
        for period in ('am','pm','night'):
            p = day.get(period, {})
            if p.get('wind') in BAD_WIND:
                print(f"SYNTHETIC? {b} day[{i}] {period}: wind={p.get('wind')!r} snow={p.get('snow')!r}")
PY
```

If this prints rows, those days were **fabricated by fill_missing_days**, not
scraped. That is *acceptable only if* the scrape genuinely returned fewer than 7
days AND the fabrication is disclosed. Today it is **not disclosed** — there is no
`synthetic: true` flag anywhere in the output.

**REQUIRED INVARIANT (candidate — not yet enforced in code, 2026-07-08):**
> Any period produced by `fill_missing_days_from_openmeteo` MUST carry an explicit
> marker (e.g. `"source": "openmeteo_fill"` or `"synthetic": true`) on the period
> object, and the front-end MUST render padded days distinctly (e.g. dimmed /
> "estimated"). Until that marker exists, treat every `days`-array value produced
> beyond the real scrape length as **unverified** and never let it look identical
> to scraped data.

To fix the *absence of the label*, that is a pipeline change → read
`snowforcast-change-control`, then it is a UI concern for
`snowforcast-frontend-ui-contract`. This skill's job is only to prove the label is
missing (it is) and to detect the fingerprints above.

---

## PART B — SANITY CHECKS on committed `data/*.json`

Run these after every refresh you intend to trust, and after any edit to
`generate_static_data.py` or `multi_model.py`.

**Check B1 — completeness: 9 resorts × 3 elevations, all present and non-empty.**

A live example of the failure this catches: on 2026-07-08 `monterosa-ski-bot.json`
was **6 days, 3951 bytes, no `extended`, no `consensus`** — a partial scrape that
committed anyway. That is exactly the degraded file this check surfaces.

```bash
python3 - <<'PY'
import json, os
meta = json.load(open('data/metadata.json'))
resorts, elevs = meta['resorts'], meta['elevations']
problems = 0
for r in resorts:
    for e in elevs:
        f = f"data/{r.lower()}-{e}.json"
        if not os.path.exists(f):
            print(f"MISSING FILE: {f}"); problems += 1; continue
        d = json.load(open(f))
        days = d.get('days', [])
        ext  = (d.get('extended') or {}).get('extended_forecast', [])
        if len(days) < 7:
            print(f"SHORT days ({len(days)}<7): {f}"); problems += 1
        if not ext:
            print(f"NO extended block: {f}"); problems += 1
        if 'consensus' not in d:
            print(f"NO consensus block: {f}"); problems += 1
print("OK" if not problems else f"{problems} problem(s)")
PY
```

**Check B2 — non-null snow, plausible magnitude.** Every extended day must have a
numeric `snowfall`; no `null`, no absurd values.

```bash
python3 - <<'PY'
import json, glob, os
MAX_CM = 200  # a single day above ~2 m of snow is almost certainly a bug
for f in sorted(glob.glob('data/*-*.json')):
    if os.path.basename(f) in ('metadata.json','skill.json'): continue
    d = json.load(open(f))
    for day in (d.get('extended') or {}).get('extended_forecast', []):
        s = day.get('snowfall')
        if s is None:
            print(f"NULL snowfall {os.path.basename(f)} {day.get('date')}")
        elif not isinstance(s,(int,float)) or s < 0 or s > MAX_CM:
            print(f"IMPLAUSIBLE snowfall {os.path.basename(f)} {day.get('date')}: {s}")
PY
```

`MAX_CM=200` is a coarse guard, not a calibrated bound — treat hits as "look at
this", not "definitely wrong".

**Check B3 — snow-line / elevation must NOT leak across resorts (the 2300 m
incident).** Historically Val-Thorens' `bot` elevation (2300 m) silently got applied
to *other* resorts. The extended block records `extended.elevation_used`; it must
equal that resort/elevation's own height from the `elevation_heights` table in
`generate_static_data.py` (~line 484). On 2026-07-08 this was correct (VT-bot=2300,
Cervinia-bot=2050, Monterosa-mid=2200) — this check keeps it that way.

```bash
python3 - <<'PY'
import json, ast, re
src = open('generate_static_data.py').read()
# pull the elevation_heights = { ... } literal
m = re.search(r'elevation_heights\s*=\s*(\{.*?\n    \})', src, re.S)
heights = ast.literal_eval(m.group(1))
bad = 0
for r, elevs in heights.items():
    for e, h in elevs.items():
        f = f"data/{r.lower()}-{e}.json"
        try: d = json.load(open(f))
        except FileNotFoundError: continue
        used = (d.get('extended') or {}).get('elevation_used')
        if used is not None and used != h:
            print(f"ELEVATION LEAK {f}: used={used} expected={h}"); bad += 1
print("OK" if not bad else f"{bad} leak(s)")
PY
```

**Check B4 — timestamp freshness.** The 3-hourly cron should keep data recent. Stale
data shown as current is silent-wrong.

```bash
python3 - <<'PY'
import json, datetime
meta = json.load(open('data/metadata.json'))
ts = datetime.datetime.fromisoformat(meta['last_updated'])
age_h = (datetime.datetime.now() - ts).total_seconds()/3600
print(f"metadata.last_updated = {meta['last_updated']} ({age_h:.1f} h old)")
if age_h > 6:  # cron is every 3h; >6h means at least one run silently failed
    print("STALE: refresh has not committed in >6h — check the Action")
PY
```

`metadata.json` carries **no per-resort timestamp**; freshness is global. If you need
per-resort freshness, each per-file `last_updated` / `extended.last_updated` exists —
add it to this check.

---

## PART C — DEGENERATE SKILL OUTPUT: MAE 0.0 is a RED FLAG, not success

`data/skill.json` on 2026-07-08 shows, for **every** scored resort, exactly one
model `openmeteo_best_match` with **`mae: 0.0`**, and the consensus block reports
**`skill_weights: null`** with `method: "median"`.

**This is the proxy-scoring bug, not perfect forecasting.** `forecast_skill.py`
uses each day's **day-of forecast as the truth proxy** (it does not collect observed
snowfall — the project has none). The only model with enough per-lead history is
`openmeteo_best_match`, which *is* the source of the day-of value. So the script
**scores a model against itself → error 0**. Then `load_skill_weights` (in
`multi_model.py`, ~line 195) requires **≥2 scored models** before it will weight, so
it returns `{}` → weighting stays **dormant** → `skill_weights: null`.

A naive reader sees "MAE 0.0, models are perfect". A correct reader sees "the scorer
has no independent truth and is measuring nothing". **This check must surface the
red flag rather than let it look like a win.**

**Check C1 — flag degenerate skill.json.**

```bash
python3 - <<'PY'
import json
try: sk = json.load(open('data/skill.json'))
except FileNotFoundError:
    print("no skill.json (weighting simply dormant) — OK"); raise SystemExit
flags = []
for resort, blk in sk.get('resorts', {}).items():
    models = blk.get('models', {})
    if all(m.get('mae') == 0.0 for m in models.values()):
        flags.append(f"{resort}: all MAE=0.0 across {list(models)}")
    if set(models) == {'openmeteo_best_match'}:
        flags.append(f"{resort}: only openmeteo_best_match scored (self-vs-self proxy)")
if flags:
    print("DEGENERATE skill scoring (proxy bug, NOT perfect skill):")
    for f in flags: print("  -", f)
else:
    print("skill.json has multi-model non-zero MAEs — inspect before trusting")
PY
```

Do **not** try to "fix accuracy" from here. Whether the proxy is fixable, and how to
evaluate skill honestly, is research owned by
`snowforcast-forecast-skill-methodology`. Overclaiming calibration is the exact
failure `snowforcast-calibration-and-honest-uncertainty` guards against. This skill
only asserts: **MAE 0.0 everywhere ⇒ scoring is degenerate ⇒ weighting must stay
dormant, and nothing in the UI may present this as measured accuracy.**

---

## PART D — CONSENSUS-SHAPE CHECKS

The consensus lives per extended-day: `snowfall` (median), `snowfall_range`
[low, high], `snowfall_sources` (count), `snowfall_models` (per-model values). Built
by `multi_model.py::apply_consensus` (~line 217).

**Check D1 — ≥2 real sources per consensus day, else it is raw passthrough.**
`apply_consensus` only builds a consensus when it has **≥2 non-null model values**
(`if len(pairs) < 2: continue`). A day with `snowfall_sources` missing or `<2` did
**not** get a consensus — its `snowfall` is a single model's raw number wearing no
uncertainty. That is not necessarily wrong, but it must not be presented as
multi-model agreement.

```bash
python3 - <<'PY'
import json, glob, os
for f in sorted(glob.glob('data/*-*.json')):
    if os.path.basename(f) in ('metadata.json','skill.json'): continue
    d = json.load(open(f))
    for day in (d.get('extended') or {}).get('extended_forecast', []):
        n = day.get('snowfall_sources')
        if 'snowfall_range' in day and (n is None or n < 2):
            print(f"PASSTHROUGH-as-consensus {os.path.basename(f)} {day.get('date')}: sources={n}")
PY
```

**Check D2 — `snowfall_range` width sanity.** The range must bracket the median and
not be absurdly wide. `low <= snowfall <= high`; `low >= 0`; width not
nonsensically large relative to the median.

```bash
python3 - <<'PY'
import json, glob, os
for f in sorted(glob.glob('data/*-*.json')):
    if os.path.basename(f) in ('metadata.json','skill.json'): continue
    d = json.load(open(f))
    for day in (d.get('extended') or {}).get('extended_forecast', []):
        rng, s = day.get('snowfall_range'), day.get('snowfall')
        if not rng: continue
        lo, hi = rng
        tag = os.path.basename(f) + " " + str(day.get('date'))
        if lo > hi:            print(f"INVERTED range {tag}: {rng}")
        if lo < 0:             print(f"NEGATIVE low {tag}: {rng}")
        if s is not None and not (lo <= s <= hi):
            print(f"MEDIAN OUTSIDE range {tag}: snow={s} range={rng}")
        if hi - lo > 100:      print(f"SUSPICIOUSLY WIDE {tag}: {rng}")
PY
```

**Check D3 — MET Norway must not drag the median (candidate / owner-reported).**
The MET Norway snowfall estimate in `fetch_met_norway_daily` (~line 120) converts
precipitation to snow with a crude rule (`1 mm water ≈ 1 cm snow` only when the
symbol contains `snow`; sleet ×0.5). The owner reports this systematically
**under-estimates by roughly 10×** versus the Open-Meteo models, which can pull the
plain-median consensus down. **Status: reported, not root-caused in code by this
skill — treat as a candidate defect, not a proven constant.**

The measurable symptom: on days with snow, `snowfall_models["met_norway"]` sits far
below the median of the other models. This check surfaces it without asserting the
"10×" figure.

```bash
python3 - <<'PY'
import json, glob, os, statistics
for f in sorted(glob.glob('data/*-*.json')):
    if os.path.basename(f) in ('metadata.json','skill.json'): continue
    d = json.load(open(f))
    for day in (d.get('extended') or {}).get('extended_forecast', []):
        m = day.get('snowfall_models') or {}
        met = m.get('met_norway')
        others = [v for k,v in m.items() if k!='met_norway' and v is not None]
        if met is None or len(others) < 2: continue
        med = statistics.median(others)
        if med >= 2 and met < med/3:   # MET is <1/3 of peers on a meaningful-snow day
            print(f"MET-LOW {os.path.basename(f)} {day.get('date')}: met={met} peers_median={med:.1f}")
PY
```

If this fires on snowy days, the MET Norway heuristic is the suspect. Fixing the
heuristic is a pipeline change (`snowforcast-change-control` first); the *domain
reasoning* about why one source may be off lives in
`snowforcast-consensus-and-model-reference`.

---

## PART E — THE MINIMAL BY-HAND VALIDATION (run before trusting any refresh)

There is **zero** automated gate. This is the substitute. Run the whole block; if
anything prints a problem, do **not** treat the refresh as trustworthy.

```bash
cd "<repo root>"      # the snowforcast checkout
# A1 synthetic-days fingerprint
# B1 completeness (9×3, days>=7, extended, consensus)
# B2 non-null / plausible snowfall
# B3 elevation-leak
# B4 freshness
# C1 degenerate skill
# D1 passthrough-as-consensus  D2 range sanity  D3 MET-low
```

Run each Check block above in order. **Interpretation table:**

| Check fires | Most likely cause | Route to |
|---|---|---|
| A1 synthetic wind | scrape returned <7 days, padded silently | `scraper-resilience-campaign`; label fix → `frontend-ui-contract` |
| B1 short/missing file | partial or failed scrape committed anyway | `scraper-resilience-campaign` |
| B2 null/implausible snow | parser mismapped a row, or unit bug | `scraper-resilience-campaign` / `debugging-playbook` |
| B3 elevation leak | the 2300 m default class of bug returned | `change-control` (this is a gated invariant) |
| B4 stale | a cron run failed silently | `build-deploy-and-operations` |
| C1 MAE 0.0 everywhere | proxy-scoring degeneracy (expected today) | `forecast-skill-methodology` — do NOT ship it as accuracy |
| D1 passthrough | <2 sources that day; fine, but not "consensus" | `consensus-and-model-reference` |
| D2 bad range | consensus/ensemble math bug | `consensus-and-model-reference` |
| D3 MET-low | MET Norway heuristic under-estimate (candidate) | `consensus-and-model-reference` |

**Note on the existing `test_*.py`:** `test_openmeteo.py` and `test_vt_scrape.py`
are **print-only manual network scripts with no assertions** (verified 2026-07-08).
They prove connectivity, not correctness. Do not cite them as a test suite and do
not assume they gate anything.

---

## PART F — TURN EACH CHECK INTO AN ASSERTION (the missing safety net)

The project needs a gate that **fails loudly**. Each Check above is written to be
lifted into an assertion almost verbatim: replace every `print("PROBLEM …")` with a
raised error and a non-zero exit, then run it as a pre-commit hook or as a step in
`.github/workflows/update-forecast.yml` **before** the commit step.

Pattern to convert any Check into a gate:

```python
# validate_data.py  (candidate — does not exist yet, 2026-07-08)
import sys
problems = []
# ... reuse the Check bodies, append messages to `problems` instead of print ...
if problems:
    print("DATA VALIDATION FAILED:", *problems, sep="\n  ")
    sys.exit(1)          # <-- this is the FAIL-LOUD the pipeline is missing
print("data validation passed")
```

Wiring it into the Action (conceptually — coordinate via `change-control` and
`build-deploy-and-operations` before editing the workflow):

```yaml
    - name: Validate data before commit
      run: python3 scripts/validate_data.py      # must exit non-zero to block a bad commit
    - name: Commit and push if changed
      run: ...                                    # only reached if validation passed
```

**Priority order for what to assert first** (highest silent-wrong risk first):
1. **B3 elevation-leak** — this is the incident the whole fail-loud rule exists for.
2. **B1 completeness** — a missing/short file is the most common silent degradation.
3. **A1 synthetic labelling** — fabricated data must never be indistinguishable from real.
4. **B2 / D2** — implausible magnitudes and broken ranges.
5. **C1** — refuse to publish skill weights derived from degenerate MAE.

Do **not** add such a gate without reading `snowforcast-change-control` — a gate that
blocks the 3-hourly bot is itself a change that can break the deployed contract.
Keep the assertions *additive* to the JSON (never remove or rename an existing
field) per the frozen-contract rule in `snowforcast-architecture-contract`.

---

## Provenance and maintenance

Volatile facts are date-stamped **2026-07-08**. Re-verify with:

```bash
cd "<repo root>"

# Resort/elevation roster (expect 9 resorts, [bot,mid,top])
python3 -c "import json;m=json.load(open('data/metadata.json'));print(len(m['resorts']),m['resorts']);print(m['elevations'])"

# 27 per-resort files present? day counts (spot short/partial files)
python3 -c "import glob,json,os;[print(os.path.basename(f),len(json.load(open(f)).get('days',[]))) for f in sorted(glob.glob('data/*-*.json')) if os.path.basename(f) not in ('metadata.json','skill.json')]"

# fill_missing_days location + fabrication fingerprints ('10.0 km/h W', feels_like offsets, 0.5/0.3/0.2 split)
grep -n "def fill_missing_days_from_openmeteo\|10.0 km/h W\|5.0 km/h W\|temp_min - 3\|snowfall_total \* 0" generate_static_data.py

# elevation_heights table (source of truth for B3)
grep -n "elevation_heights = {" generate_static_data.py

# skill.json degeneracy (expect all mae 0.0, only openmeteo_best_match)
python3 -c "import json;sk=json.load(open('data/skill.json'));[print(r,{m:s['mae'] for m,s in b['models'].items()}) for r,b in sk['resorts'].items()]"

# consensus dormancy (expect method 'median', skill_weights null)
python3 -c "import json;print(json.load(open('data/val-thorens-mid.json')).get('consensus'))"

# consensus 2-source floor + skill-weight >=2-model floor
grep -n "if len(pairs) < 2\|len(weights) >= 2\|weight = 1 / (MAE + 0.5)\|1.0 / (mae + 0.5)" multi_model.py

# MET Norway snow heuristic (1mm water ~ 1cm snow; the D3 suspect)
grep -n "1mm water\|snow_cm = precip\|def fetch_met_norway_daily" multi_model.py

# Confirm there is still NO code/test gate: only these two workflows, no pytest/lint step
ls .github/workflows/ && grep -rn "pytest\|assert\|flake8\|mypy\|ruff" .github/workflows/ || echo "no code gate (expected)"

# Confirm test_*.py are still print-only (no 'assert')
grep -c "assert" test_openmeteo.py test_vt_scrape.py
```

**Claims explicitly labeled candidate / open (do not present as proven):**
- **D3 MET Norway "~10× under-estimate"** — owner-reported symptom; the heuristic
  (`snow_cm = precip` when symbol has `snow`) is verified to exist, but the exact
  10× magnitude and its precise cause are **not** verified by this skill.
- **Part A synthetic-label invariant** and **Part F validation gate** — **proposed,
  not implemented** as of 2026-07-08. There is currently no `synthetic` flag in the
  output and no `validate_data.py`. Both are the recommended fix, not existing state.
- `MAX_CM=200` (B2) and the D2/D3 thresholds (`>100`, `<med/3`) are **coarse
  heuristics**, not calibrated bounds; tune before wiring into a hard gate.
