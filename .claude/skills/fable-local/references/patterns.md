# Fable-Local Pattern Playbook

Detailed mechanics for each orchestration pattern, and the failure modes that
kill runs. The orchestrator (main agent) is the workflow engine — every loop,
barrier, and tally below is state YOU maintain.

## 1. Phases (sequential barriers)

A phase boundary means: collect ALL results from phase N before composing any
phase N+1 prompt. Use a barrier only when the next phase genuinely needs the
full result set (dedup across all finders, early-exit on zero findings, prompts
that reference "the other findings"). Otherwise pipeline (§2) — barriers waste
the fast workers' idle time.

## 2. Pipeline (per-item multi-stage, no barrier)

Each item flows through its stages independently: finding A can be in verify
while finder B is still searching. Mechanics with background agents:

1. Launch stage-1 workers in one message (background is the default).
2. When a completion notification arrives, immediately launch that item's
   stage-2 worker(s) in your response — do not wait for siblings.
3. Track which agent maps to which item via the `description` you gave it.

Use pipeline for find→verify chains; use a barrier only where §1 says so.

## 3. Parallel fan-out (barrier)

N Agent calls in ONE message. Batch 5–10 per message; multiple rounds beat one
enormous batch (easier to track, and later rounds can incorporate earlier
results). Synchronous mode (`run_in_background: false`) on all calls in one
message still runs them concurrently and returns together — that IS a barrier,
and it's simpler than tracking background notifications when you need one.

## 4. Loop-until-dry

Termination criterion for exhaustive search — never "one pass looked complete".

```
seen = {}            # keyed by file+symbol+normalized-issue-prefix; holds EVERYTHING ever reported
confirmed = []       # subset that survived verification
dry = 0
while dry < 2 and agents_spent < budget:
    results = fan_out_finders(shards, modalities, seen_list=keys(seen))
    fresh = [r for r in results if key(r) not in seen]
    if fresh: dry = 0; seen.update(fresh)
    else:     dry += 1
```

- **Dedup vs `seen`, not vs `confirmed`.** If refuted findings aren't in the
  dedup list, finders rediscover them every round and the loop never dries.
- **Key on location plus a normalized issue prefix** (file + symbol + first ~6
  normalized words of the issue). Location alone suppresses distinct issues at
  the same symbol; raw wording alone lets paraphrase-duplicates through.
- Paste the seen-list into every finder prompt: "Already reported — do NOT
  re-report: [...]".
- Later rounds should rotate modality or widen scope, not rerun identical prompts.

## 5. Adversarial verify

Per finding, 3 independent skeptics whose job is to REFUTE it — find the guard,
the invariant, the caller contract that makes it safe. Rules:

- Independence is the point: each skeptic spawned fresh, no shared context,
  unaware of the others. Never paste one skeptic's reasoning into another's prompt.
- The prompt must explicitly permit and encourage REFUTED — otherwise agents
  rubber-stamp. Include "if uncertain, lean REFUTED".
- Survival: a strict majority of valid verdicts must CONFIRM (failed skeptics
  don't vote). Zero valid verdicts ⇒ *unverified*, reported under Known
  limitations — never confirmed, never silently dropped. The finding stays in
  `seen` whatever the outcome.
- All (finding × skeptic) calls for a round can go in one message.
- Cost control: run a cheap single-agent pre-filter over raw findings before
  spending 3 skeptics each; findings without concrete evidence fields die free.

## 6. Perspective-diverse verify

When a finding can fail more than one way, replace identical skeptics with
distinct lenses — e.g. logical correctness / security implications / concrete
reproduction (actually run the repro). Diversity catches failure modes
redundancy can't. Default survival rule everywhere in
this repo: strict majority of valid verdicts confirm. For very high stakes you
may require zero refutations instead — if you deviate from the default, state
which rule you used in the report.

## 7. Judge panel

For generative tasks where the solution space is wide:

1. **Attempts**: 3 workers, same task, forced-diverse angles stated in each
   prompt (MVP-first / risk-first / user-first, or different architectural bets).
2. **Judges**: 3 workers, each given ALL attempts + an explicit rubric with
   named criteria and weights, returning JSON scores + per-attempt notes.
   Judges are independent of the attempt agents and each other.
3. **Synthesize**: 1 worker gets the winner, the runners-up, and the judges'
   notes: "start from attempt N; graft in these specific strengths".

Beats one-attempt-iterated whenever reasonable people would disagree on approach.

## 8. Multi-modal sweep

Diversify HOW workers search, not just WHERE:

- pattern-grep (signature/regex hunting)
- call-site reading (trace usage, not definitions)
- git history / blame (recent churn, reverted fixes, TODO archaeology)
- test reading (what behavior is asserted — and what isn't)
- execution (actually run the code / a repro)

Each prompt names its modality and forbids the others: "You are the git-history
finder; do not do general code reading." Region-sharding alone misses
cross-cutting issues.

## 9. Completeness critic

After the fleet believes it's done, one agent gets the original task statement
plus the deliverable and answers ONLY: what's missing — uncovered area,
modality not run, claim unverified, category nobody looked for? Real gaps ⇒ one
more find+verify round (within budget). Residual gaps ⇒ "known limitations" section in
the report. Never skip this on exhaustive runs.

## 10. Fleet sizing & budget

- Survey first (Glob/Explore), then size the fleet from the count (formula in
  SKILL.md — the caps and sizing live there, the single source of truth).
- Hard-stop at the scale cap even if not dry, and say so in the report.
- Scale DOWN too: no fleet for a single-file question.
- Route mechanical work to a cheaper model via the Agent `model` param
  (e.g. `haiku`); keep the session model for verify/judge/synthesize.

## 11. Continuation & isolation

- **SendMessage** to a worker's agentId continues it with context intact —
  cheaper than respawning when a skeptic needs counter-evidence re-checked or a
  finder should extend its own search. A fresh Agent call never resumes context.
- **TaskStop** cancels running background workers when a budget or convergence
  condition hits mid-round.
- **`isolation: "worktree"`** for workers that MUTATE files in parallel
  (migrations): each gets its own git worktree so edits don't collide. Don't pay
  for it on read-only workers.
- Restricted agent types (Explore, Plan, custom read-only workers) cannot spawn
  agents — keep the fleet flat, one level below you.

## 12. Failure modes → mitigations

| Failure | Mitigation |
|---|---|
| Duplicated work across finders | Disjoint shards; seen-list in every prompt; dedup vs-seen |
| Findings die in verification | Require evidence fields (path, line, snippet, repro) at find time; cheap pre-filter before skeptics |
| Coverage lies ("covered 40 files", read 5) | Shards of 10 files; schema requires per-file `covered` confirmation; completeness critic |
| Non-convergence | Dedup vs-seen not vs-confirmed; key on location plus normalized issue prefix, not raw wording |
| Malformed JSON cascade | Strip fences, extract first `{...}`; retry once; then drop + note the gap — never abort the run |
| Orchestrator context bloat | Workers return compact JSON only; persist master state to `fable-state.json` in the scratchpad and re-read it |
| Racing your own delegation | Never search for what you just delegated — wait for the worker |
| Silent truncation | Any bound (top-N, sampling, cap hit) goes in the final report |
