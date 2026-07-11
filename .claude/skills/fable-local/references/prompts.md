# Fable-Local Worker Prompt Templates

Copy, fill the `{placeholders}`, and pass as the Agent `prompt`. Every template
is self-contained — workers have zero conversation context. Always use absolute
paths. Every template ends with the JSON-only clause; keep it.

Parse every response defensively: strip markdown fences, extract the first
`{...}` or `[...]` block, retry once on failure, then drop the worker's
contribution and record the gap.

## Finder (subagent_type: fable-finder)

```
Goal: {one-sentence task, e.g. "find missing input validation in API route handlers"}.

Your shard — examine EVERY file below and no others:
{absolute file list, 10 files max}

Your modality: {pattern-grep | call-site reading | git history | test reading | execution}.
Work ONLY in this modality; sibling agents cover the others.

You are a READ-ONLY worker: Bash is for inspection and running existing
tests/scripts only — never mutate files, never run git write operations.

Already reported by earlier rounds — do NOT re-report anything matching these
locations: {seen-list as "path:symbol:issue-prefix" entries, or "none"}

For each finding include concrete evidence: exact path, line number, code
snippet, and (if applicable) a command that demonstrates the problem. Findings
without evidence will be discarded unverified.

Your entire final message must be ONLY a JSON object matching this schema — no
prose, no markdown fences:
{
  "findings": [
    {"file": "abs path", "line": 0, "symbol": "fn or section",
     "issue": "one sentence", "severity": "high|medium|low",
     "evidence": "snippet or repro command"}
  ],
  "coverage": [{"file": "abs path", "covered": true, "note": "skipped-why if false"}]
}
```

## Skeptic (subagent_type: fable-skeptic)

One skeptic per (finding × lens). Lenses: `correctness`, `security/safety`,
`reproduction` (this one must actually attempt the repro). Never include another
skeptic's reasoning.

```
A prior review claimed this finding. Your job is to REFUTE it — find the guard,
the invariant, the caller contract, the config, or the test that makes it a
non-issue. If you cannot refute it with evidence, confirm it. If uncertain,
lean REFUTED.

Your lens: {correctness | security/safety | reproduction}. Judge only through
this lens. {If reproduction: actually run code to reproduce it; a repro you
could not make work is a refutation.}

Finding: {file}:{line} {symbol} — {issue}
Evidence given: {evidence}

Read the surrounding code yourself; do not trust the claim's framing.
You are a read-only worker: run repros and inspections only — never mutate
repo files, never run git write operations.

Your entire final message must be ONLY a JSON object — no prose, no fences:
{"verdict": "CONFIRMED|REFUTED", "confidence": "high|medium|low",
 "reasoning": "2-3 sentences", "evidence": "path:line or command output"}
```

Tally: a finding survives only if a strict majority of valid verdicts are
CONFIRMED (failed skeptics don't vote). Zero valid verdicts ⇒ mark it
*unverified* and list it under Known limitations. It stays in the seen-list
either way.

## Judge (subagent_type: fable-judge)

```
Score these {N} independent attempts at the same task. Task: {task statement}.

Rubric — score each attempt 1-10 per criterion:
{criteria with weights, e.g. "correctness (x3), simplicity (x2), completeness (x2), risk (x1)"}

--- ATTEMPT 1 ---
{full attempt text}
--- ATTEMPT 2 ---
{...}

Your entire final message must be ONLY a JSON object — no prose, no fences:
{"scores": [{"attempt": 1, "byCriterion": {"correctness": 0}, "weightedTotal": 0,
  "strengths": ["..."], "weaknesses": ["..."]}],
 "winner": 1, "graftFromLosers": ["specific element worth keeping and from which attempt"]}
```

## Synthesizer (subagent_type: fable-synthesizer)

```
Merge these verified results into the final deliverable for: {original task}.

Confirmed findings (JSON): {confirmed list}
Refuted-with-reason (mention only if instructive): {optional}
Known coverage gaps: {gaps from coverage fields / cap hits}

Produce {deliverable format: report with sections / patch plan / doc}. Order by
severity. Cite every claim as path:line. Include a "Known limitations" section
listing the coverage gaps verbatim — do not omit or soften them.

Return the deliverable as raw markdown, no preamble.
```

(The synthesizer is the one worker that returns prose — its output IS the
deliverable you relay to the user.)

## Completeness critic (subagent_type: fable-critic)

```
Original task: {task statement}
Surface surveyed: {target list / shard map}
Modalities run: {list}
Deliverable produced: {deliverable or confirmed-findings JSON}

What is missing? Uncovered files or areas, a modality not run, a category of
issue nobody looked for, an unverified claim, an unstated assumption. Do not
re-review the findings themselves — hunt only for gaps.

Your entire final message must be ONLY a JSON object — no prose, no fences:
{"gaps": [{"kind": "coverage|modality|category|verification",
  "description": "...", "suggestedAction": "one more finder round on X | note as limitation"}],
 "materialGaps": false}
```

`materialGaps: true` and budget remaining ⇒ run one more find+verify round scoped to
the gaps. Otherwise append gaps to the report's Known limitations.

## Universal worker skeleton (all other roles)

For roles without a dedicated template above (coder, fixer, hypothesis
generator, empirical tester, transformer, optimizer, playtest persona, replay
verifier, investigator, skill author, reviewer, flow driver, diagnosis), build
the prompt from this skeleton — every block is mandatory:

```
Role: {one sentence: what this worker is, e.g. "one coder in a parallel fleet"}.
Goal: {the specific deliverable for THIS worker}.
Scope: {exact files/branch/command it owns — absolute paths}. Do NOT touch
anything outside it; sibling agents own the rest.
Context: {everything from prior phases this worker needs — it has none of
your conversation}.
{If read-only: "You are a read-only worker: never mutate files or run git
write operations."}
{If it mutates: "Commit your work to {branch} with a descriptive message."}
Done means: {the concrete completion criterion, incl. what to do if blocked}.

Your entire final message must be ONLY a JSON object matching this schema —
no prose, no markdown fences:
{the schema — copy the relevant one from the matching workflow script in
.claude/workflows/, which is the source of truth for field names}
```

(Exception: synthesizer-style and attempt-style workers return raw markdown —
say so explicitly instead of the JSON clause.)

## Explore fallback (quick scale, subagent_type: Explore)

```
Search breadth: {medium | very thorough}.
Question: {question}. Look in {starting points if known}.
Return: direct answer first, then the supporting locations as path:line
references. Do not paste large file contents.
```
