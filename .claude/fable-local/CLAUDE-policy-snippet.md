<!-- Append this block to your project's CLAUDE.md to make fable.local the
     project's default orchestration policy. Delete this comment line. -->

## Orchestration policy (fable.local)

This project carries the fable.local capability (`.claude/skills/fable-local`,
`.claude/workflows/`, `.claude/agents/fable-*`). Operating rules:

- For any substantive task — multi-file changes, audits, "find all X",
  debugging a symptom, building a feature or game slice, migrations,
  performance work, research — classify the task shape with the table in
  `.claude/skills/fable-local/references/applications.md`, then:
  - Workflow tool available in this session → run the matching workflow from
    `.claude/workflows/` with proper `args`.
  - No Workflow tool (Sonnet/any model) → follow the matching numbered recipe
    in `.claude/skills/fable-local/references/emulation-playbook.md` literally,
    including small-model mode when applicable.
- Scale to the ask (quick / standard / exhaustive per SKILL.md). Trivial edits
  and single-file questions never spawn a fleet.
- Verification doctrine is non-negotiable: findings need evidence; adversarial
  refute-biased verification; strict majority of valid verdicts; zero valid
  verdicts = unverified, reported in limitations; dedup vs-seen, never
  vs-confirmed; every bound (caps, budget stops, uncovered files) goes in the
  deliverable — no silent truncation.
- Before committing a nontrivial change, run the verify-feature shape (drive
  the affected flows for real — tests and typecheck alone don't count).
- For long or repeated work in this repo, maintain the repo atlas per
  `references/orchestration-methods.md` (versioned-repo-atlas-steward) so runs
  stop re-buying the same knowledge.
