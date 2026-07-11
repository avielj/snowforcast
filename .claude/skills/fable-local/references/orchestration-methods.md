# Advanced Orchestration Methods

Harvested July 2026 from three ideation runs (software practice / AI-agent
research / high-reliability disciplines, then markets & composition, then
residual failure modes), each round deduped vs-seen and graded by a matcher
against this toolkit — only methods the toolkit did NOT already have survive
here. These are methodology, not scripts: compose them into workflows or
emulation runs when the failure mode they prevent is live in your task.

Highest-leverage shortlist (start here): lesson-memory-reflexion,
ring-based-canary-rollout, andon-line-stop, key-assumptions-ledger,
round-trip-spec-reconstruction, escrowed-acceptance-contracts,
versioned-repo-atlas-steward, hidden-holdout-goodhart-audit,
charter-anchor-drift-repair, orchestrator-baton-relay,
saboteur-hardened-fix-loop, n-version-divergence-arbitration.

## A. Before committing to a plan

- **key-assumptions-ledger** — before synthesis, an auditor extracts every
  load-bearing assumption from worker conclusions and classes it evidenced /
  asserted / inherited. Non-evidenced ones get verified by an agent that did
  NOT originate them, or the conclusion's confidence is downgraded with a fixed
  lexicon. Prevents: assumption cascades across understand→design→implement.
- **internal-prediction-market-gate** — cheap forecasters price 2–4 risky
  propositions about the plan ("this refactor breaks auth") with probabilities;
  anything above threshold gets an empirical probe BEFORE the main spend.
  Prevents: committing the expensive fleet to a plan resting on an unpriced
  assumption.
- **second-price-bounty-auction** — candidate solvers submit sealed approach
  bids (sketch, confidence, cost); the winner is graded against the
  runner-up's promised spec, and the runner-up executes if the winner falls
  short. Prevents: overpromising in plan selection — inflated bids only raise
  the bar you're graded against.
- **rfc-last-call-consensus-merge** — cross-cutting changes go through an RFC:
  concern-owner agents (API stability, perf, security) must either cite a
  concrete harm or explicitly return "no objection"; a last-call round freezes
  scope; implementation follows the frozen RFC. Prevents: silent-stakeholder
  regressions nobody was accountable for objecting to.
- **make-or-buy accounting** (decision-policy extension) — before each
  delegation, compare brief+verify overhead against doing it inline; delegate
  only high-volume, low-context-specificity work. Log actuals; tune the
  threshold. Prevents: delegation theater where the handoff costs more than
  the work.

## B. Structuring execution

- **ring-based-canary-rollout** — mass edits ship in exposure rings: one
  representative site → low-risk sites → hot-path sites, verified per ring
  with ring-level auto-revert; widen only on clean signal. Prevents: stamping
  a subtly wrong transform across 200 sites before instance one was checked.
  (Slot into codebase-migrate: ring 0 = the pilot batch.)
- **andon-line-stop** — any pipeline worker can freeze the WHOLE line on an
  anomaly (unexpected schema, broken invariant), not just its own item;
  restart requires a countermeasure record (fix + upstream check) or written
  risk acceptance. Prevents: downstream stages "working around" a corrupted
  intermediate. (Toolkit pipelines currently null-drop and keep flowing.)
- **plan-execute-repair-ladder** — a strong planner emits a step-graph with
  preconditions, postcondition checks, and a context packet per step; cheap
  executors run steps and verify postconditions; a failed check escalates only
  that step one rung up, and repairs re-patch downstream packets. Prevents:
  local fixes silently invalidating later steps in long executions.
- **tranche-defunded-portfolio** — 3–5 genuinely distinct approaches get
  first-tranche budgets in isolated worktrees; measurable probes at tranche
  boundaries reallocate budget toward demonstrated progress; laggards are
  defunded with their state briefs archived for survivors. Prevents:
  monoculture commitment to the first plausible approach.
- **regret-pruned-checkpoint-tree** — snapshot a git checkpoint + state brief
  after every phase; when the frontier stalls (progress-per-budget), restart
  from the best ANCESTOR checkpoint with an amendment memo naming the bad
  decision, pruning the stale branch. Prevents: both sunk-cost grinding and
  scorched-earth restarts from zero.
- **solved-exemplar-curriculum** — solve the easiest tier first, verify
  cheaply, then inject 1–2 verified solutions as worked examples into the
  next tier's prompts, tier by tier. Prevents: hardest-first flailing and
  parallel workers inventing divergent conventions.
- **process-pruned-beam** — keep k partial trajectories; a step-scorer judges
  only each latest step's local validity and prunes back to k. Costly; for
  hard generative tasks where late review keeps rejecting finished work.
  Prevents: budget spent completing solutions wrong since step 3.

## C. Verification economics and calibration

- **seeded-fault-drill** — before trusting verifiers on real work, a saboteur
  injects catalogued defects into copies of real work products; verifiers
  process the mixed stream blind; catch-rate per defect class gates the run
  (and mid-run re-drills catch verifiers going soft). Prevents: rubber-stamp
  verification you can't detect until the output ships. (The toolkit's
  "lean REFUTED" prompt wording hopes; this measures.)
- **overlap-calibrated-shard-review** — sharded reviewers share planted
  duplicate shards; inter-rater comparison on the overlaps scores each
  reviewer's recall; low-recall coverage is re-queued and findings are
  weighted by measured reliability. Prevents: silent blind spots scaling with
  artifact size under uniform confidence.
- **risk-priced verification** (two variants, compose freely) —
  *a-priori*: an actuary rates each subtask (failure probability × blast
  radius) and buys redundancy from a capped pooled reserve proportional to
  premium; claims re-rate task types upward. *Dynamic*: track each stream's
  defects-found-per-verification-token and reassign depth (full / spot-check /
  smoke) by yield, retiring dry streams after m windows. Prevents: uniform
  redundancy spend and verification cost exploding past finding value.
- **speculative-cascade-escalation** — a cheap model drafts every chunk; a
  strong model verifies in batch and regenerates only rejects (with the
  rejection reason); chunk types with high rejection rates get routed straight
  to the strong model. Prevents: uniform over-spend on easy chunks and silent
  cheap-model failure on the hard 20%.
- **journeyman-masterpiece-promotion** — the cheap tier shadows the strong
  tier per task type; K consecutive matches earn a blind-judged trial; passing
  promotes that task type to the cheap tier with spot audits (failed audit
  demotes). Prevents: static tier assignment — permanent overpaying for
  mastered task types, or demotion off one lucky sample.
- **hidden-holdout-goodhart-audit** — workers see the visible acceptance
  metrics; an auditor also scores against a rotating HIDDEN holdout suite
  (extra tests, adversarial inputs, re-phrasings); a visible-vs-holdout gap
  beyond tolerance flags gaming and triggers rework under rotated metrics.
  Prevents: agents overfitting the literal test list or rubric letter.
- **saboteur-hardened-fix-loop** — after fix-until-green converges, a saboteur
  injects behavior-changing mutants in a throwaway worktree; every mutant the
  suite fails to kill forces a new test, then the loop reruns to a kill-rate
  threshold. Prevents: vacuous green — convergence certified by a suite too
  weak to observe the bug.
- **blind-judge-evidence-debate** — two advocates argue opposite sides citing
  verbatim quotable evidence; the judge rules from the transcript ONLY, never
  the repo, forcing decisive evidence to be surfaced. Niche for code (the
  repo-checking judge is usually the better trade) but strong for decisions
  where evaluator anchoring-on-plausibility is the risk.
- **two-challenge-escalation** — workers get a graded appeal channel:
  observation, then formal evidence-citing challenge; a second unaddressed
  challenge auto-strips the lead's authority on that item and routes it to the
  orchestrator. Prevents: a majority-refuted-but-correct finding dying with no
  appeal — the toolkit's hierarchy is otherwise strictly top-down.

## D. Artifact integrity

- **escrowed-acceptance-contracts** — acceptance criteria (executable probes,
  rubric) are written and LOCKED read-only before any implementer exists —
  recursively at every decomposition leaf for big builds; a warden agent the
  implementer cannot influence runs the escrowed probes; failures return the
  failed clauses, never renegotiation rights; repeated failure re-decomposes.
  Prevents: moving-goalposts self-grading and interface drift in recursive
  decomposition.
- **round-trip-spec-reconstruction** — a reconstructor who has NEVER seen the
  spec reads only the artifact and writes the spec it appears to implement;
  a differ compares against the true spec; mismatches route back as targeted
  fixes. Prevents: silent spec drift reviewers miss because they read the
  artifact through the spec's lens.
- **n-version-divergence-arbitration** — 2–3 blind independent implementations
  from the same spec; a differ executes all against a generated input corpus;
  an arbiter classes each divergence as spec ambiguity (route to the user /
  spec editor) or implementation bug. Prevents: one agent's plausible-but-
  wrong unilateral reading of an ambiguous spec.
- **anticipatory-retrieval-interleaving** — the drafter tags every uncertain
  claim inline with a proposed query and stops at section boundaries; parallel
  retrievers resolve the tags; the drafter resumes with evidence spliced in;
  loop to zero new tags (leftover tags become explicit caveats). Prevents:
  hallucinated specifics baked deep into a finished artifact's structure.
- **primary-source-regrounding-checkpoint** — in pipelines deeper than ~3
  stages, a fresh regrounder receives ONLY the original primary artifacts plus
  the current intermediate — none of the intervening reasoning — and re-derives
  whether the intermediate still follows; mismatch rolls back to the last
  grounded checkpoint. Prevents: telephone-game error compounding where each
  stage trusts the previous summary.

## E. Fleet health and run hygiene

- **lesson-memory-reflexion** (highest-leverage gap found) — on any retry, a
  separate reflector reads the failed transcript and distills ONE concrete,
  generalizable lesson; the next worker starts FRESH with task + lesson list,
  never the failed transcript; a duplicate lesson is the stuck signal that
  triggers escalation or re-planning. Prevents: groundhog-day retries and
  context-poisoned retries. Retrofit into every retry loop (fix-until-green
  rounds, debug-hunt attempts, feature-build verify rounds).
- **error-budget-circuit-breaker** — an explicit tolerated-defect budget per
  phase (verifier rejections, reverts, broken builds) debited by every agent
  event; exhaustion trips a breaker: new-work dispatch halts and the fleet
  re-tasks to stabilization until the rejection rate drops. Prevents: piling
  new changes onto a degrading base all run long.
- **control-chart-quarantine** — a monitor tracks per-worker process signals
  (tool-error rate, retries, output drift, self-disagreement) against control
  limits fitted early; a breach quarantines everything that worker produced
  since its last in-control sample and restarts it fresh. Prevents: silent
  quality decay in long fleets that per-output review can't see.
- **postmortem-brief-patching** — after each wave, a postmortem agent converts
  failures into brief defects ("the task prompt omitted the API version") and
  patches the orchestrator's task-brief templates before the next wave; stop
  when a wave yields no new causes. Prevents: re-dispatching structurally
  identical bad instructions all run.
- **charter-anchor-drift-repair** — freeze an immutable task charter (goal,
  constraints, non-goals, output contract) at start; before every fan-out, a
  drift auditor diffs the round's generated prompts against the charter and
  flags mutated constraints for repair before dispatch; final verification is
  against the frozen charter, not the latest paraphrase. Prevents: prompt
  drift where round-5 workers solve a subtly different problem.
- **orchestrator-baton-relay** — externalize all run state (task DAG,
  statuses, decisions, open questions) to a machine-readable ledger after
  every phase; at a context threshold, write a succession brief and hand off
  to a fresh orchestrator that rehydrates from ledger+brief only. Prevents:
  orchestrator context exhaustion silently dropping subtasks and rules.
  (Emulation sessions: this is `fable-state.json` made mandatory + handoff.)
- **read-back-handoff-gate** — at any agent-to-agent succession, the successor
  restates the situation and its first three intended actions in its own
  words; a comparator diffs the read-back against the handoff brief before
  granting authority; second mismatch escalates to re-deriving state from
  artifacts. Prevents: successors resuming with a confidently wrong model of
  what was already done.
- **tool-flake-triage-broker** — route all tool failures to a broker that
  matches error signatures against a per-tool history table and issues policy
  verdicts (retry-with-backoff / switch tool / mark blocked / it's real);
  workers resume with the verdict. Prevents: one flaky endpoint sending three
  agents into 20-step debugging spirals and false "the build is broken"
  conclusions.
- **acuity-triage-scheduler** — score every incoming subtask and discovered
  issue against a fixed acuity rubric and schedule strictly by acuity, with
  timed re-scoring of waiting items. Mostly for continuous operation
  (self-heal + Routines). Prevents: severity inversion and queue rot.
- **sterile-cockpit-phase-gate** — during declared critical phases
  (destructive migrations, final merges), queue all off-checklist
  communications to a deferred inbox released after the phase. Prevents:
  mid-operation interrupts contaminating a high-stakes step.

## F. Cross-run memory

- **versioned-repo-atlas-steward** — keep a committed repo atlas (build/test
  commands, ownership map, known traps, flaky areas, env quirks) with
  confidence and expiry stamps; a steward opens each run by staleness-checking
  entries against git log since the atlas's recorded HEAD; workers cite atlas
  entries instead of re-deriving them and file discovery notes; the steward
  merges validated discoveries back at run end. Prevents: every run re-buying
  the same repo knowledge. (skill-library builds the atlas's first edition;
  this method keeps it alive.)

## Related parameterizations (no new mechanism needed)

- merge-queue integration train → perf-optimize/codebase-migrate's serialized
  integrator + SendMessage bounce-with-context.
- ownership-routed review → feature-build Understand-phase constraints pasted
  into per-zone reviewer prompts.
- preregistration → debug-hunt's hypothesis/testPlan schema + an explicit
  falsifier field and exploratory/confirmatory flag.
- exhibit chain-of-custody → tighten existing evidence fields into IDs with a
  re-fetch audit at synthesis.
- calibrated abstention → the UNVERIFIABLE/unverified doctrine + gap-round
  routing, with specialist routing of abstention groups.
- franchise playbook → codebase-migrate's spec, plus mid-run spec revision
  pushed to remaining batches when the same exception recurs twice.
