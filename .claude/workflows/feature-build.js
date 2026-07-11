export const meta = {
  name: 'feature-build',
  description: 'Full development cycle for apps, games, or any build request: parallel understanding, judge-panel design, worktree-isolated implementation, integration, test + adversarial-review fix loop',
  whenToUse: 'Building a nontrivial feature, app, or game slice end-to-end. args: {request: string, paths?: string[], testCommand?: string, angles?: string[]}',
  phases: [
    { title: 'Understand', detail: 'parallel readers map the relevant subsystems' },
    { title: 'Design', detail: 'judge-panel workflow picks and synthesizes the approach' },
    { title: 'Implement', detail: 'work items coded in parallel, one git worktree each' },
    { title: 'Integrate', detail: 'merge item branches, resolve conflicts' },
    { title: 'Verify', detail: 'tests plus adversarial review; fix loop until green' },
  ],
}

const request = (args && args.request) || null
if (!request) return { error: 'feature-build requires args.request' }
const roots = (args && args.paths) || ['the whole repository']
const testCommand = (args && args.testCommand) || null

// ---- Phase 1: Understand ----
phase('Understand')
const AREAS_SCHEMA = {
  type: 'object', required: ['areas'],
  properties: {
    areas: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'files', 'question'],
        properties: {
          name: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          question: { type: 'string' },
        },
      },
    },
  },
}
const MAP_SCHEMA = {
  type: 'object', required: ['summary', 'constraints'],
  properties: {
    summary: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const scout = await agent(
  `Task: ${request}\nSurvey ${roots.join(', ')} and list the subsystems/areas a builder must understand first ` +
  '(max 6). For each: a name, the key files (absolute paths), and the one question a reader should answer about it.',
  { label: 'scout', schema: AREAS_SCHEMA },
)
const areas = (scout && scout.areas) || []
const readings = (await parallel(areas.map(a => () =>
  agent(
    `Read these files and answer for a developer about to build "${request}":\n${a.files.join('\n')}\n` +
    `Focus question: ${a.question}\nReturn a compact summary, hard constraints (conventions, invariants, ` +
    'framework rules), and risks.',
    { label: `read:${a.name}`, phase: 'Understand', schema: MAP_SCHEMA },
  ).then(r => (r ? { area: a.name, ...r } : null))
))).filter(Boolean)
const understanding = readings
  .map(r => `## ${r.area}\n${r.summary}\nConstraints: ${r.constraints.join('; ')}\nRisks: ${(r.risks || []).join('; ')}`)
  .join('\n\n')
log(`understanding built from ${readings.length}/${areas.length} areas`)

// ---- Phase 2: Design (nested judge-panel workflow) ----
phase('Design')
let design = null
try {
  const panel = await workflow('judge-panel', {
    task:
      `Design the implementation for: ${request}\n\nCodebase understanding (from parallel readers):\n${understanding}\n\n` +
      'Deliver: chosen approach, file-by-file change plan, data/API contracts, test plan. Respect every constraint above.',
    angles: (args && args.angles) || undefined,
  })
  design = panel && panel.artifact
} catch (e) {
  log('judge-panel unavailable, falling back to a single designer')
}
if (!design) {
  design = await agent(
    `Design the implementation for: ${request}\n\nCodebase understanding:\n${understanding}\n\n` +
    'Deliver: chosen approach, file-by-file change plan, data/API contracts, test plan. Return raw markdown.',
    { label: 'design-fallback' },
  )
}
if (!design) return { error: 'design phase failed' }

// ---- Phase 3: Implement (parallel coders, one worktree each) ----
phase('Implement')
const ITEMS_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'branch', 'instructions'],
        properties: {
          title: { type: 'string' },
          branch: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
        },
      },
    },
  },
}
const plan = await agent(
  `Split this design into independent work items that can be coded in parallel (disjoint files; max 6 items; ` +
  `prefer fewer, larger items over many tiny ones). Each item: title, a git branch name like ` +
  `feature-build/item-N-slug, the files it owns, and self-contained coding instructions (the coder will not ` +
  `see the full design).\n\nDesign:\n${design}`,
  { label: 'work-plan', schema: ITEMS_SCHEMA },
)
const items = ((plan && plan.items) || []).slice(0, 6)
if (items.length === 0) return { error: 'no work items derived from design', design }

const RESULT_SCHEMA = {
  type: 'object', required: ['branch', 'committed', 'summary'],
  properties: {
    branch: { type: 'string' }, committed: { type: 'boolean' },
    summary: { type: 'string' }, blockers: { type: 'array', items: { type: 'string' } },
  },
}
const coded = (await parallel(items.map(item => () =>
  agent(
    `Implement this work item in the repository you are in (an isolated git worktree).\n` +
    `Item: ${item.title}\nFiles you own: ${(item.files || []).join(', ') || 'per instructions'}\n` +
    `Instructions:\n${item.instructions}\n\nOverall request for context: ${request}\n` +
    `When done: create branch ${item.branch}, commit ALL your changes to it with a descriptive message, ` +
    'and report committed:true. If blocked, commit what compiles and list blockers.',
    { label: `code:${item.title}`, phase: 'Implement', schema: RESULT_SCHEMA, isolation: 'worktree' },
  )))).filter(Boolean)
const committed = coded.filter(c => c.committed)
log(`implemented: ${committed.length}/${items.length} items committed`)
if (committed.length === 0) return { error: 'no work item produced a commit', design, coded }

// ---- Phase 4: Integrate ----
phase('Integrate')
const INTEGRATE_SCHEMA = {
  type: 'object', required: ['merged', 'summary'],
  properties: {
    merged: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}
const integration = await agent(
  `In the main working tree, merge these branches (created by parallel coders in worktrees) into the current ` +
  `branch, in this order, resolving any conflicts in favor of the overall design:\n` +
  committed.map(c => `- ${c.branch}: ${c.summary}`).join('\n') +
  `\n\nDesign for conflict resolution context:\n${design}\n` +
  'Do not push. Report which branches merged and any conflicts you resolved.',
  { label: 'integrate', schema: INTEGRATE_SCHEMA },
)
if (!integration) return { error: 'integration failed', design, coded }

// ---- Phase 5: Verify (tests + adversarial review, fix loop) ----
const REVIEW_SCHEMA = {
  type: 'object', required: ['passed', 'issues'],
  properties: {
    passed: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'issue', 'severity'],
        properties: {
          file: { type: 'string' }, line: { type: 'integer' },
          issue: { type: 'string' }, severity: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
    testOutput: { type: 'string' },
  },
}
const MAX_FIX_ROUNDS = 3
let verifyRound = 0
let lastReview = null
while (verifyRound < MAX_FIX_ROUNDS) {
  if (budget.total && budget.remaining() < 40000) { log('budget guard: stopping fix loop'); break }
  verifyRound += 1
  const checks = (await parallel([
    () => agent(
      (testCommand
        ? `Run \`${testCommand}\` in the main working tree.`
        : 'Detect and run this project’s build and test commands in the main working tree.') +
      ' Report passed:true only if everything is green. Put failing output in testOutput. issues: one entry ' +
      'per distinct failure with the file it points at.',
      { label: `test:r${verifyRound}`, phase: 'Verify', schema: REVIEW_SCHEMA },
    ),
    () => agent(
      `Adversarially review the uncommitted-plus-recent changes for: ${request}\n` +
      'Lens: correctness and integration seams (the code was written by parallel agents and merged — hunt for ' +
      'mismatched contracts between their pieces). passed:true only if you found no high/medium issues.',
      { label: `review:r${verifyRound}`, phase: 'Verify', schema: REVIEW_SCHEMA },
    ),
  ])).filter(Boolean)
  lastReview = checks
  const failures = checks.flatMap(c => (c.passed ? [] : c.issues))
  if (failures.length === 0) { log(`verify round ${verifyRound}: green`); break }
  log(`verify round ${verifyRound}: ${failures.length} issues, fixing`)
  await agent(
    `Fix these issues in the main working tree and commit the fixes:\n${JSON.stringify(failures)}\n` +
    `Context — the feature being built: ${request}\nDesign:\n${design}`,
    { label: `fix:r${verifyRound}`, phase: 'Verify' },
  )
}
const green = lastReview && lastReview.length > 0 && lastReview.every(c => c.passed)

return {
  design,
  items: items.map(i => i.title),
  integration: integration.summary,
  verifyRounds: verifyRound,
  green: !!green,
  remainingIssues: green ? [] : (lastReview || []).flatMap(c => (c.passed ? [] : c.issues)),
}
