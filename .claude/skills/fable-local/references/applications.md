# Applying Fable Orchestration to Real Work

How to map incoming requests — app features, games, audits, research, "build me
X" — onto the patterns in `patterns.md`. Each recipe names the native workflow
(Fable sessions) and the emulation shape (any model). The patterns are
domain-agnostic; only the prompts, modalities, and verification lenses change.

## Task-shape classifier (start here for "anything requested")

Classify the request by shape, not by domain:

| Shape | Signature | Pattern combo | Native workflow |
|---|---|---|---|
| Search-shaped | "find/audit/check all X" | Survey → multi-modal fleet → loop-until-dry → verify → critic | `exhaustive-audit` |
| Build-shaped | "add/build/create X" | Understand → design panel → parallel implement → integrate → verify loop | `feature-build` |
| Decide-shaped | "which/how should we X" | Judge panel (diverse attempts → rubric judges → synthesis) | `judge-panel` |
| Question-shaped | "what is / is it true that X" | Modality-diverse sweep → per-claim fact-check → cited synthesis | `research-sweep` |
| Fix-shaped | "X is broken" | Repro → diverse hypothesis lenses → empirical confirm/refute → fix → verify repro gone | `debug-hunt` |
| Converge-shaped | "make this check pass" | Checker as oracle → cluster failures → parallel fixers → re-check, stop on 2 no-progress rounds | `fix-until-green` |
| Transform-shaped | "migrate/port/backfill all X" | Codemod spec agreed once → batch transforms in worktrees → integrate → consistency critic → converge | `codebase-migrate` |
| Measure-shaped | "make X faster" | Baseline → profiled hotspots → attempts self-measure in worktrees → accept only quantified wins | `perf-optimize` |
| Tune-shaped | "playtest/balance X" | Persona fleet plays the build → verify by replay → assess vs targets → tune → replay | `playtest-balance` |
| Distill-shaped | "document X so others can run it" | Investigate like a principal engineer → author skills in parallel → 3-lens review → fix | `skill-library` |
| Prove-shaped | "did the change actually work?" | Map affected flows → drive each for real → adversarial edge pass → evidence-backed verdict | `verify-feature` |
| Guard-shaped | "keep it green / it broke overnight" | Health checks → diagnose mechanical vs deep → nested fix-until-green → re-verify | `self-heal` |

Mixed requests decompose: "build a game" = decide-shaped (design) then
build-shaped (implement) then search-shaped (playtest/bug sweep). Run the
shapes in sequence, feeding each phase's output into the next.

## Application & web development

- **A feature end-to-end**: `feature-build` with `{request, paths, testCommand}`.
  Emulation: understand-phase readers in parallel (one per subsystem), a
  judge-panel for the design, then implement work items — parallel only when
  files are disjoint (use `isolation: "worktree"` for parallel mutators),
  sequential otherwise — and a verify loop (tests + adversarial reviewer with an
  integration-seams lens: parallel-written code fails at the seams).
- **Bug hunt / regression sweep**: one concrete symptom goes to `debug-hunt`
  `{symptom, repro?, paths?}` (depth-first elimination). Breadth-first sweeps
  for many unknown bugs across a surface go to `exhaustive-audit` with a
  "reproduction" lens — a bug nobody can reproduce is unverified, not confirmed.
- **Performance work**: `perf-optimize` with `{target, benchCommand,
  minGainPct?}` — every change must clear a noise-aware measurement gate.
  No benchmark command yet? First find suspects with `exhaustive-audit`
  (`lenses: ["correctness", "measurement", "reproduction"]` — a perf finding
  without numbers is a vibe), then build the benchmark and run `perf-optimize`.
- **API/contract review**: finders sharded by route/endpoint; add a modality
  that reads *consumers* of each endpoint, not just handlers — contract bugs
  live on the caller side.

## Game development

Games are the same shapes with different verification:

- **Game design / mechanics decisions**: `judge-panel` with angles like
  `["player-fun-first", "scope-minimal-first", "systems-depth-first"]` and a
  rubric weighting fun, scope realism, and implementability. Judges must argue
  from the player's seat, not the architect's.
- **Prototype slice**: `feature-build`. Set `testCommand` to whatever runs the
  game headless or in CI; if nothing does, the verify phase's first work item
  should CREATE that harness — an unrunnable game can't be verified.
- **Playtest & balance loop**: `playtest-balance` with persona list and
  `runCommand` — diverse player-persona agents actually run the build, hard
  findings (crash/soft-lock/exploit) must replay before driving tunings, and
  the fleet replays after each balance pass until targets hold.
- **Playtest sweep** (the game-dev exhaustive-audit): finders whose modality is
  *execution* — each plays/drives a scripted session (headless run, input
  scripts, sim ticks) hunting for crashes, soft-locks, exploits, and
  degenerate strategies; other finders read entity/config data for balance
  outliers (stats orders of magnitude apart, dead content nobody can reach).
  Verify with a reproduction lens: a reported exploit must replay.
- **Content generation at scale** (levels, entities, dialogue, items):
  pipeline each content item through generate → validate (schema + playability
  check by an execution agent) → tune. Dedup generated content vs-seen by
  normalized structure, or the fleet converges on ten variants of the same idea.
- **Balance passes**: judge panels over simulated outcomes — attempts propose
  tuning changes, judges score against sim results the attempts must include.

## Research, writing, and non-code work

- **Deep research**: `research-sweep`. Always include the contrarian modality —
  a sweep with no searcher hunting counter-evidence produces confident wrongness.
- **Docs/content production**: judge-panel for the outline (angles: newcomer /
  expert / maintainer), then per-section writers in a pipeline with a
  fact-check stage against the actual code, then one synthesizer for voice.
- **Codebase onboarding map**: the Understand phase of `feature-build` standing
  alone — parallel readers per subsystem, synthesizer merges into an
  architecture doc, completeness critic checks no subsystem was skipped.

## Needs that are parameterizations, not new workflows

Before inventing a new orchestration, check this table — these common asks are
existing workflows with the right args:

| Need | Use |
|---|---|
| Security audit | `exhaustive-audit` with `lenses: ["injection", "authz", "secrets", "input-validation"]` and a security goal |
| PR / branch review | `exhaustive-audit` with `goal: "issues introduced by this branch vs main"` and `paths` = changed files |
| Flaky-test hunt | `exhaustive-audit` with an execution-heavy goal ("run the suite repeatedly, record intermittent failures") |
| Competitive / market research | `research-sweep` with modalities like competitor docs, changelogs, pricing, criticism, recency |
| Codebase onboarding map | the Understand phase pattern standalone (parallel readers → synthesizer → critic) |
| Changelog / release notes | `judge-panel` with the git range in the task and an accuracy/completeness/audience rubric |
| Module-scoped tests or docs | `feature-build` with the request naming the module (repo-wide backfill → `codebase-migrate`) |
| Dependency upgrade | `fix-until-green` with the build/test command as the check, bump as round zero |

## Cross-cutting rules (every domain)

1. Verification lenses adapt to the domain; the *structure* (independent,
   refute-biased, majority-of-valid-verdicts) never does.
2. The completeness critic is domain-blind: task + surface + deliverable →
   "what's missing". Never skip it on exhaustive runs.
3. Execution beats reading everywhere: run the code, replay the exploit,
   benchmark the claim. A modality list without execution is a red flag.
4. Scale to the ask (see SKILL.md's scale table) — a one-file question never
   earns a fleet, and "thoroughly/audit/all" earns loop-until-dry.
