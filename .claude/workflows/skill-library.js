export const meta = {
  name: 'skill-library',
  description: 'Retiring-expert knowledge distillation: investigate the repo like an incoming principal engineer, author a complete .claude/skills/ library in parallel (one skill per agent, ground-truth-only), then three-lens review (factual / doctrine / usability) and fix',
  whenToUse: 'Building a project skill library so junior engineers and smaller models can carry the project forward. Run once without answers to get the five discovery questions, then re-run with args.answers. args: {answers?: string, maxSkills?: number}',
  phases: [
    { title: 'Discover', detail: 'parallel investigators map the repo; five questions only the owner can answer' },
    { title: 'Plan', detail: 'adapt the skill taxonomy to what discovery found' },
    { title: 'Author', detail: 'one skill per agent, authoring rules baked into every prompt' },
    { title: 'Review', detail: 'factual, doctrine, and usability reviewers over the complete set' },
    { title: 'Fix', detail: 'apply blocking and important fixes, deliver the inventory' },
  ],
}

// Defensive: some harnesses deliver `args` as a JSON-encoded STRING rather than
// an object (violating the runtime contract's "objects arrive as real JSON").
// Coerce so args.answers resolves either way.
const _args = (typeof args === 'string')
  ? (() => { try { return JSON.parse(args) } catch (e) { return {} } })()
  : (args || {})
const answers = (_args && _args.answers) || null
const maxSkills = (_args && _args.maxSkills) || 16

// Baked into EVERY authoring agent's prompt — the contract that keeps the
// library trustworthy for a zero-context reader.
const AUTHORING_RULES = `AUTHORING RULES (non-negotiable):
- Audience: a zero-context mid-level engineer or smaller AI model. Imperative runbook voice; copy-pasteable commands; every jargon term defined once; tables and checklists; each skill says when NOT to use it and which sibling skill to use instead.
- Format: .claude/skills/<name>/SKILL.md, YAML frontmatter with kebab-case name matching the folder and a trigger-rich description (exactly when a model should load it).
- GROUND TRUTH ONLY: verify every command, flag, path, and claim against the repo before stating it. Wrong runbooks are worse than none.
- Embed knowledge; never reference private or user-specific paths as load-bearing sources.
- Date-stamp volatile facts; end the skill with a "Provenance and maintenance" section containing one-line re-verification commands for anything that may drift.
- No oversell: unproven things stay labeled open/candidate. Nothing may contradict the project's own manifest or rules, and no skill may route around its change control.
- Write ONLY inside .claude/skills/; the rest of the repo is read-only to you; no mutating git commands.`

// ---- Phase 1: Discover ----
phase('Discover')
const DISCOVERY_SCHEMA = {
  type: 'object', required: ['summary', 'facts'],
  properties: {
    summary: { type: 'string' },
    facts: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const INVESTIGATIONS = [
  'build, test, and CI — how this project is actually built, tested, and shipped (manifests, scripts, CI config); run the commands to confirm they work',
  'git history — what changed recently, what got reverted, what stalled on dead branches, TODO/FIXME hotspots, the incidents behind current rules',
  'docs and conventions — README/contributor docs, docs directories, issue-shaped artifacts, deploy/data conventions, project memory or notes',
  'architecture — the load-bearing design decisions visible in the code, the invariants that must hold, the known-weak points',
]
const investigations = (await parallel(INVESTIGATIONS.map(inv => () =>
  agent(
    `Investigate this repository like an incoming principal engineer.\n` +
    `Your investigation: ${inv}. Work ONLY this angle; sibling agents cover the rest.\n` +
    'Return a compact summary plus discrete verified facts (each checked against the repo, with the file/command ' +
    'that proves it) and risks/unknowns.',
    { label: `discover:${inv.split(' ')[0]}`, phase: 'Discover', schema: DISCOVERY_SCHEMA },
  ).then(r => (r ? { investigation: inv, ...r } : null))
))).filter(Boolean)
if (investigations.length === 0) return { error: 'all discovery investigators failed' }
const discovery = investigations
  .map(i => `## ${i.investigation}\n${i.summary}\nFacts:\n${i.facts.map(f => `- ${f}`).join('\n')}\nRisks: ${(i.risks || []).join('; ')}`)
  .join('\n\n')

const QUESTIONS_SCHEMA = {
  type: 'object', required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'string' } } },
}
const q = await agent(
  `Given this repo discovery, compose AT MOST five questions for the project owner — ONLY for what the repo ` +
  `cannot tell you. Likely: the hardest live problem right now; unwritten discipline rules (things you're not ` +
  `allowed to do that no doc states); the audience for the skill library and what they do NOT know; which past ` +
  `failures cost the most time; what "beyond state of the art" means for this project.\n\nDiscovery:\n${discovery}`,
  { label: 'questions', phase: 'Discover', schema: QUESTIONS_SCHEMA },
)
const questions = (q && q.questions) || []
if (!answers) {
  // The runtime takes no mid-run user input — return the questions so the
  // orchestrator can ask the owner and re-run with args.answers.
  return {
    needsAnswers: true,
    questions,
    discoverySummary: discovery,
    note: 're-run skill-library with args.answers (the owner’s answers, any format) to author the library',
  }
}

// ---- Phase 2: Plan the taxonomy ----
phase('Plan')
const PLAN_SCHEMA = {
  type: 'object', required: ['skills'],
  properties: {
    skills: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'purpose', 'mustCover'],
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          mustCover: { type: 'array', items: { type: 'string' } },
          whenNotToUse: { type: 'string' },
        },
      },
    },
  },
}
const plan = await agent(
  `Design a skill-library taxonomy for this project: 10–${maxSkills} skills, ADAPTED to what discovery found — ` +
  'merge categories that are thin here, split ones that are deep, add domain categories the template lacks.\n' +
  'Base taxonomy — CORE: change-control (how changes are gated, non-negotiables with rationale and incident ' +
  'history), debugging-playbook (symptom→triage table, costly traps, discriminating experiments), ' +
  'failure-archaeology (every major dead end: symptom→root cause→evidence→status), architecture-contract ' +
  '(load-bearing decisions, invariants, known-weak points), domain-reference (the domain theory as it applies ' +
  'HERE), config-and-flags, build-and-env, run-and-operate, diagnostics-and-tooling (how to MEASURE instead of ' +
  'eyeball), validation-and-qa, docs-and-writing, external-positioning. ADVANCED: <hardest-problem>-campaign ' +
  '(executable decision-gated plan with expected observations at every gate), proof-and-analysis-toolkit, ' +
  'research-frontier, research-methodology.\n' +
  `Each skill: kebab-case name prefixed with the project name, purpose, what it must cover, when NOT to use it ` +
  `(and which sibling to use).\n\nDiscovery:\n${discovery}\n\nOwner's answers to the discovery questions ` +
  `(fold these into everything):\n${answers}`,
  { label: 'taxonomy', schema: PLAN_SCHEMA },
)
const skills = ((plan && plan.skills) || []).slice(0, maxSkills)
if (skills.length === 0) return { error: 'taxonomy planning failed', discovery, questions }
log(`taxonomy: ${skills.length} skills planned`)

// ---- Phase 3: Author (one skill per agent, in parallel — disjoint dirs, no worktrees needed) ----
const AUTHOR_SCHEMA = {
  type: 'object', required: ['name', 'written', 'uncertain'],
  properties: {
    name: { type: 'string' },
    written: { type: 'boolean' },
    uncertain: { type: 'array', items: { type: 'string' } },
    verifiedCommands: { type: 'integer' },
  },
}
const siblingList = skills.map(s => `- ${s.name}: ${s.purpose}`).join('\n')
const authorResults = await parallel(skills.map(s => () =>
  agent(
    `Author the skill .claude/skills/${s.name}/SKILL.md for this project.\n` +
    `Purpose: ${s.purpose}\nMust cover:\n${s.mustCover.map(m => `- ${m}`).join('\n')}\n` +
    `When NOT to use it: ${s.whenNotToUse || 'state this yourself based on the sibling list'}\n` +
    `Sibling skills (cross-reference instead of duplicating — one home per fact):\n${siblingList}\n\n` +
    `${AUTHORING_RULES}\n\n` +
    `Owner's context:\n${answers}\n\n` +
    'Write the file. Report uncertain: every claim you could not fully verify against the repo (these stay ' +
    'labeled open/candidate in the skill), and verifiedCommands: how many commands you actually ran to verify.',
    { label: `author:${s.name}`, phase: 'Author', schema: AUTHOR_SCHEMA },
  )))
const authored = authorResults.filter(Boolean)
const written = authored.filter(a => a.written)
log(`authored: ${written.length}/${skills.length} skills`)
if (written.length === 0) return { error: 'no skill was written', skills }

// ---- Phase 4: Review (three lenses over the COMPLETE set — a barrier is correct here) ----
const REVIEW_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['skill', 'issue', 'severity'],
        properties: {
          skill: { type: 'string' }, issue: { type: 'string' },
          severity: { enum: ['blocking', 'important', 'minor'] },
          fix: { type: 'string' },
        },
      },
    },
  },
}
const LENSES = [
  'FACTUAL — re-verify flags, paths, commands, and citations against the repo (run them); flag anything invented or stale; severity by "would it send an engineer down a wrong path?"',
  'DOCTRINE — contradictions with the project’s own rules or between skills; overstated claims; missing gating on anything that changes behavior',
  'USABILITY — trigger quality of frontmatter descriptions, duplication (one home per fact, cross-references elsewhere), self-containedness, scannability',
]
const reviews = (await parallel(LENSES.map(lens => () =>
  agent(
    `Review the COMPLETE skill library under .claude/skills/ (skills just authored: ` +
    `${written.map(w => w.name).join(', ')}).\nYour lens: ${lens}\nRead every skill. Report findings only — do not edit.`,
    { label: `review:${lens.split(' ')[0]}`, phase: 'Review', schema: REVIEW_SCHEMA },
  )))).filter(Boolean)
const findings = reviews.flatMap(r => r.findings)
const actionable = findings.filter(f => f.severity !== 'minor')
log(`review: ${findings.length} findings, ${actionable.length} blocking/important`)

// ---- Phase 5: Fix + inventory ----
phase('Fix')
let fixesApplied = false
if (actionable.length > 0) {
  try {
    await agent(
      `Apply these blocking and important fixes to the skills under .claude/skills/ (edit only there):\n` +
      `${JSON.stringify(actionable)}\n\n${AUTHORING_RULES}`,
      { label: 'fixer', phase: 'Fix' },
    )
    fixesApplied = true
  } catch (e) { log('fixer could not run (budget exhausted) — findings returned unfixed') }
}
const inventory = skills.map((s, i) => {
  const a = authorResults[i]   // index-aligned; agents may not echo names verbatim
  return {
    name: s.name,
    purpose: s.purpose,
    written: !!(a && a.written),
    uncertain: a ? a.uncertain : ['author agent failed'],
  }
})

return {
  inventory,
  reviewFindings: findings.length,
  fixed: actionable.length,
  fixesApplied,
  minorLeft: findings.length - actionable.length,
  uncertainOverall: authored.flatMap(a => a.uncertain),
  questionsAsked: questions,
}
