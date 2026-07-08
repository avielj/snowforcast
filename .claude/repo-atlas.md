# snowforcast — Repo Atlas (versioned-repo-atlas-steward)

Cross-run repo knowledge so a fleet cites facts instead of re-deriving them.
Each entry carries a **confidence** and an **expiry/re-check** trigger. A steward
opening a run should staleness-check entries against `git log` since the recorded
HEAD and file discoveries back at run end.

- **Atlas version:** 1 (2026-07-08)
- **Recorded HEAD at write:** `06121221` is the last real (non-bot) commit; HEAD
  moves every ~3h via the `github-actions[bot]` "Update forecast data" cron, so
  do NOT staleness-check against raw HEAD — check against the last non-bot commit:
  `git log --oneline | grep -v "Update forecast data" | head -1`.

## Build / run / test commands (VERIFIED 2026-07-08)

| Purpose | Command | Confidence | Re-check |
|---|---|---|---|
| Install deps | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` | verified (installs clean) | if requirements.txt changes |
| Deps are | `requests, beautifulsoup4, lxml, flask` (only) | verified | `cat requirements.txt` |
| Data generation (the live CI job) | `python3 generate_static_data.py` | verified imports; **slow, live-network, did not finish a 22s partial run** | re-time; watch for site rate-limits |
| Skill scoring (weekly CI job) | `python3 forecast_skill.py --days 45` | verified exit 0, stdlib-only | — |
| Run Flask app | `python3 app.py` (needs venv; bare system py3.10 lacks bs4) | verified | — |
| "Tests" | `test_openmeteo.py`, `test_vt_scrape.py` are **manual network scripts, NOT a suite** — no pytest, no assertions, no CI test gate | verified | — |
| Syntax gate (there is no CI one) | `python3 -m py_compile *.py` | verified (all 12 compile) | run before any commit |

## Deploy / hosting (VERIFIED 2026-07-08)

- **LIVE origin = Vercel: `https://snowforcast.vercel.app/forecast.html` → 200.**
- **GitHub Pages `https://avielj.github.io/snowforcast/…` → 404 (NOT enabled).**
  README/DEPLOYMENT.md describe Pages as a hosting path — it is documented but
  not live. Confidence: verified via curl. Re-check: `curl -so /dev/null -w '%{http_code}' <url>`.
- Static front-ends fetch `data/all-forecasts.json` from
  `raw.githubusercontent.com/avielj/snowforcast/refs/heads/main/...`, NOT from
  `app.py`. The GitHub-raw static path is the real one.

## Traps (each cost real time — see snowforcast-failure-archaeology)

| Trap | Detail | Confidence |
|---|---|---|
| Green Action ≠ correct data | The 3-hourly cron commits whatever it scrapes; a markup/rate-limit break commits empty/garbage JSON with no gate. | verified (no test gate) |
| `enhanced_snow_forecast_parser.py` is a STUB | Returns random sample data (lines ~175-232); does NOT parse `forecast-table__table`. Do not treat as a real parser. | verified (0 grep hits) |
| Real table-parsers | `generate_static_data.py`, `app.py`, `analyze_html.py`, `snow_forecast_parser.py` all key on `forecast-table__table`/row data-attrs — a markup change breaks them together. | verified |
| `all-forecasts.json` = frozen contract | Add fields additively only; never rename/remove — the deployed page reads it by raw URL and breaks silently otherwise. | verified (owner-confirmed) |
| Silent 2300m snow-line | Historical bug (fixed `bfff7287`): a missing elevation key fell back to Val Thorens' 2300m for other resorts. FAIL LOUD — never default. | verified |
| `main` is force-pushable | A merged redesign PR (`d6e679e1`) was force-push-wiped from history. Treat main as append-only. | verified |
| Committed secret in history | Weather Unlocked key/app_id recoverable at `d65ce5a2` (removed `bfff7287`); rotate, treat as compromised. Refer by SHA, never echo the literal. | verified |
| Canonical HTML | Only `forecast.html` (canonical) + `forecast_new.html` (alt) matter; `forecast-dark/dark2/modern.html`, `comprehensive.html`, `index-static.html` are experiments. | verified |
| Skill-weighting is dormant | `data/skill.json` MAE all 0.0, `consensus.skill_weights` null → the "skill-weighted consensus" is a plain **median**. Don't advertise "skill-weighted/AI". | verified |

## Flaky / network-dependent areas

- Anything touching `snow-forecast.com` (all real parsers), `open-meteo.com`,
  `ensemble-api.open-meteo.com`, `api.met.no` — intermittent failures are
  network/site, not code. No retry/backoff in `generate_static_data.py`
  (27 sequential no-delay requests, single UA, no cookie). Confidence: verified.

## Env quirks

- iCloud path with spaces ("Mobile Documents") — quote all shell paths; unquoted
  `xargs`/`ls` pipelines word-split (this bit `fable.local/install.sh`).
- System Python 3.10 lacks `bs4`; CI pins 3.11 and installs a hand-typed dep
  subset (`pip install requests beautifulsoup4 lxml`, omits flask) that can drift
  from `requirements.txt`. No lockfile.

## Maintenance

Update this atlas when a run discovers a new trap or a command changes. Bump the
version and the recorded-HEAD line. Do not let entries outlive their re-check
trigger silently — a stale atlas that reads authoritative is worse than none.
