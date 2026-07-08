---
name: snowforcast-failure-archaeology
description: >-
  Read-only archive of every major dead end in the snowforcast project, each as
  symptom -> root cause -> evidence -> status. Load this BEFORE attempting a
  "fix" that feels like it should already have been tried, before re-opening a
  settled decision, or when you catch yourself about to add debug logging /
  "!important" CSS to forecast.html, rotate the Weather Unlocked key, "fix" the
  skill-weighted consensus, or delete a stale HTML file. Triggers: "hasn't this
  been fixed before", "why is forecast.html like this", "invisible-table rendering
  history", "leaked API key", "why skill weighting is dormant / history of the
  all-MAE-0 state", "2300 m snow-line default history", "duplicate commits", "dead
  HTML files", "index-static.html". NOT for writing new rules (use
  snowforcast-change-control) and NOT for triaging a brand-new live symptom (use
  snowforcast-debugging-playbook, which owns the raw live-symptom strings).
---

# snowforcast Failure Archaeology

This is the **read-only archive** of things already tried in this repo and their
verdict. Its one job: stop you (human or agent) from re-running a solved dead end
or re-opening a settled decision.

## How to use this skill

1. You are about to make a change that "feels obvious" or that you suspect was
   "probably already done." **Search this file first** for the symptom.
2. Each entry has a **Status**. Respect it:
   - `FIXED` — the fix is in `main`. Do not re-do it. If it looks unfixed, you are
     probably looking at a stale checkout or a different file.
   - `OPEN` — genuinely unsolved. You may work on it, but read the root cause so
     you do not repeat the same wrong approach.
   - `RESOLVED (cosmetic)` — harmless history noise; leave it alone.
   - `DEAD WEIGHT` — safe-to-delete artifact, still present because nobody pruned it.
   - `LATENT RISK` — fixed once but the underlying fragility can bite again.
3. This file **describes history**. It does not set rules and does not authorize
   changes. To act, go through the sibling skills below.

### When NOT to use this skill (go here instead)

| You want to... | Use this sibling skill instead |
|---|---|
| Know the current rule/gate before editing | `snowforcast-change-control` |
| Triage a NEW live symptom on the site or in the data | `snowforcast-debugging-playbook` |
| Understand why the system is shaped this way | `snowforcast-architecture-contract` |
| Change the front-end safely | `snowforcast-frontend-ui-contract` |
| Fix snow-forecast.com scraping breakage | `snowforcast-scraper-resilience-campaign` |
| Reason correctly about the consensus numbers | `snowforcast-consensus-and-model-reference` |
| Evaluate forecast skill rigorously | `snowforcast-forecast-skill-methodology` |

Do not duplicate facts owned by those skills here. This file only records dead ends.

### Terms defined once

- **Canonical front-end**: `forecast.html`. It is the target of the `index.html`
  redirect and a static build in `vercel.json`. `forecast_new.html` is the live
  dark-theme alternate (linked from `forecast.html`, fetches the same JSON). Every
  other `*.html` is an experiment.
- **Frozen JSON contract**: `data/all-forecasts.json`, fetched by both live
  front-ends directly from `raw.githubusercontent.com/.../main/data/all-forecasts.json`.
  Fields may be added; existing fields must never change or vanish.
- **Bot commit**: an automated `Update forecast data - <date>` commit from the
  3-hourly GitHub Action. The repo has ~2016 commits; only ~78 are human work.
- **Revert**: a commit that restores a prior version because the newer one broke prod.
- **MAE**: mean absolute error, the skill scorer's accuracy metric (cm of snow).
- **Proxy truth / observation proxy**: using a forecast as a stand-in for real
  measured snowfall because no measured snowfall is collected. This is the core
  flaw of the skill scorer (see entry 3).

---

## 1. `forecast.html` rendering-fragility saga

**Status: FIXED by revert — LATENT RISK remains.**

**Symptom.** The forecast table / grid renders blank (invisible) in production
even though the data is present.

**What was tried, in order (all on 2025-11-22, all touching `forecast.html`):**

| Time (+0200) | Commit | What it did |
|---|---|---|
| 11:45 | `78eba5d5` | "Fix forecast table visibility issue" |
| 11:49 | `a7993245` | "Add debug logging for forecast visibility" |
| 11:52 | `89ab11c8` | "Fix forecast grid visibility with important CSS rule" (an `!important` band-aid) |
| 11:58:03 | `6ddcfc08` | "Revert forecast.html to working version (6bf2089)" |
| 11:58:41 | `28f1070d` | "Revert forecast.html to version 66c62ab" |

Five commits in ~13 minutes. The pattern was **flail**: add logging, slap
`!important` on CSS, then give up and revert to a known-good version. A separate,
later instance of the same reflex: `4ebd0c9e` (2025-11-29 09:56 "Simplify forecast
display…") was reverted 2 minutes later by `d7cd38fc` (09:58 "Revert to previous
design with AM/PM/Night sections…").

**Root cause.** `forecast.html` is a **96 KB monolithic single point of failure**
(verify: `wc -c forecast.html`). All markup, CSS, and JS live in one file with
**no test coverage** — there is no test framework in this repo (`test_openmeteo.py`
and `test_vt_scrape.py` are manual network scripts, not a suite). A small CSS or
DOM change can hide the entire grid, and nothing catches it before deploy. The
only way the author could recover was to revert wholesale.

**Evidence.** Commit list above; `forecast.html` is ~96 KB; `git log --oneline
forecast.html` shows the churn.

**Verdict / do-not-repeat.** The symptom is fixed in `main`. **Do NOT** "fix" a
future `forecast.html` visibility problem by adding debug logging or `!important`
rules — that path was already walked and abandoned in 13 minutes. If the grid goes
blank again, the proven recovery is **revert to the last known-good version of the
file**, then make the change in a small, verifiable step. The latent risk (one
giant untested file) is real; any structural fix belongs to
`snowforcast-frontend-ui-contract`, gated by `snowforcast-change-control`.

---

## 2. Weather Unlocked API-key leak

**Status: impact reduced, but key NEVER rotated/purged — history rewrite still warranted (OPEN).**

**Symptom.** A live third-party API credential was committed to the repo in
plaintext.

**Timeline & evidence (verified from git):**

| Commit | Date | What happened |
|---|---|---|
| `d65ce5a2` | 2026-01-03 | "Add Weather Unlocked API integration" — committed `weatherunlocked_integration.py` with the credentials as **default fallback values** in `__init__`. |
| `bfff7287` | 2026-07-06 | "…remove committed API credentials…" — scrubbed the **working tree only**. |
| `06121221` | 2026-07-06 | "…remove Weather Unlocked" — deleted `weatherunlocked_integration.py` (264 lines) and `WEATHERUNLOCKED_SETUP.md`. |

The credentials are still **recoverable from git history**. Verify:

```bash
git show d65ce5a2:weatherunlocked_integration.py | grep -iE "app_id|app_key"
```

This prints the App ID and key (both REDACTED here — do not copy live secrets
into this skill) as `os.environ.get(..., '<literal>')` default fallbacks. The
values are ~8-char and 32-char hex respectively; treat them as compromised and
rotate at the vendor. Scrubbing the working
tree (`bfff7287`) and deleting the file (`06121221`) do **not** remove them from
history — anyone with the repo can recover them.

**Root cause.** Secrets were hardcoded as env-var default fallbacks instead of
being required from the environment with no default.

**Status detail.**
- Vendor Weather Unlocked reportedly shut down 2026-06-30 (owner-reported; not
  verifiable from the repo), which is why `06121221` removed the integration. This
  **reduces** the blast radius but does not eliminate it.
- The key was **never rotated or purged from history**. Because the vendor is gone,
  rotation may be moot, but the credential is still exposed in every clone.

**Verdict / do-not-repeat.** Do not assume this is closed just because the file is
gone. If you ever need it truly gone, a **history rewrite** (e.g. `git filter-repo`)
is still warranted — but that is a destructive, coordinate-with-owner operation and
is **out of scope for this read-only skill**; route it through
`snowforcast-change-control` and `snowforcast-build-deploy-and-operations`.
Never again commit a secret as an env-var default fallback.

> Note (ground truth): the recoverable literal was verified in
> `weatherunlocked_integration.py`. `bfff7287`'s message also mentions `app.py`
> credential cleanup, but the literal key string was **not** located in `app.py`
> history — treat "key was in `app.py`" as unconfirmed.

---

## 3. Dormant / degenerate skill weighting

**Status: OPEN — "skill-weighted consensus" is a plain median today.**

**Symptom.** `data/skill.json` shows `mae: 0.0` for every model at every resort,
and `skill_weights` is `null` everywhere in `data/all-forecasts.json`. The
consensus advertised as "skill-weighted" is actually an **unweighted median**.

**Evidence (verify):**

```bash
# Every model, every resort, MAE 0.0:
grep -A1 '"mae"' data/skill.json
# skill_weights is null everywhere the consensus is emitted:
grep -c '"skill_weights": null' data/all-forecasts.json   # -> 27
# The code itself admits it falls back to a plain median:
sed -n '15,18p' multi_model.py
```

`multi_model.py` states: *"until that file has data every model gets equal weight
and the result is a plain median."* The intended weight formula is
`weight = 1 / (MAE + 0.5)` (`multi_model.py`, `load_skill_weights`), but with all
MAE = 0.0 there is nothing to differentiate models.

**Root cause.** `forecast_skill.py` uses the **day-of (lead == 0) forecast as its
"observation" proxy** and then scores each model against it — i.e. it compares a
model **against its own forecast**. See `forecast_skill.py:78-81`:

```python
if lead == 0:
    # Day-of forecast = observation proxy (keep the latest commit's value)
    observations.setdefault(date_str, snowfall)
elif 1 <= lead <= MAX_LEAD_DAYS:
    ...
```

Because the current data effectively has a single model (`openmeteo_best_match`)
whose day-of value equals the value being scored, the error collapses to 0.0.

**Verdict / do-not-repeat.** Do **not** "turn on" skill weighting by tweaking the
formula or forcing non-null weights — the numbers feeding it are self-referential
and would produce meaningless weights. The real gap is that the project **collects
no observed (measured) snowfall labels**. True skill weighting needs those labels.
This is genuinely unsolved; the honest framing and the rigorous evaluation method
live in `snowforcast-forecast-skill-methodology` and
`snowforcast-calibration-and-honest-uncertainty`. Reason about what the numbers
currently mean via `snowforcast-consensus-and-model-reference`.

---

## 4. Botched-rebase / duplicate commits

**Status: RESOLVED (cosmetic) — history noise only.**

**Symptom.** The same change appears committed twice.

**Evidence (verified):**

- Webcam modal committed twice: `21713311` (2025-10-28 10:40) and `77f62483`
  (2025-10-28 10:46), both "Add live webcam modal and resort information links";
  then `e71c4901` (10:51) "Fix broken resort URLs" cleaning up the aftermath.
- 3-resort batch committed twice: `ff6fe1fd` (2025-12-23 15:39) "Add three new
  ski resorts: Gudauri, St-Anton, and Alpe d'Huez" and `bf932d4c` (15:46) "Add
  three new resorts to HTML pages: …".

**Root cause.** Almost certainly a rebase/merge fumble producing duplicate commits.

**Verdict.** Cosmetic. The working tree is correct. **Do not** attempt to rewrite
history to "clean this up" — it changes hashes for zero functional gain and risks
breaking the deployed `raw.githubusercontent.com` JSON path. Leave it.

---

## 5. Data-file merge conflicts from source churn

**Status: RESOLVED.**

**Symptom.** Merge conflicts in committed data files when remote (bot) forecast
updates collided with local resort/integration work.

**Evidence (verified):** `6b27a441` (2025-12-29) "Merge: Resolve data file
conflicts, keep version with Mount Hermon"; `53083b45` (2026-01-03) "Merge remote
changes with Weather Unlocked integration". These are the repo's only two merge
commits.

**Root cause.** The 3-hourly bot commits `data/*.json` constantly, so any local
branch that also touches data files conflicts on merge.

**Verdict.** Resolved as recorded. If it happens again, prefer the branch that
preserves the newest scraped data plus your intended additive change. Data-file
handling rules live in `snowforcast-change-control` and
`snowforcast-data-integrity-and-validation` — do not invent your own resolution
policy here.

---

## 6. Stale / dead artifacts (unpruned)

**Status: DEAD WEIGHT — present but unused.**

The following files are tracked in git yet play no role in the live product.
Verify tracking with `git ls-files | grep -E '<name>'`.

| Artifact | Why it is dead |
|---|---|
| `README_OLD.md` | Superseded by `README.md`. |
| `forecast-dark2.html`, `comprehensive.html`, `vt_page.html` | Front-end experiments; not canonical (only `forecast.html` + `forecast_new.html` are live). |
| `index-static.html` | **Broken by construction** — it loads `forecast.html` as BOTH a stylesheet (`<link rel="stylesheet" href="forecast.html">`) AND a script (`<script src="forecast.html">`). It cannot work; verify with `cat index-static.html`. |
| `analyze_html.py` | One-off analysis script, not part of the pipeline. |
| `__pycache__/` | Local build cache, includes a stale `weatherunlocked_integration.cpython-310.pyc` from the removed integration. **Correction to prior lore:** this dir is **git-ignored** (`__pycache__/` in `.gitignore`) and is **NOT committed** — it exists only in the working tree. Verify: `git ls-files | grep pycache` returns nothing. |

**Verdict.** Safe to delete, but deletion is a change like any other and must go
through `snowforcast-change-control`. This skill only records that they are dead;
it does not authorize pruning. Do not treat any of these as canonical or copy from
them — see `snowforcast-frontend-ui-contract` for which HTML is real.

---

## 7. Auto-generated "Figma-inspired redesign" PRs — merged, then force-push-wiped

**Status: CONFIRMED (archaeology sweep, 2026-07-08) — merged work vanished from history via a force-push.**

**Symptom.** Two byte-identical auto-generated "Figma-inspired redesign" pull
requests. PR #1 was **self-merged ~14 s after opening** (`2026-07-06
12:50:48Z → 12:51:02Z`, via the GitHub API), i.e. effectively unreviewed; PR #2
(identical diff) was opened ~31 min later and **left dangling open**.

**Root cause (the real lesson).** The merged redesign work is **not in `main`'s
history**: the merge commit `d6e679e1` is merged on GitHub yet is **NOT an
ancestor of `HEAD`**, and `forecast.html` at HEAD contains **zero** Figma
markers. A later **force-push onto `main` from an older base rebased past the
merge**, silently deleting shipped work. So this is two failures at once: (a) an
unreviewed 14 s self-merge to the canonical front-end, and (b) a force-push that
made a merged, "shipped" change disappear.

**Evidence.** `d6e679e1` merged on GitHub but `git merge-base --is-ancestor
d6e679e1 HEAD` fails; `grep -ic figma forecast.html` → 0. (Local `git log` shows
no figma/redesign commit precisely because the force-push erased it — the absence
IS the evidence, not a contradiction.) Requires the GitHub API/`gh` to see the PR
side; `gh` is not installed here, so the PR timestamps came from
`curl .../repos/avielj/snowforcast/pulls?state=all`.

**Why it matters.** An unreviewed auto-merge to the **canonical front-end**
(`forecast.html`) is the entry-1 rendering saga waiting to happen; and treating
`main` as force-push-able means even a *reviewed* merge can evaporate.

**Verdict / do-not-repeat.** (1) Treat any auto-generated cosmetic PR against
`forecast.html` / `forecast_new.html` as high risk — never auto-merge, enforce a
real review dwell. (2) Treat `main` as **append-only: never force-push it**; land
work via merge commits so it cannot be rebased away. The gate belongs to
`snowforcast-change-control`; the safe-editing procedure to
`snowforcast-frontend-ui-contract`.

---

## 8. The 2300 m snow-line / elevation default (the flagship incident)

**Status: FIXED (per-resort elevation config) — LATENT RISK: the "default when
missing" class can recur.**

This is the origin incident behind the whole project's top rule and the narrative
that `snowforcast-change-control` (Rule 0), `snowforcast-architecture-contract`
(§4), and `snowforcast-data-integrity-and-validation` (Check B3) all point to. It
lives here.

**Symptom.** Resorts *other than* Val Thorens displayed a snow line / elevation of
**2300 m** — plausible-looking numbers that were actually wrong. Val Thorens' own
`bot` (base) elevation is 2300 m; it was silently standing in for every resort.

**Root cause.** A hardcoded elevation / snow-line **default** was applied when a
resort's real per-elevation height was missing, instead of failing loud. Because
2300 m is a believable ski elevation, nobody could see it was fabricated — the
exact "silently-wrong beats a visible gap" failure this project now forbids.

**The fix that shipped.** Per-resort elevations now come from each resort's **own
config**, never a shared default. Verify the surviving, *legitimate* config:

```bash
grep -n "2300" generate_static_data.py
# -> 'Val-Thorens': {'bot': 2300, 'mid': 2800, 'top': 3230}  (~line 485, 2026-07-08)
```

The `2300` you see today is **correct** — it is Val Thorens' real base height in
its own config, not the leaked default. Do **not** "fix" it.

**Evidence it stays fixed.** `snowforcast-data-integrity-and-validation` Check B3
asserts `extended.elevation_used` equals that resort/elevation's own height from
the `elevation_heights` table, so a re-leak is detectable. On 2026-07-08:
VT-bot=2300, Cervinia-bot=2050, Monterosa-mid=2200 (distinct — no leak).

**Verdict / do-not-repeat.** Never reintroduce a "use a default when the real value
is missing" path — emit a visible error / absent marker instead. The enforceable
rule is owned by `snowforcast-change-control` (Rule 0 — FAIL LOUD, never silently
substitute a default); detection is owned by
`snowforcast-data-integrity-and-validation` (Check B3); the lay wording for a
genuine no-data state is owned by `snowforcast-meteorology-for-laypeople`. This
entry is the narrative those skills point to.

---

## 9. Abandoned branch of ~20 "does my write even land?" commits

**Status: CONFIRMED (archaeology sweep, 2026-07-08) — effort discarded, branch never merged.**

**Symptom.** Remote branch `origin/ui/adapt-redesign-existing-functions` carries a
burst of ~20 throwaway commits in ~5 minutes (`15:58–16:03`) whose messages
degrade to `check branch write`, `tmp`, `check`, `test`, `no`, `stop`, `x`,
`why`, `accidental check`, `remove temporary check file`. The branch was never
merged to `main`; the work was discarded.

**Root cause.** These are not feature commits — they are an operator (or agent)
**probing whether a push/write actually lands**. Message text degrading to
single characters is the tell that the real problem was a **broken push /
permission / CI pipe**, not the code. Twenty commits were spent testing the pipe
instead of diagnosing it once.

**Evidence.** `git log --oneline origin/ui/adapt-redesign-existing-functions`
shows the burst (e.g. `15352ceb "check branch write"`); the branch is absent from
`main`'s first-parent history.

**Verdict / do-not-repeat.** When commit messages collapse to write-probes, **stop
and diagnose the pipe** (auth token, branch protection, remote, CI permission) —
do not spam commits to test it. This is the VCS-level twin of the fail-fast
discipline in entry 1: escalate to root-cause once the loop is obviously not
converging.

---

## Provenance and maintenance

All commit hashes, timestamps, file sizes, and line numbers below were verified
against the repo on **2026-07-08**. Volatile facts are date-stamped. Re-verify
with these one-liners (run from repo root):

```bash
# Entry 1 — rendering-fragility saga (5 commits, ~13 min, 2025-11-22):
git show -s --format='%h %ci %s' 78eba5d5 a7993245 89ab11c8 6ddcfc08 28f1070d
git show -s --format='%h %ci %s' 4ebd0c9e d7cd38fc      # AM/PM revert pair
wc -c forecast.html                                       # ~96597 bytes, monolith

# Entry 2 — Weather Unlocked key still in history:
git show d65ce5a2:weatherunlocked_integration.py | grep -iE "app_id|app_key"
git show -s --format='%h %ci %s' d65ce5a2 bfff7287 06121221

# Entry 3 — dormant skill weighting:
grep -A1 '"mae"' data/skill.json                          # all 0.0
grep -c '"skill_weights": null' data/all-forecasts.json   # 27
sed -n '78,84p' forecast_skill.py                          # lead==0 proxy
sed -n '15,18p' multi_model.py                             # "plain median" admission

# Entry 4 — duplicate commits:
git show -s --format='%h %ci %s' 21713311 77f62483 e71c4901 ff6fe1fd bf932d4c

# Entry 5 — data-file merges:
git show -s --format='%h %ci %s' 6b27a441 53083b45
git log --oneline --merges                                # exactly these two

# Entry 6 — dead artifacts still tracked / pycache ignored:
git ls-files | grep -E 'README_OLD|forecast-dark2|comprehensive.html|vt_page|index-static|analyze_html'
git ls-files | grep pycache                                # (empty = ignored, not committed)
cat index-static.html                                      # stylesheet AND script = broken

# Entry 7 — Figma PRs merged then force-push-wiped (needs GitHub API for the PR side):
git merge-base --is-ancestor d6e679e1 HEAD && echo "in history" || echo "WIPED (not an ancestor)"
grep -ic figma forecast.html                               # 0 — no Figma markers survive at HEAD
curl -s "https://api.github.com/repos/avielj/snowforcast/pulls?state=all" | grep -E '"(number|state|merged_at)"'

# Entry 8 — 2300 m elevation default: legit per-resort config survives, no leak:
grep -n "2300" generate_static_data.py                     # Val-Thorens bot=2300 (its own height, ~:485)
python3 -c "import json;print(json.load(open('data/val-thorens-mid.json')).get('extended',{}).get('elevation_used'))"

# Entry 9 — abandoned write-probe branch (~20 junk commits, never merged):
git log --oneline origin/ui/adapt-redesign-existing-functions 2>/dev/null | head -20
git branch -r --contains 15352ceb 2>/dev/null | grep -q main && echo "in main" || echo "never merged"
```

**Maintenance rule.** When a new dead end is settled, add it here as
symptom -> root cause -> evidence -> status, with a one-line re-verify command.
Never delete a settled entry — its whole value is stopping the next person from
re-running it. If an `OPEN` item gets truly solved, flip its status to `FIXED` and
record the fixing commit; do not erase the history of how it was solved.
