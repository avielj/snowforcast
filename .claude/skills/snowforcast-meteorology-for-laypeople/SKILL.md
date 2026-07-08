---
name: snowforcast-meteorology-for-laypeople
description: >-
  The plain-language reference for EVERY user-facing word, label, or number in the
  snowforcast ski-forecast dashboard. The audience is the owner and a few ski
  buddies planning trips over WhatsApp with ZERO meteorology background — never
  assume they know freezing level, snow line, mm-vs-cm, "model", or p10/p90. Load
  this when you are about to: write or change any label/tooltip/heading the user
  sees, phrase an uncertainty range, decide how to show a missing resort, name a
  weather model in the UI, or write the headline "how much snow" number. Triggers:
  "what should this say", "rename this label", "how do we word", "freezing level",
  "snow line", "p10 p90", "best case worst case", "model names in the UI",
  "AROME ICON ECMWF GFS", "how much to trust", "couldn't get data wording",
  "first glance", "WhatsApp readable". If it is text a human reads, start here.
---

# snowforcast — Meteorology for Laypeople

This is the translation layer. Every meteorology concept the system computes must
reach the user as something a friend with no weather training understands in
seconds. This skill owns the WORDS. It does not own the math, the front-end code,
or the shareable card copy — see [When NOT to use this](#when-not-to-use-this).

## The one rule above all others

**Never assume they know this.** The audience is the owner plus a handful of ski
buddies coordinating over WhatsApp (owner-confirmed, 2026-07-08). Not one of them
is a meteorologist. If a word requires weather training to parse, it is a bug in
the wording, not a gap in the reader. Every term below has a "say this instead"
column. Use it.

If you can only remember one sentence: **say how much snow, and how sure we are,
in the words you would text a friend.**

---

## Plain-language glossary ("never assume they know this")

For each term: what it technically is, why the reader would care, and the exact
lay phrasing to put on screen.

### Freezing level
- **Technical:** the altitude (in metres) where the air temperature hits 0 °C.
  In the data this is `freezing_level_min` / `freezing_level_max` per day
  (verified in `data/all-forecasts.json`, sourced from OpenMeteo's
  `freezing_level_height`).
- **Why the reader cares:** it decides whether what falls on the slope is snow or
  rain. Above the freezing level = snow; below it = rain.
- **Say this instead:** don't show "freezing level 2100 m" cold. Translate it into
  what it means for THIS resort's slopes — see Snow line.

### Snow line
- **Technical:** the elevation above which precipitation falls as snow rather than
  rain — effectively the freezing level projected onto the mountain.
- **Why the reader cares:** "will the runs I ski actually get snow, or slush/rain?"
- **Say this instead** (this pattern already exists in both front-ends and is the
  approved style):
  - Freezing level below the resort's base → **"Snow falling to resort level."**
  - Freezing level in the middle of the resort → **"Snow line from 2400 m to
    1800 m, with rain below."**
  - Nothing frozen → **"Rain."**
- **Rule:** never make the reader do the "is 2100 m above or below my resort?"
  subtraction. The sentence must already answer it.

### Millimetres of water vs centimetres of snow (and why the ratio matters)
- **Technical:** weather models often output precipitation as **mm of water**
  (how much liquid falls). Skiers care about **cm of snow depth**. The conversion
  depends on how wet/dry the snow is — roughly **1 mm water ≈ 1 cm snow** for
  average snow, but cold dry powder can be 1 mm → 2 cm and wet snow less.
  In this repo the rough **1:1 mm→cm assumption is coded once**, only for the MET
  Norway estimate (`multi_model.py`: `snow_cm = precip  # 1mm water equivalent ~
  1cm snow`, verified 2026-07-08). The snow-forecast.com table and OpenMeteo
  `snowfall_sum` already arrive as cm, so the app mostly shows cm directly.
- **Why the reader cares:** "5 mm of rain" and "5 cm of snow" sound similar but are
  wildly different experiences. If we ever surface a water-mm number without
  converting, a reader will read it as snow depth and be wrong by a lot.
- **Say this instead:** **always show snow as cm.** Never put a raw "mm" number in
  front of the user as if it were snow. If a value is water-equivalent, either
  convert it to cm first or don't show it.

### "Model" and "multi-model consensus"
- **Technical:** a weather **model** is one supercomputer simulation of the
  atmosphere (this project blends several — see the reference skill). A
  **consensus** is the agreed number after combining them; here it is the
  **median** across up to 7 independent sources (`consensus.method = "median"`,
  verified 2026-07-08).
- **Why the reader cares:** one forecast can be wrong; several forecasts pointing
  the same way is more trustworthy.
- **Say this instead:** never use the word "model" as a noun the user must
  understand. Use **"forecaster"** / **"forecasts"** as the human stand-in:
  - Many models agree → **"Most forecasts agree on ~15 cm."**
  - Models disagree → **"Forecasts disagree — somewhere between 5 and 25 cm."**
  - Count of sources → **"7 forecasts checked"**, never "7 models" on first glance
    (see [Model names must not appear raw](#model-names-must-not-appear-raw-in-the-ui)).

### p10 / p90 / the range ("best case vs worst case")
- **Technical:** from the ensemble, `p10` is the 10th-percentile outcome (only 10%
  of scenarios were drier) and `p90` the 90th (only 10% were snowier). The stored
  `snowfall_range` = `[low, high]` folds model spread and ensemble p10/p90 into one
  low–high band (verified in `multi_model.py::apply_consensus`).
- **Why the reader cares:** it answers "what if I'm unlucky / lucky?"
- **Say this instead:** **best case vs worst case**, in trip terms. Never print
  "p10" or "p90". See [Uncertainty in trip-planning terms](#express-uncertainty-in-trip-planning-terms).

---

## Model names must NOT appear raw in the UI

The blended sources are **Meteo-France (AROME/ARPEGE), DWD ICON, ECMWF IFS, NOAA
GFS** (all via Open-Meteo) plus **MET Norway** (verified in `multi_model.py`).
These are correct, and completely meaningless to the audience. A ski buddy reading
"ECMWF IFS025" learns nothing and feels talked down to.

**Rule:** raw model names never appear on first glance. Use the lay substitute.

| Situation | ❌ Never (raw) | ✅ First glance (lay) |
|-----------|----------------|-----------------------|
| Sources agree | "AROME, ICON, ECMWF, GFS: 15 cm" | "Most forecasts agree: ~15 cm" |
| Sources disagree | "ECMWF 5 / GFS 25" | "Forecasts disagree: 5–25 cm" |
| Source count | "7 models" | "7 forecasts checked" |
| Attribution line | "Open-Meteo Multi-Model (AROME · ICON · ECMWF · GFS)" | "Blended from several independent forecasts" |

**Where model detail IS acceptable:** inside an **expandable / tooltip / "details"
section the reader opts into** — never the headline, never the card. If a curious
buddy taps "how is this calculated?", showing the per-model values
(`snowfall_models`) and names there is fine and even nice. The gate is: **opt-in,
second glance, clearly labelled as the nerdy detail.**

> ⚠️ **Known current gap (2026-07-08):** the live front-ends violate this rule.
> `forecast.html` (~line 931) and `forecast_new.html` (~line 897) print
> `Open-Meteo Multi-Model (AROME · ICON · ECMWF · GFS)` and `MET Norway` as
> visible source lines on first glance, and tooltips say "N models". This is the
> exact wording this skill exists to fix. When you touch those areas, migrate them
> to the lay substitutes above — but route the change through
> `snowforcast-change-control` and `snowforcast-frontend-ui-contract` first
> (rendering here is fragile and the JSON contract is frozen).

---

## First-glance clarity rule (the 2-second test)

The forecast link gets dropped into a WhatsApp group. People glance at it on a
phone, mid-conversation, and decide "worth a trip?" in about two seconds.

**Test:** cover everything except the headline number and its confidence. Could a
ski buddy with no weather background read just that and know (a) roughly how much
snow and (b) whether to trust it? If not, the wording fails.

Requirements for the headline:
- **One number in cm**, big, e.g. **"~15 cm"** — with a tilde/word that signals
  it's an estimate, not a promise.
- **A plain confidence cue right next to it** — e.g. **"forecasts agree"** (trust
  it) vs **"forecasts disagree"** (treat as rough). No percentages, no jargon.
- **Zero terms from the glossary above** in their raw form. If the word needs the
  glossary to understand, it doesn't belong on first glance.
- Works on a phone screen and in a WhatsApp link-preview thumbnail (the card copy
  itself is owned by `snowforcast-link-preview-and-positioning`).

---

## Express uncertainty in trip-planning terms

The data gives you `snowfall` (median cm) and `snowfall_range = [low, high]`.
Translate, don't transcribe.

| Data | ❌ Never | ✅ Say this |
|------|---------|------------|
| median 15, range [10,20] | "median 15, p10 10, p90 20" | "Likely 10–20 cm" |
| median 15, range [5,20] | "p10=5, p90=20" | "Likely ~15 cm, could be as low as 5" |
| tight range [14,16] | "low spread" | "Forecasts agree: about 15 cm" |
| wide range [2,30] | "high variance" | "Very uncertain — anywhere from a dusting to 30 cm" |
| all zero | "0.0 cm" | "No snow expected" |

Phrasing principles:
- Lead with the **likely** value, then the **downside** ("could be as low as X").
  Skiers plan around the risk of a bust, so the low end matters most.
- **Tight range = confidence, wide range = warning.** Make the range width itself
  carry the trust signal, in words.
- Only show a range when it's meaningful. The front-ends already suppress ranges
  narrower than ~1 cm (`snowfall_range[1] - snowfall_range[0] >= 1`); keep that —
  "10–11 cm" is noise, just say "~10 cm".
- Never imply more precision than the range supports. If it's [2,30], the honest
  headline is "very uncertain", not "16 cm".

> The deeper "how well-calibrated is this range, really" question is an open
> research problem for this project — see
> `snowforcast-calibration-and-honest-uncertainty`. Do not claim the ranges are
> calibrated to reality; say only what the spread shows.

---

## The resorts — places to ski, not data rows

Nine resorts, each scraped at three heights: **bot** (bottom / base), **mid**
(middle), **top** (summit). Elevations verified in `generate_static_data.py`
(`elevation_heights`, 2026-07-08). Frame these as "where you'd click into to plan
a day", and speak the heights in ski terms: **base / mid-mountain / summit**, not
"bot/mid/top" (those are internal keys, never user-facing).

| Resort (user-facing) | Base | Mid-mountain | Summit | Feel / note |
|----------------------|------|--------------|--------|-------------|
| Val Thorens | 2300 m | 2800 m | 3230 m | Highest ski area in the group; snow-sure. The reference resort. |
| Cervinia | 2050 m | 2900 m | 3480 m | Very high, Italian side of the Matterhorn. |
| Via Lattea | 1350 m | 2100 m | 2823 m | Big linked area (scraped as Sestriere). |
| Monterosa Ski | 1212 m | 2200 m | 3275 m | Off-piste favourite (scraped as Champoluc). |
| Gudauri | 1990 m | 2350 m | 3279 m | Georgia (Caucasus) — cheap, snowy, far. |
| St Anton | 1304 m | 2150 m | 2811 m | Austria; classic, lively. |
| Alpe d'Huez | 1250 m | 2350 m | 3330 m | Big French area, sunny. |
| La Plagne | 1250 m | 2250 m | 3250 m | Family-friendly French area. |
| **Mount Hermon** | 1600 m | 2000 m | 2236 m | **The home hill (Israel).** Lowest & warmest — snow is marginal, so the snow-line wording matters most here. |

Wording rules for resorts:
- Use the **display name with spaces** ("Mount Hermon", "Val Thorens"), never the
  internal slug (`mount-hermon`, `Val-Thorens`) and never the scrape alias
  ("Sestriere" for Via Lattea, "Champoluc" for Monterosa) in front of the user.
- Talk about **base / mid-mountain / summit**, not bot/mid/top.
- Mount Hermon is low and warm — it's the resort most likely to get "rain" or a
  "snow line above the runs" verdict. Its snow-line sentence is the one users will
  scrutinise most, so get it right.

---

## Fail-loud wording: how to say "we couldn't get this resort's data"

This project's #1 trust rule is **fail loud, never silently substitute a default**
(owner-confirmed; the scars are the 2300 m snow-line default that silently applied
Val Thorens' base elevation to other resorts, and any "use a default when real data
is missing" path). That rule is enforced by `snowforcast-change-control` and
`snowforcast-data-integrity-and-validation` — this skill owns only the **words** a
human sees when data is genuinely missing.

**Never** show a blank cell, a zero, or a plausible-looking number when the real
value failed to load. A blank reads as "no snow" and a fake number reads as truth —
both are silent lies for a forecast product.

| Situation | ❌ Never | ✅ Say this (visible, honest) |
|-----------|---------|------------------------------|
| Scrape/fetch failed for a resort | (blank) / "0 cm" | "Couldn't get Val Thorens' forecast right now — try again later." |
| One elevation missing | silently show another | "No summit data for this resort yet." |
| A value is a labelled fallback | show it as if real | "Estimated (live data unavailable)" badge next to it |
| Stale data | show as current | "Last updated 2 days ago — may be out of date." |

Wording principles:
- **Name what's missing and why-ish**, in one friendly sentence. "Couldn't get X"
  beats a spinner that never resolves or a silent zero.
- A visible, honest "we don't know" **builds** trust; a confident wrong number
  destroys it. When in doubt, say less but say it true.
- Any value that is a fallback/estimate must **carry that label in the words**, not
  just in a code comment. If the UI can't distinguish real from estimated, it must
  say "estimated".

---

## Quick-reference cheat sheet

| You have (data) | You must say (UI) |
|-----------------|-------------------|
| `snowfall` (cm) | "~15 cm" (headline, with estimate cue) |
| `snowfall_range [low,high]` | "Likely low–high cm; could be as low as low" |
| tight range | "Forecasts agree" |
| wide range | "Forecasts disagree / very uncertain" |
| `snowfall_sources` (e.g. 7) | "7 forecasts checked" (not "7 models") |
| `snowfall_models` (per-model) | only in an opt-in details view, names OK there |
| model names (AROME/ICON/ECMWF/GFS/MET Norway) | "several independent forecasts" — never raw on first glance |
| `freezing_level_min/max` | a snow-line sentence, never a raw metre number |
| water mm | convert to cm first, or don't show it |
| p10 / p90 | "best case / worst case" |
| missing/failed data | "Couldn't get this — try later", never blank or 0 |
| internal slug / scrape alias | display name with spaces |
| bot / mid / top | base / mid-mountain / summit |

---

## When NOT to use this

| If you are… | Use instead |
|-------------|-------------|
| doing the actual model math / blending / median / spread logic | `snowforcast-consensus-and-model-reference` |
| coding the front-end that DISPLAYS these words (which HTML is real, how it fetches JSON, rendering fragility) | `snowforcast-frontend-ui-contract` |
| writing the WhatsApp link-preview / Open Graph card copy specifically | `snowforcast-link-preview-and-positioning` |
| deciding whether the uncertainty range is trustworthy / calibrated | `snowforcast-calibration-and-honest-uncertainty` |
| changing scraper, JSON fields, or fallback behaviour | STOP → `snowforcast-change-control` first |
| checking that the underlying data is even correct | `snowforcast-data-integrity-and-validation` |

This skill defines the *words*. It never authorises changing the frozen JSON
contract, the scraper, or the canonical HTML — those go through change control.
When migrating existing UI text to these standards, pair this skill with the
front-end contract so you don't break the fragile rendering.

---

## Provenance and maintenance

Facts here were verified against the repo on **2026-07-08**. Volatile items and how
to re-check them:

```bash
# Resort roster + base/mid/summit elevations (the resort table)
grep -n "elevation_heights" -A 12 generate_static_data.py

# The 9 resorts as scraped, and their snow-forecast.com aliases
grep -n "snow_forecast_names" -A 12 generate_static_data.py

# Consensus method + the raw model names that must stay out of first-glance UI
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));print(d['Val-Thorens']['mid']['consensus'])"

# Fields the UI translates: snowfall / snowfall_range / snowfall_sources /
# snowfall_models / freezing_level_min/max
python3 -c "import json;d=json.load(open('data/all-forecasts.json'));print(list(d['Val-Thorens']['mid']['extended']['extended_forecast'][3].keys()))"

# The single 1mm-water == 1cm-snow assumption in code
grep -n "1cm snow" multi_model.py

# CURRENT known gap: raw model names shown on first glance (should become lay text)
grep -n "AROME\|MET Norway" forecast.html forecast_new.html
```

If any of these drift, update the matching section and re-stamp the date.
Everything about *how the numbers are produced* lives in the sibling skills listed
above — keep the meteorology facts there and only the *wording* here (one home per
fact).
