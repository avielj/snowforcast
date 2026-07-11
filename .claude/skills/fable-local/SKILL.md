---
name: fable-local
description: Multi-agent orchestration harness that replicates Fable-model workflow capabilities (parallel fan-out, pipelining, adversarial verification, judge panels, loop-until-dry exhaustive search) using only the standard Agent tool. Use when a task is too big for one context — repo-wide audits, "find all X" sweeps, large migrations, multi-source research, or high-stakes artifacts that need independent verification. Do NOT use for single-file questions or quick lookups.
argument-hint: [task description] [--scale quick|standard|exhaustive]
---

# Fable-Local Orchestration

Run Fable-style multi-agent workflows on any model. You (the main agent) are the
workflow engine: you hold all control flow, state, and synthesis. Subagents are
stateless workers that receive self-contained prompts and return structured data.

This skill is model-agnostic by design: the same 12 orchestration shapes run
on Fable, Opus, Sonnet, or any Claude session. Two paths, one behavior:

- **Native fast path**: if this session has the Workflow tool, run the
  matching dynamic workflow from `.claude/workflows/` — `exhaustive-audit`,
  `judge-panel`, `research-sweep`, `feature-build`, `fix-until-green`,
  `debug-hunt`, `codebase-migrate`, `perf-optimize`, `playtest-balance`,
  `skill-library`, `verify-feature`, `self-heal` — passing the task as `args`.
- **Emulation path (no Workflow tool)**: classify the task shape
  (`references/applications.md`), then execute the matching numbered recipe in
  `references/emulation-playbook.md` — one step-by-step recipe per workflow,
  written to be followed literally, including a small-model mode (smaller
  fleets, synchronous barriers, mandatory state file) for Sonnet-class
  orchestrators. The sections below give the general engine contract; the
  playbook gives the per-shape procedure.

## When to use which scale

Parse `$ARGUMENTS` for the task and an optional `--scale` flag. If no scale is
given, infer it:

| Task shape | Scale | Fleet shape |
|---|---|---|
| Single-fact lookup, known file | none | Don't orchestrate — answer directly |
| Question spanning several files | `quick` | 1 Explore agent |
| Module-level review / search | `standard` | 3–5 parallel finders → adversarial verify |
| Repo-wide audit, "find ALL X", migration | `exhaustive` | Survey → sharded multi-modal fleet → loop-until-dry → diverse verify → completeness critic |
| Multi-source research question | `standard` | Modality-diverse searchers → per-claim adversarial fact-check → cited synthesis |
| Build a feature / app / game slice | `standard`+ | Understand readers → design judge panel → implement (worktrees if parallel) → integrate → test+review fix loop |
| High-stakes single artifact (design, hard fix) | `standard` | Judge panel: 3 attempts × 3 judges × 1 synthesizer |

## Core rules (the engine contract)

1. **You are the barrier and the loop.** There is no script engine. Maintain all
   state yourself: the seen-list, dry-round counter, verdict tallies, phase number.
   For runs with more than ~10 findings, persist state to a scratchpad file
   (`fable-state.json`) and re-read it rather than holding it in prose.
2. **Parallelism = multiple Agent calls in one message.** Launch each round of
   independent workers as a single message with N Agent tool uses (batch 5–10;
   prefer more rounds over one huge batch). Background mode (the default) enables
   pipeline overlap: when one worker's completion arrives, immediately launch its
   next-stage worker without waiting for siblings.
3. **Subagent prompts are self-contained.** Workers start with zero context.
   Every prompt must include: the goal, the exact scope (absolute file paths /
   shard list), what its siblings cover (so it stays out), the seen-list
   ("do not re-report these"), and the output schema.
4. **Output is data, not prose.** Every worker prompt ends with: "Your entire
   final message must be ONLY a JSON object matching this schema — no prose, no
   markdown fences." Parse defensively: strip fences, extract the first
   `{...}`/`[...]` block; on failure retry once, then drop that worker's
   contribution and note the gap.
5. **Dedup vs-seen, never vs-confirmed.** The seen-list pasted into next-round
   finder prompts must contain everything ever reported — including refuted and
   duplicate items — or refuted findings get rediscovered forever and the loop
   never converges. Key findings by location plus a normalized issue prefix
   (file + symbol + first ~6 normalized words of the issue): location alone
   suppresses distinct issues at the same symbol; raw wording alone lets
   paraphrases through. Sanctioned exception: playtest-balance gates hard
   crash/soft-lock/exploit findings on replay confirmation before they enter
   the seen-list, so one flaky repro can't permanently suppress a real crash.
6. **Never silently truncate coverage.** Cap shards at 10 files per worker and
   require per-file coverage confirmation in the output schema. If you bound the
   run (max rounds, sampling, top-N), say so in the final report.
7. **Relay, don't assume.** Subagent output is invisible to the user. The final
   synthesized report in your last message is the only deliverable that exists.
8. **Impose your own budget.** Cap total agents and rounds up front (quick ≤ 2,
   standard ≤ 15, exhaustive ≤ 40 unless the user raises it) and stop at the cap
   even if not dry — reporting the cap was hit.

## The exhaustive pipeline (phases)

Run phases in order; you are the barrier where one is needed. Pipeline
find→verify when you can: send a round's fresh findings to skeptics while the
next find round runs (dedup only needs the seen-list, not verdicts).

1. **Survey** — Cheap scoping first, before any fleet: Glob/Grep or one Explore
   agent to enumerate the target surface (files, modules, routes). Size the fleet
   from the count: `ceil(targets / 10)` finders per round.
2. **Find (multi-modal, sharded)** — Launch finders in one message. Shard by
   region AND diversify by modality — different finders search *different ways*
   (pattern-grep, call-site reading, git history, test assertions, execution).
   Use the `fable-finder` agent. Prompt templates: `references/prompts.md`.
3. **Loop-until-dry** — Dedup each round's results against the seen-list. New
   items → reset dry counter, add to seen. No new items → increment. Stop at
   **2 consecutive dry rounds** or the budget cap.
4. **Verify (adversarial + diverse lenses)** — For each surviving finding, spawn
   3 independent `fable-skeptic` agents in one message, each with a distinct lens
   (correctness / security-or-safety / reproduction), each explicitly prompted to
   REFUTE. Skeptics must not see each other's reasoning. A finding survives only
   if a strict majority of valid verdicts confirm it (failed skeptics don't
   vote). Zero valid verdicts is an infrastructure failure, not a refutation —
   bucket it as *unverified* and report it in Known limitations, never as
   confirmed. Keep every finding on the seen-list regardless of outcome.
5. **Critique** — Before synthesis, one `fable-critic` agent gets the original
   task, the surveyed surface, the modalities run, and the confirmed findings,
   and answers only "what's missing?". Material gaps trigger ONE more find +
   verify round scoped to the gaps (within budget); everything else carries
   forward as a limitation.
6. **Synthesize** — One `fable-synthesizer` agent merges confirmed findings into
   the deliverable, with a "Known limitations" section reproducing the uncovered
   files, the critic's residual gaps, and any round/budget cap that was hit.

## The judge panel (generative tasks)

For a single high-stakes artifact instead of a search:

1. **Attempts** — 3 independent workers, same task, different angles (e.g.
   MVP-first / risk-first / user-first), launched in one message.
2. **Judges** — 3 independent `fable-judge` agents, each given ALL attempts plus
   an explicit rubric, returning JSON scores per criterion.
3. **Synthesize** — One `fable-synthesizer` starts from the winning attempt and
   grafts in the best elements of the runners-up, guided by the judges' notes.

## The research sweep (multi-source questions)

1. **Sweep** — Modality-diverse searchers in one message: broad web survey /
   primary-source reading / contrarian search (criticism, failure reports) /
   recency search. Each returns claims JSON with source URLs and quotes.
2. **Check** — Pipeline each searcher's fresh claims (dedup on normalized claim
   text) straight into adversarial fact-checkers — verdicts SUPPORTED /
   REFUTED / UNVERIFIABLE; uncertain means UNVERIFIABLE, not SUPPORTED. These
   workers need web tools, so use `general-purpose`, not `fable-skeptic`.
3. **Synthesize** — Cited report from SUPPORTED claims only; contested and
   unverifiable claims go in a caveats section — never silently dropped.

## Detailed pattern playbook

Read `references/patterns.md` before your first exhaustive run — it covers the
failure modes (non-convergence, verification die-off, coverage lies, JSON
cascade, context bloat) and their mitigations, plus SendMessage continuation
and worktree isolation for parallel file-mutating workers.

Copy-paste-ready worker prompts and JSON schemas: `references/prompts.md`.

Domain recipes — mapping app features, game development, research, and
arbitrary "build me X" requests onto these patterns (task-shape classifier,
per-domain modalities and lenses): `references/applications.md`.

The native Workflow runtime's full operating rules (API contract, caps, budget
and resume semantics, and the when-to-orchestrate decision policy), distilled
from a live Fable session: `references/runtime-contract.md`.

Advanced methods beyond the core patterns — 30+ orchestration mechanisms
harvested from three deduped ideation+matching runs (canary rings, lesson
memory, escrowed acceptance contracts, verifier calibration drills, repo
atlases, orchestrator succession), each tagged with the failure mode it
prevents: `references/orchestration-methods.md`.

## Custom workers available

Defined in `.claude/agents/` — pass as `subagent_type`:

- `fable-finder` — read-only searcher; returns findings JSON with evidence fields
- `fable-skeptic` — adversarial verifier; single verdict JSON, biased to refute
- `fable-judge` — rubric scorer for judge panels; scores JSON
- `fable-synthesizer` — merges structured results into the final deliverable
- `fable-critic` — completeness critic; reports only gaps

If a worker type is unavailable, fall back to `general-purpose` (or `Explore`
for read-only search) with the same prompt template.
