export const meta = {
  name: 'codebase-migrate',
  description: 'Map-reduce transform at scale: distill a codemod spec once, transform batches in isolated worktrees with per-batch verification, integrate, then converge the global check via nested fix-until-green',
  whenToUse: 'Framework swaps, API deprecations, language ports, repo-wide test/doc backfill — many uniform mechanical changes. args: {spec: string, targets?: string, check?: string}',
  phases: [
    { title: 'Spec', detail: 'distill before/after rules agreed once' },
    { title: 'Discover', detail: 'enumerate migration targets' },
    { title: 'Transform', detail: 'batches migrated in parallel worktrees, verified per batch' },
    { title: 'Integrate', detail: 'merge branches, nested fix-until-green on the global check' },
  ],
}

const spec = (args && args.spec) || null
if (!spec) return { error: 'codebase-migrate requires args.spec (what to migrate from/to)' }
const targetsHint = (args && args.targets) || 'search the whole repository'
const check = (args && args.check) || null

// ---- Phase 1: Spec — agree the rules ONCE so parallel transformers are consistent ----
phase('Spec')
const SPEC_SCHEMA = {
  type: 'object', required: ['rules'],
  properties: {
    rules: { type: 'array', items: { type: 'string' } },
    edgeCases: { type: 'array', items: { type: 'string' } },
    doNotTouch: { type: 'array', items: { type: 'string' } },
  },
}
const codemod = await agent(
  `Migration request: ${spec}\n` +
  'Study the codebase and distill a codemod spec every transformer must follow identically: concrete ' +
  'before→after rules (with real code examples from this repo), known edge cases and how to handle them, and ' +
  'what must NOT be touched. Transformers work in parallel and never talk to each other — the spec is their ' +
  'only shared contract, so make it unambiguous.',
  { label: 'codemod-spec', schema: SPEC_SCHEMA },
)
if (!codemod) return { error: 'codemod spec agent failed' }
const specText =
  `Rules:\n${codemod.rules.map(r => `- ${r}`).join('\n')}\n` +
  `Edge cases:\n${(codemod.edgeCases || []).map(r => `- ${r}`).join('\n')}\n` +
  `Do NOT touch:\n${(codemod.doNotTouch || []).map(r => `- ${r}`).join('\n')}`

// ---- Phase 2: Discover ----
phase('Discover')
const TARGETS_SCHEMA = {
  type: 'object', required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
}
const discovery = await agent(
  `Enumerate every file needing this migration (${targetsHint}):\n${spec}\n` +
  `Codemod spec for reference:\n${specText}\nReturn absolute paths. Do not modify anything.`,
  { label: 'discover', schema: TARGETS_SCHEMA },
)
const targets = (discovery && discovery.files) || []
if (targets.length === 0) return { migrated: 0, note: 'no migration targets found' }
const BATCH = 8
const batches = []
for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH))
log(`${targets.length} targets -> ${batches.length} batches`)

// ---- Phase 3: Transform (pipeline: migrate batch -> verify batch, no barrier) ----
const RESULT_SCHEMA = {
  type: 'object', required: ['branch', 'committed', 'migrated', 'flagged'],
  properties: {
    branch: { type: 'string' }, committed: { type: 'boolean' },
    migrated: { type: 'array', items: { type: 'string' } },
    flagged: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'reason'],
        properties: { file: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
}
const results = (await pipeline(
  batches,
  (batch, _item, i) => agent(
    `You are one transformer in a parallel migration fleet, working in an isolated git worktree.\n` +
    `Apply this codemod spec EXACTLY (other agents apply the same spec to other files — do not improvise):\n${specText}\n\n` +
    `Your batch — migrate EVERY file below and no others:\n${batch.join('\n')}\n\n` +
    (check ? `Verify your work: run \`${check}\` (or its relevant slice) in your worktree; fix your own breakage once before finishing.\n` : '') +
    `A file that cannot be migrated cleanly per the spec goes in flagged with a reason — do NOT half-migrate it.\n` +
    `When done: create branch migrate/batch-${i}, commit all changes to it, report committed:true.`,
    { label: `transform:batch${i}`, phase: 'Transform', schema: RESULT_SCHEMA, isolation: 'worktree' },
  ),
)).filter(Boolean)
const committed = results.filter(r => r.committed)
const flagged = results.flatMap(r => r.flagged)
const migratedFiles = results.flatMap(r => r.migrated)
const failedBatches = batches.length - results.length
log(`transform: ${committed.length}/${batches.length} batches committed, ${flagged.length} files flagged` +
    (failedBatches ? `, ${failedBatches} batch agents failed` : ''))
if (committed.length === 0) return { migrated: 0, flagged, note: 'no batch produced a commit' }

// ---- Phase 4: Integrate + converge ----
phase('Integrate')
const INTEGRATE_SCHEMA = {
  type: 'object', required: ['merged', 'summary'],
  properties: {
    merged: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}
let integration = null
try {
  integration = await agent(
  `In the main working tree, merge these migration branches into the current branch, resolving conflicts ` +
  `according to the codemod spec:\n${committed.map(c => `- ${c.branch}`).join('\n')}\n\nSpec:\n${specText}\n` +
  'Do not push. Report merged branches and resolved conflicts.',
  { label: 'integrate', schema: INTEGRATE_SCHEMA },
  )
} catch (e) { log('integration agent could not run (budget exhausted)') }
if (!integration) {
  return {
    migrated: migratedFiles.length,
    totalTargets: targets.length,
    flagged,
    failedBatches,
    committedBranches: committed.map(c => c.branch),
    note: 'integration did not run — migration branches remain unmerged',
  }
}

// Consistency critic: parallel transformers drift — one agent reads a sample
// of migrated files across DIFFERENT batches hunting for spec violations and
// inconsistent style, before the expensive global check runs.
const DRIFT_SCHEMA = {
  type: 'object', required: ['violations'],
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'issue'],
        properties: { file: { type: 'string' }, issue: { type: 'string' } },
      },
    },
  },
}
let drift = null
try {
  drift = await agent(
  `Read a cross-batch sample of these migrated files (at least one from each batch) and hunt for codemod-spec ` +
  `violations and cross-file inconsistencies (parallel agents did the work — drift is likely):\n` +
  `${migratedFiles.slice(0, 60).join('\n')}\n\nSpec:\n${specText}`,
  { label: 'consistency-critic', phase: 'Integrate', schema: DRIFT_SCHEMA },
  )
  if (drift && drift.violations.length > 0) {
    log(`consistency critic: ${drift.violations.length} violations — fixing`)
    await agent(
      `Fix these codemod-spec violations in the main working tree and commit:\n${JSON.stringify(drift.violations)}\n` +
      `Spec:\n${specText}`,
      { label: 'fix-drift', phase: 'Integrate' },
    )
  }
} catch (e) { log('drift review skipped (budget exhausted)') }

let convergence = null
if (check) {
  // Nested fix-until-green drives the global check to passing (one nesting level).
  try {
    convergence = await workflow('fix-until-green', {
      check,
      context: `The repo just underwent this migration; failures are likely migration fallout. Spec:\n${specText}`,
    })
  } catch (e) {
    log('nested fix-until-green unavailable — running the check once instead')
    try {
      convergence = await agent(
        `Run \`${check}\` and report the outcome; fix nothing.`,
        { label: 'final-check', phase: 'Integrate' },
      )
    } catch (e2) { log('final check skipped (budget exhausted)') }
  }
}

return {
  migrated: migratedFiles.length,
  totalTargets: targets.length,
  flagged,
  failedBatches,
  integration: integration.summary,
  driftViolations: drift ? drift.violations.length : 'critic failed',
  convergence,
}
