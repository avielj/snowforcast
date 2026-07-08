---
name: snowforcast-docs-and-writing
description: >-
  Load before creating or editing ANY prose doc in the snowforcast ski-forecast
  dashboard — README.md, DEPLOYMENT.md, OPENWEATHER_SETUP.md, setup/how-to text,
  release notes, or a proposed CONTRIBUTING/LICENSE/CHANGELOG. Keeps docs true to
  the code (several already drift) and writes new docs in the project's terse
  solo-dev voice. Triggers: "update the README", "fix the docs", "write setup
  instructions", "document the deploy", "how many resorts", "add a CONTRIBUTING /
  LICENSE / changelog", "the docs say X but the code does Y", "explain the API
  budget", "is this doc accurate". USE THIS to reconcile a doc with reality before
  copying its numbers — snowforcast docs have repeatedly lagged the code. Do NOT
  use for user-facing UI copy or the shared-link card (see sibling skills), and
  never for creating docs the user did not explicitly ask for.
---

# snowforcast Docs and Writing

Keep the docs honest and write in the house voice. This project is a solo dev's
ski-forecast dashboard; its Markdown files have **repeatedly fallen behind the
code**, and copying a stale number into a new doc propagates a lie. Your job when
touching docs: verify against the code and data FIRST, then write plainly.

Verified against the repo on **2026-07-08**. Re-run the checks in
"Provenance and maintenance" before trusting any number below.

---

## The one rule that overrides everything

**When a doc and the code/data disagree, the code and data win. Verify, then
write.** The authority order for facts in this repo:

1. `data/metadata.json` — the roster of resorts and elevations actually produced.
2. The Python that ran: `generate_static_data.py` (the live CI scraper), the
   `.github/workflows/*.yml` schedules, `app.py` (secondary Flask path).
3. The front-end HTML that ships: `forecast.html` + `forecast_new.html`.
4. Only then, existing Markdown — treat it as a *claim*, not a *source*.

Never carry a figure from one Markdown file into another without confirming it at
its source. Do not "tidy up" a doc by rephrasing a wrong number more fluently.

---

## Known DOC DRIFT — fix on contact, never propagate

These are confirmed wrong as of 2026-07-08. If you edit a file containing one of
these, correct it; if you cite one of these files, do not copy the wrong figure.

| File | Drift | Ground truth | Consequence |
|------|-------|--------------|-------------|
| `OPENWEATHER_SETUP.md` | "6 resorts × 3 elevations = 18 calls" and "~450 calls/day" | **9 resorts × 3 = 27 combos** (see `data/metadata.json`, `generate_static_data.py` resorts dict). Per-run scrape/API surface is ~27, not 18 | Understates the OpenWeather free-tier risk: the budget math is built on 18 and hides how close a busy day gets to the **1,000 calls/day** free cap |
| `DEPLOYMENT.md` | Lists only "Val Thorens & Cervinia", 6 data files, "Multi-Resort Support: Val Thorens & Cervinia" | **9 resorts** now ship (Val-Thorens, Cervinia, Via-Lattea, Monterosa-Ski, Gudauri, St-Anton, Alpe-d-Huez, La-Plagne, Mount-Hermon) | Anyone reading it underestimates scrape volume and the data surface |

When you correct the OpenWeather budget, recompute honestly: 9 resorts × 3
elevations = **27** scrape/API combinations per refresh run. Do NOT invent a new
"safe" total — state the per-run figure, note the cron cadence, and flag that
Vercel per-page-load calls plus the free 1,000/day cap is the real ceiling. If you
cannot verify the live cron cadence, say the number is derived, not measured.

The **current** `README.md` is accurate (9 resorts, port 8080, consensus described
correctly) — use it as the reference for the house voice and the true roster.

---

## Stale artifacts that are NOT canonical — never cite as current

| File | What it is | Why it lies |
|------|-----------|-------------|
| `README_OLD.md` | The full pre-rewrite README | Val-Thorens-ONLY, tells you to open `http://localhost:5000`. The app now defaults to **port 8080** (`app.py`: `PORT`, default 8080) and serves 9 resorts. Kept for history; never link users to it |
| `cron_examples.txt` | Sample crontab lines | Hardcodes `cd "/Users/avielj/Library/Mobile Documents/com~apple~CloudDocs/Snowforcast"` — a path that does **not** match this checkout and won't copy-paste. Also predates GitHub Actions being the real refresh path. Do not present as a working recipe |

If a task asks "how do I run the cron", the real automation is the GitHub Actions
workflow (`.github/workflows/update-forecast.yml`), not `cron_examples.txt`. For
run/deploy specifics, defer to **snowforcast-build-deploy-and-operations** rather
than restating them here.

---

## Governance gaps — know they exist, do not fill unprompted

As of 2026-07-08 this repo has **none** of the following, and that is fine for a
solo project. Do NOT create them unless the user explicitly asks:

- No `CONTRIBUTING.md`, `LICENSE`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`.
- No `.github/ISSUE_TEMPLATE/` or `PULL_REQUEST_TEMPLATE` (`.github/` holds only
  `workflows/`).
- **No root `CLAUDE.md` wired into this repo.** The `.claude/fable-local/`
  orchestration template is present but **unapplied** — its
  `CLAUDE-policy-snippet.md` still literally contains the instruction
  "Delete this comment line", proving nobody adopted it. Do not treat that
  template as active project policy.

If asked to add governance, keep it minimal and match the solo-dev reality — no
multi-maintainer ceremony, no invented review boards, no CODEOWNERS for a
one-person repo.

---

## The parent `CLAUDE.md` is a DIFFERENT project — do not import its rules

There is a `CLAUDE.md` in the parent directory (`avielj-osx/CLAUDE.md`) for a
project called **"Ruflo"** with swarm/agent-routing conventions. That is **not**
this repo's memory. Only the **universal** rules carry over (e.g. never commit
secrets, read a file before editing, don't create docs that weren't requested).
Everything Ruflo-specific — swarm topologies, claude-flow CLI, agent routing
tables — is **out of force here** unless this repo grows its own `CLAUDE.md`
saying so. When in doubt, this repo's real behavioral rules live in
**snowforcast-change-control**, not the parent file.

---

## House voice — how snowforcast docs should read

Match `README.md`, not a corporate template.

- **Concise and practical.** State what to run and what happens. Skip preamble.
- **Solo-dev framing.** "You" = the owner or a ski buddy, not a team. No
  "our contributors", no onboarding funnels.
- **Real commands only**, copy-pasteable, verified to exist. Port 8080, real file
  names, real workflow paths.
- **Emoji are used sparingly** in existing docs (README/DEPLOYMENT use a few
  section markers). Fine to keep the existing style; do not carpet-bomb.
- **No invented governance ceremony** — no "please open an issue", no SLA, no
  contribution guidelines, unless they actually exist.
- **Honest about uncertainty.** If a number is derived or unverified, say so.
  Never dress a guess as a measured fact — this is a forecast product where
  silently-wrong numbers are the cardinal sin (see change-control).

### Absolute constraint (from project rules)
> NEVER create documentation files unless explicitly requested. Prefer editing an
> existing file. Do not save new docs to repo root — but also do not invent new
> docs at all without an explicit ask.

If a task would create a brand-new `.md` and the user did not clearly ask for a
new file, edit an existing doc or return the prose in your reply instead.

---

## Quick workflow when handed a docs task

1. Identify every factual claim you're about to write or preserve (counts, ports,
   URLs, cadences, file lists).
2. Verify each against the source in the authority order above. Prefer
   `data/metadata.json` and the Python over any Markdown.
3. Fix drift on contact; leave stale artifacts (`README_OLD.md`,
   `cron_examples.txt`) alone but never cite them as current.
4. Write in the terse solo-dev voice. No new files unless explicitly requested.
5. If the change touches an enforceable *rule* (not just describing one), route
   through **snowforcast-change-control** — do not encode new rules here.

---

## When NOT to use this skill

| You're doing… | Use instead |
|---------------|-------------|
| User-facing UI text, labels, tooltips in the dashboard | **snowforcast-frontend-ui-contract** |
| The WhatsApp / Open Graph shared-link preview card copy | **snowforcast-link-preview-and-positioning** |
| Defining or enforcing a hard rule (vs documenting one) | **snowforcast-change-control** |
| Wording meteorology concepts for laypeople | **snowforcast-meteorology-for-laypeople** |
| Explaining the consensus/model numbers themselves | **snowforcast-consensus-and-model-reference** |
| Install / run / env / deploy operational reference | **snowforcast-build-deploy-and-operations** |

This skill is about **prose accuracy and voice**. It owns no rules, no
architecture facts, and no UI contract — it points at the sibling that does. One
home per fact.

---

## Provenance and maintenance

All claims below verified against the working tree on **2026-07-08**. Re-run these
one-liners (from the repo root) before trusting a figure:

```bash
# Resort roster + count (source of truth for "how many resorts")
cat data/metadata.json                     # expect 9 resorts, 3 elevations
python3 -c "import json;print(len(json.load(open('data/metadata.json'))['resorts']))"

# Resorts the scraper actually loops over
grep -n "'\(Val-Thorens\|Cervinia\|Via-Lattea\|Monterosa-Ski\|Gudauri\|St-Anton\|Alpe-d-Huez\|La-Plagne\|Mount-Hermon\)':" generate_static_data.py

# Confirm OPENWEATHER_SETUP drift still present ("6 resorts" / "18 calls" / "~450")
grep -n "6 resorts\|= 18 calls\|450" OPENWEATHER_SETUP.md

# Confirm DEPLOYMENT still only names 2 resorts
grep -c "Via-Lattea\|Gudauri\|St-Anton" DEPLOYMENT.md   # expect 0 while drift stands

# Stale artifacts
grep -n "localhost:5000" README_OLD.md
grep -n "com~apple~CloudDocs/Snowforcast" cron_examples.txt   # hardcoded, non-matching path

# Real default port (README_OLD says 5000; app.py is authoritative)
grep -n "PORT'.*8080\|port=port" app.py

# Governance gaps (all should print nothing / not-exist)
ls CONTRIBUTING.md LICENSE CHANGELOG.md CODE_OF_CONDUCT.md 2>/dev/null
ls .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null
ls CLAUDE.md 2>/dev/null                    # no root CLAUDE.md expected
grep -rn "Delete this comment line" .claude/fable-local/   # template still unapplied
```

**Volatile facts to re-check:** resort count (grows), OpenWeather call budget
(depends on roster × cadence × Vercel traffic), cron cadence in
`.github/workflows/update-forecast.yml`, and whether the drift in
`OPENWEATHER_SETUP.md` / `DEPLOYMENT.md` has been fixed since this stamp. If a
grep above no longer matches, update this skill's tables to match reality.
