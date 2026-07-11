# Emulation Playbook — every workflow, on any model

How to run each of the 12 workflow shapes with nothing but the standard Agent
tool — for Sonnet, Opus, or any session without the Workflow tool. You (the
main agent) are the engine. Worker prompts: `references/prompts.md` — full
templates for the audit/judge/research workers, plus a universal skeleton for
every other role (coder, fixer, hypothesis, tester, transformer, optimizer,
persona, investigator, author, reviewer, driver, diagnosis). Rules that apply
to every recipe below:

- **Do cheap steps yourself.** You have Bash/Grep/Glob — run checks, surveys,
  and dedup inline. Spend agents only on parallel reading, independent
  verification, and isolated implementation. (This makes emulation CHEAPER
  than the native scripts, which must delegate everything.)
- **State file.** Before round 2 of anything, write `fable-state.json` in the
  scratchpad: `{phase, round, seen: [], confirmed: [], counters, decisions}`.
  Update it every round; re-read it instead of trusting your memory.
- **Barriers**: N Agent calls in one message, wait for all. **Pipelining**:
  background agents; when one completes, immediately launch its next stage.
- **Small-model mode** (Sonnet/Haiku as orchestrator): halve fleet sizes
  (3–5 agents per round max), prefer synchronous barriers over background
  pipelining (simpler bookkeeping), never skip the state file, and follow the
  recipe steps literally — the recipes are written to be executable as
  checklists.
- Every worker prompt: self-contained, absolute paths, scope fence, seen-list,
  "return ONLY JSON matching this schema". Parse defensively; failed worker =
  recorded gap, never a silent hole.

## 1. exhaustive-audit

1. Survey YOURSELF with Glob/Grep: enumerate target files, only under the
   given paths. Shard into groups of 10.
2. Round: one message, one finder agent per shard (≤5 in small-model mode —
   more rounds instead), each with a distinct modality (pattern-grep /
   call-sites / git history / test reading / execution), the seen-list, and
   the findings+coverage schema. Every new round must differ: rotate each
   shard's modality and/or widen scope — never rerun an identical prompt set.
3. Dedup vs seen (key: file+symbol+first-6-normalized-words). Fresh findings →
   verify (step 4) while the next find round runs if you can pipeline;
   otherwise verify after each round. Dry round = zero fresh AND zero failed
   finders; stop at 2 consecutive dry or 6 rounds. All finders failed → abort
   and report systemic failure.
4. Verify: per finding, 3 skeptics in one message (correctness / security /
   reproduction lenses), refute-biased. Survives on strict majority of valid
   verdicts; zero valid = unverified bucket (limitations, never confirmed).
5. Critic (task + surface + modalities + confirmed → gaps only). Material gaps
   + budget → ONE scoped find+verify round. Then synthesize with a Known
   limitations section (uncovered files, unverified, caps hit).

## 2. judge-panel

1. One message: 3 attempt agents (general-purpose workers — there is no
   fable-attempt type), same task, forced-diverse angles, grounded in the
   actual codebase, full artifact each as raw markdown.
2. One message: 3 judge agents, each given ALL attempts + weighted rubric →
   scores JSON + graft-from-losers. Never reuse attempt agents as judges.
3. Tally weighted totals across judges (ignore scores for attempt numbers that
   don't exist). One synthesizer: winner's structure + named grafts.

## 3. research-sweep

1. One message: 4 searchers — broad survey / primary sources / contrarian /
   recency — each returning claims JSON with source URLs + quotes.
2. Dedup claims on normalized text. Fact-check each fresh claim (agents with
   web tools): SUPPORTED / REFUTED / UNVERIFIABLE; uncertain = UNVERIFIABLE;
   checker failed = UNVERIFIABLE. Pipeline per searcher if you can.
3. Synthesize: cited report from SUPPORTED only; contested/unverifiable in a
   caveats section — never dropped.
   No web tools in this session → restrict modalities to local sources (repo,
   docs on disk, installed package metadata), mark claims needing the network
   UNVERIFIABLE, and state the restriction in the caveats — do not abort.

## 4. feature-build

1. Understand: scout the subsystems yourself, then one reader agent per area
   (≤5) → summary + constraints + risks.
2. Design: run recipe #2 (judge-panel) on the design task with the
   understanding embedded.
3. Implement: split into ≤6 work items with DISJOINT files. More than one
   coder in parallel → EVERY coder gets `isolation: "worktree"` (parallel
   agents cannot commit separate branches in one shared checkout); each
   commits to its own branch in its worktree. A single coder may work in the
   main tree. No worktree support in this harness → run coders sequentially
   in the main tree, committing between items, and say so in the report.
4. Integrate yourself (merge branches, resolve per the design).
5. Verify loop (≤3 rounds): run tests yourself + one adversarial reviewer
   agent with an integration-seams lens; fix agent per round; stop on green.

## 5. fix-until-green

1. Run the check YOURSELF; parse failures. Green → done.
2. Cluster failures into ≤6 disjoint-file clusters (do it yourself; an agent
   only if the failure list is huge — cap what you embed at ~250).
3. One message: one fixer agent per cluster ("edit ONLY these files; fix root
   causes, no suppressions").
4. Re-run the check yourself. Record the count in the state file. Stop:
   green / 2 rounds without strict decrease / 5 rounds / clustering failed —
   and SAY which.

## 6. debug-hunt

1. Reproduce first — yourself if quick, else one agent. No repro → proceed on
   a proxy signal but say confidence is lower.
2. One message: 4 hypothesis agents (code-reading / git-history / instrument-
   ation / deps-env), ≤3 causes each with evidence + test plan. Dedup causes.
3. One message: one empirical tester per hypothesis — must RUN experiments;
   argued-only = INCONCLUSIVE.
4. Fix the highest-confidence CONFIRMED cause (fixer agent, commits, adds a
   regression test); verify repro gone + tests pass. Failed → revert the
   attempt, try the next confirmed cause (max 2 attempts). Report the cause
   whose fix actually verified — null if none.

## 7. codebase-migrate

1. Spec agent distills the codemod ONCE (rules, edge cases, do-not-touch)
   with real repo examples. You enumerate targets yourself; batch by 8.
2. Transformers: one agent per batch, spec verbatim in every prompt, worktree
   isolation (they mutate in parallel), commit per batch, flag unclean files
   instead of half-migrating. No worktree support → serialize the batches in
   the main tree, committing between batches, and report that the run was
   serialized.
3. Integrate yourself. Then one consistency-critic agent over a cross-batch
   sample (parallel transformers drift). Fix violations.
4. Converge: run recipe #5 with the global check.
   Canary variant (from orchestration-methods.md): batch 0 alone first,
   verify, THEN fan out the rest.

## 8. perf-optimize

1. Baseline: run the benchmark yourself 3+ times; record median + noise.
2. One profiling agent → ≤6 measured hotspots (numbers, not intuition).
3. One message: one optimizer per hotspot, worktree isolation, must self-
   measure before/after in its worktree and report gainPct honestly. No
   worktree support → attempts run sequentially in the main tree (measure,
   commit or revert, next) — slower but the gate logic is identical.
4. Accept gate: gain ≥ max(minGain, 2× noise). Integrate winners ONE at a
   time, re-measuring after each merge yourself; revert merges that don't
   hold. Report baseline → final with kept/reverted.

## 9. playtest-balance (games / tunable systems)

1. One message: persona agents (completionist / speedrunner / button-masher /
   min-maxer) that ACTUALLY RUN the build → findings with repro + metrics.
2. Dedup: soft findings vs-seen on sight; hard findings (crash/softlock/
   exploit) enter seen only after a replay agent CONFIRMS them.
3. Assess agent: confirmed hard + soft (labeled unverified) + metrics + last
   round's unresolved problems → problems + specific tunings + targetsMet.
4. Apply tunings (exactly those), replay. Stop: targets met / cap — and on the
   cap round return proposed tunings UNAPPLIED (never ship unmeasured tuning).

## 10. skill-library

1. One message: 4 investigator agents (build+CI / git history / docs /
   architecture) → verified facts. Compose ≤5 owner questions from what the
   repo cannot tell you; ASK THE USER; wait.
2. Taxonomy agent adapts the 16-skill base template — copy the taxonomy list
   AND the AUTHORING_RULES block verbatim from
   `.claude/workflows/skill-library.js` (they ship with this repo; the script
   is the single source of truth for both).
3. One message per ~5 skills: author agents, one skill each, the copied
   AUTHORING_RULES verbatim in every prompt (ground truth only, provenance
   sections, write only in .claude/skills/).
4. One message: 3 reviewers (factual — rerun the commands / doctrine /
   usability). One fixer for blocking+important. Deliver inventory + what
   remains uncertain.

## 11. verify-feature

1. Map YOURSELF (read the diff): the runtime flows the change affects, how to
   drive each, expected behavior. No runtime surface → nothing to verify.
2. One message: one driver agent per flow — must actually launch/call/run it;
   tests and typecheck do NOT count; report observed vs expected + evidence.
3. One edge-pass agent tries to break the changed behavior (edge inputs,
   repeats, old callers).
4. Verdict: verified only if every flow drove and matched AND no breaks AND
   nothing unexercised. Unexercised = unknown, never a pass.

## 12. self-heal

1. Run every health check yourself (or one agent per check if slow), in
   parallel. All green → done.
2. One diagnosis agent per failing check: mechanical fallout vs deep cause
   (with evidence, suspect commits).
3. Mechanical + autoFix → recipe #5 per check (its command as the oracle).
   Deep causes → diagnosis dossier for the user (or recipe #6 if asked) —
   never blind-fix.
4. Re-run all checks; report healed / still-failing / dossiers honestly.
   Continuous mode: pair with a schedule (cron/Routine) re-invoking this.

## Escalation add-ons (from orchestration-methods.md)

When a recipe's stakes rise, bolt on: lesson-memory (retry loops #4/5/6/12:
distill ONE lesson per failure, retry fresh with lessons, duplicate lesson =
stuck), charter anchor (multi-round runs: freeze the task contract, diff each
round's prompts against it), assumptions ledger (before any synthesis),
seeded-fault drill (before trusting verifiers on a big run), baton relay
(your context runs low: write the ledger + succession brief, tell the user to
continue in a fresh session from the state file).
