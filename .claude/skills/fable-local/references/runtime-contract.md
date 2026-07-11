# Fable Workflow Runtime Contract

The complete operating rules of the native Workflow tool, distilled from a live
Fable 5 session (July 2026). This is the ground truth the scripts in
`.claude/workflows/` are written against, and what the emulation skill
replicates. Two audiences: script authors, and orchestrators deciding *whether*
to orchestrate.

## Script shape

- Plain JavaScript, NOT TypeScript — type annotations, interfaces, generics
  fail to parse. The body runs in an async context: top-level `await` and
  top-level `return` are legal.
- Must begin with `export const meta = {...}` as a PURE LITERAL — no variables,
  function calls, spreads, or template interpolation (the runtime extracts it
  before execution). Required: `name`, `description`. Optional: `whenToUse`,
  `phases: [{title, detail?, model?}]`. `phase()` titles match `meta.phases`
  titles exactly; a `phase()` call with no matching meta entry gets its own
  progress group.
- Determinism guards: `Date.now()`, `Math.random()`, and argless `new Date()`
  THROW (they would break resume). `new Date(explicitArg)` is fine. Pass
  timestamps in via `args`; vary prompts by loop index, not randomness.
- No filesystem or Node API (`require`, `fs`, `process`, network). Standard JS
  built-ins (JSON, Math, Set, Promise, Array) are available.

## Hooks

- `agent(prompt, opts?) → Promise<any>` — spawn a subagent. Without `schema`,
  returns its final text as a string; with `schema` (a JSON Schema), the
  subagent is forced through a StructuredOutput tool and the call returns the
  validated object (the runtime gives ~2 in-conversation correction nudges
  before the call fails). Returns `null` if the user skips the agent or it dies
  on a terminal error — always null-guard / `.filter(Boolean)`.
  `opts`: `{label?, phase?, schema?, model?, effort?, isolation?, agentType?}`.
  - `model`: omit by default — the agent inherits the session model, which is
    almost always correct. Set only when highly confident a different tier fits.
  - `effort` (`low`→`max`): omit to inherit; `low` for cheap mechanical stages,
    high tiers only for the hardest verify/judge stages. (Caveat: community
    reports an open issue where this option is not yet honored — do not build
    correctness on it.)
  - `isolation: 'worktree'`: fresh git worktree, EXPENSIVE (~200–500ms setup +
    disk per agent) — ONLY for agents that mutate files in parallel; auto-removed
    if unchanged.
  - `agentType`: use a custom subagent from `.claude/agents/` (composes with
    `schema`). LIVE-TESTED CAVEAT: custom types resolve from the SESSION's repo
    roots, not from wherever the script file lives — a script carrying
    `agentType` into a session whose project lacks those agent files fails
    every such spawn. Probe once at script start and degrade to the default
    worker (the `asWorker()` pattern in this repo's scripts).
  - LIVE-TESTED CAVEAT — rejection vs null: a failed `agent()` call REJECTS the
    returned promise. `parallel()`/`pipeline()` convert that to `null` at their
    own boundary, but a `.then(handler)` YOU attach inside a thunk never runs
    on failure — per-result accounting (coverage marking, identity tagging)
    must use two-argument `.then(onOk, onFail)` or `.catch` before `.then`.
- `parallel(thunks) → Promise<(T|null)[]>` — a BARRIER; awaits all thunks. A
  throwing thunk resolves to `null` — the call itself never rejects.
- `pipeline(items, ...stages)` — each item flows through all stages
  independently, NO barrier between stages (item A in stage 3 while item B is
  in stage 1). Stage callbacks receive `(prevResult, originalItem, index)`. A
  throwing stage drops that item to `null` and skips its remaining stages.
  THE DEFAULT for multi-stage work — a barrier is justified only when stage N
  needs cross-item context from ALL of stage N−1 (dedup across the full set,
  early-exit on totals, prompts referencing "the other findings").
- `workflow(nameOrRef, args?)` — run another workflow inline; shares this run's
  concurrency cap, agent counter, abort signal, and token budget. Nesting is
  ONE level only. Throws on unknown name — wrap in try/catch with a fallback.
- `phase(title)` / `log(message)` — progress grouping and narrator lines.
  Inside `pipeline`/`parallel` stages use `opts.phase` on `agent()`, not the
  global `phase()` (race on shared state).
- `args` — the invocation input, verbatim; may be `undefined`. Arrays/objects
  arrive as real JSON values.
- `budget: {total, spent(), remaining()}` — the turn's token target from a
  `+Nk` directive (`ultracode +500k: …`). `total` is `null` without one, making
  `remaining()` Infinity — GUARD every budget-driven loop on `budget.total`.
  The target is a HARD ceiling: once `spent()` reaches `total`, further
  `agent()` calls THROW — so guard or try/catch top-level calls that run after
  expensive phases, or the throw loses the run's accumulated results.

## Caps and resume

- Concurrency: `min(16, cpu cores − 2)` agents at once; excess queue.
- Lifetime: 1,000 `agent()` calls per run; 4,096 items max per
  `parallel()`/`pipeline()` call (explicit error, not silent truncation).
- Every run persists its script; resume via
  `Workflow({scriptPath, resumeFromRunId})` — the longest unchanged prefix of
  `agent()` calls returns cached results instantly (journal:
  `journal.jsonl` in the run's transcript dir). Same-session only. Same script
  + same args ⇒ 100% cache hit.
- LIVE-TESTED CAVEAT — resume ignores `args`: the prefix cache keys on each
  `agent()` call's `(prompt, opts)`, NOT on the workflow's `args`. If you change
  `args` (e.g. narrow `paths`) but the early `agent()` prompts are byte-identical
  (a survey prompt built from a default, a fixed first phase), those calls replay
  their OLD results and downstream work runs on the stale inputs — a narrowed
  audit silently re-reports the wide-scope run's findings. To re-run with
  different `args`, launch a FRESH run (omit `resumeFromRunId`) or vary the
  first-phase prompt by the args so the cache key changes. Resume is for
  continuing the SAME task after a stop, not for changing the task.

## The decision policy (when to orchestrate — "the thinking")

1. **Opt-in only.** Workflows spawn dozens of agents; the user must request the
   scale (the `ultracode` keyword, "use a workflow" in their own words, a
   saved workflow's slash command, or a standing ultracode session). A task
   that would merely *benefit* from a workflow does not count — offer it and
   the rough cost, and let the user decide.
2. **Hybrid scouting.** Scout inline first (list the files, scope the diff,
   find the surfaces) to discover the work-list, THEN orchestrate over it. You
   need the shape before the orchestration step, not before the task.
3. **Scale to the ask.** "Find any bugs" → a few finders, single-vote verify.
   "Thoroughly audit / be comprehensive" → larger finder pool, 3–5-vote
   adversarial pass, synthesis stage. Lean thorough for research/review/audit,
   brief for quick checks. Solo for conversational turns and trivial edits.
4. **Multi-phase work = several workflows in sequence** (understand → design →
   implement → review), reading each result before deciding the next phase —
   the orchestrator stays in the loop between fan-outs.
5. **Quality patterns are tools, not rituals** — adversarial verify,
   perspective-diverse verify, judge panel, loop-until-dry, multi-modal sweep,
   completeness critic. Pick what fits; compose novel harnesses (tournaments,
   self-repair loops, staged escalation) when the task calls for it.
6. **No silent caps.** If a run bounds coverage (top-N, sampling, no-retry),
   `log()` what was dropped — silent truncation reads as "covered everything".
7. **Subagents return data.** Their final text is a return value, not a
   user-facing message; the orchestrator relays what matters.

## Emulation deltas (any-model sessions)

Everything above holds conceptually for the emulation skill, with these
substitutions: the main agent is the engine (its turns are the barriers); N
Agent-tool calls in one message replace `parallel()`; background agents +
launch-on-completion replace `pipeline()`; "return ONLY JSON matching …" in
the prompt + defensive parsing replaces `schema`; self-imposed caps replace
`budget`. See SKILL.md and `patterns.md`.
