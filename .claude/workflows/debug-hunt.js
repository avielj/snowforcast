export const meta = {
  name: 'debug-hunt',
  description: 'Symptom to root cause: establish a reproduction, fan out diverse hypothesis generators, empirically test each hypothesis (confirm AND refute), fix the confirmed cause, verify the repro is gone',
  whenToUse: 'Debugging one concrete symptom — a crash, wrong output, flaky behavior. Depth-first elimination, not breadth-first audit. args: {symptom: string, repro?: string, paths?: string[]}',
  phases: [
    { title: 'Reproduce', detail: 'establish or confirm a reproduction' },
    { title: 'Hypothesize', detail: 'diverse lenses propose candidate causes' },
    { title: 'Test', detail: 'each hypothesis empirically confirmed or refuted' },
    { title: 'Fix', detail: 'fix the root cause, verify repro gone + no regressions' },
  ],
}

const symptom = (args && args.symptom) || null
if (!symptom) return { error: 'debug-hunt requires args.symptom' }
const reproHint = (args && args.repro) || null
const roots = (args && args.paths) || ['the whole repository']

// ---- Phase 1: Reproduce ----
phase('Reproduce')
const REPRO_SCHEMA = {
  type: 'object', required: ['reproduced', 'observation'],
  properties: {
    reproduced: { type: 'boolean' },
    command: { type: 'string' },
    observation: { type: 'string' },
  },
}
const repro = await agent(
  `Symptom: ${symptom}\n` +
  (reproHint ? `Suggested reproduction: ${reproHint}\n` : '') +
  'Establish a reproduction: a command (or minimal script in the scratchpad) that demonstrably triggers the ' +
  'symptom. Run it and report what you observed. If you cannot reproduce, report reproduced:false with your ' +
  'best proxy signal (a log line, a failing assertion) and what you tried.',
  { label: 'reproduce', schema: REPRO_SCHEMA },
)
if (!repro) return { error: 'reproduction agent failed' }
if (!repro.reproduced) log('warning: no hard reproduction — proceeding on proxy signal, confidence will be lower')

// ---- Phase 2: Hypothesize (diverse lenses) ----
const HYPOTHESES_SCHEMA = {
  type: 'object', required: ['hypotheses'],
  properties: {
    hypotheses: {
      type: 'array',
      items: {
        type: 'object', required: ['cause', 'evidence', 'testPlan'],
        properties: {
          cause: { type: 'string' }, evidence: { type: 'string' }, testPlan: { type: 'string' },
        },
      },
    },
  },
}
const LENSES = [
  'code reading — trace the failing path from the observation backwards through the code',
  'git history — recent changes, reverted fixes, suspicious churn near the failing area (git log/blame/bisect)',
  'instrumentation — add temporary logging/assertions in a scratch copy, run the repro, read the signals',
  'dependencies and environment — versions, config, platform assumptions, build artifacts',
]
const norm = s => (s || '').toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 100)
const generated = (await parallel(LENSES.map(lens => () =>
  agent(
    `Symptom: ${symptom}\nReproduction: ${repro.command || 'none'} — observed: ${repro.observation}\n` +
    `Search scope: ${roots.join(', ')}\n` +
    `Your lens: ${lens}. Work ONLY through this lens; sibling agents cover the others.\n` +
    'Propose up to 3 candidate root causes. Each needs: the specific cause (file/mechanism, not a vibe), the ' +
    'evidence that points at it, and a concrete empirical test plan that would confirm or refute it.',
    { label: `hypothesize:${lens.split(' ')[0]}`, phase: 'Hypothesize', schema: HYPOTHESES_SCHEMA },
  )))).filter(Boolean)
const seenCauses = new Set()
const hypotheses = generated.flatMap(g => g.hypotheses).filter(h => {
  const k = norm(h.cause)
  if (seenCauses.has(k)) return false
  seenCauses.add(k)
  return true
})
if (hypotheses.length === 0) return { error: 'no hypotheses generated', repro }
log(`${hypotheses.length} distinct hypotheses`)

// ---- Phase 3: Test each hypothesis empirically ----
const TEST_SCHEMA = {
  type: 'object', required: ['verdict', 'evidence'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'REFUTED', 'INCONCLUSIVE'] },
    evidence: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
  },
}
const tested = (await parallel(hypotheses.map((h, i) => () =>
  agent(
    `Empirically test this root-cause hypothesis for the symptom "${symptom}".\n` +
    `Hypothesis: ${h.cause}\nClaimed evidence: ${h.evidence}\nSuggested test: ${h.testPlan}\n` +
    `Reproduction available: ${repro.command || 'none'} — observed: ${repro.observation}\n` +
    'Run actual experiments (execute the test plan or a better one you design). Seek evidence that CONFIRMS ' +
    'and evidence that REFUTES — a hypothesis you only argued about, without running anything, is INCONCLUSIVE. ' +
    'You may add temporary instrumentation but revert any file you touch before finishing.',
    { label: `test:h${i}`, phase: 'Test', schema: TEST_SCHEMA },
  ).then(v => (v ? { ...h, ...v } : null))
))).filter(Boolean)
const confirmedCauses = tested
  .filter(t => t.verdict === 'CONFIRMED')
  .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.confidence || 'low') - ['high', 'medium', 'low'].indexOf(b.confidence || 'low'))
log(`tested: ${confirmedCauses.length} confirmed, ${tested.filter(t => t.verdict === 'REFUTED').length} refuted, ${tested.filter(t => t.verdict === 'INCONCLUSIVE').length} inconclusive`)
if (confirmedCauses.length === 0) {
  return {
    rootCause: null, fixed: false, repro,
    hypotheses: tested,
    note: 'no hypothesis survived empirical testing — the inconclusive list is the starting point for a deeper hunt',
  }
}

// ---- Phase 4: Fix and verify ----
phase('Fix')
const VERIFY_SCHEMA = {
  type: 'object', required: ['reproGone', 'regressions'],
  properties: {
    reproGone: { type: 'boolean' },
    regressions: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
}
let fixed = false
let fixSummary = null
let fixedCause = null
let attempts = 0
for (const cause of confirmedCauses.slice(0, 2)) {   // at most 2 fix attempts
  if (budget.total && budget.remaining() < 40000) { log('budget guard: stopping fix attempts'); break }
  attempts += 1
  fixSummary = await agent(
    `Fix this confirmed root cause in the main working tree and commit the fix with a clear message.\n` +
    `Symptom: ${symptom}\nRoot cause: ${cause.cause}\nConfirming evidence: ${cause.evidence}\n` +
    'Fix the cause, not the symptom. Add or update a regression test that fails without the fix. ' +
    'Return a one-paragraph summary of what you changed.',
    { label: `fix:attempt${attempts}`, phase: 'Fix' },
  )
  const verify = await agent(
    `Verify a bug fix.\nSymptom was: ${symptom}\nReproduction: ${repro.command || repro.observation}\n` +
    'Run the reproduction — reproGone:true only if the symptom no longer occurs. Then run the project’s test ' +
    'suite and list any regressions the fix introduced.',
    { label: `verify:attempt${attempts}`, phase: 'Fix', schema: VERIFY_SCHEMA },
  )
  if (verify && verify.reproGone && verify.regressions.length === 0) { fixed = true; fixedCause = cause.cause; break }
  log(`fix attempt ${attempts} ${verify ? (verify.reproGone ? 'introduced regressions' : 'did not kill the repro') : 'could not be verified'} — ` +
      (attempts < 2 && confirmedCauses.length > attempts ? 'trying next confirmed cause' : 'stopping'))
  // The attempt committed changes that failed verification — revert them so
  // failures don't stack and the repo isn't left with a verified-bad fix.
  try {
    await agent(
      `The most recent commit(s) were a bug-fix attempt for "${symptom}" that FAILED verification ` +
      `(${verify ? (verify.reproGone ? `regressions: ${verify.regressions.join('; ')}` : 'the symptom still reproduces') : 'verification could not run'}). ` +
      'Identify the commit(s) created by that attempt and revert them, restoring the pre-attempt state. Commit the revert.',
      { label: `revert:attempt${attempts}`, phase: 'Fix' },
    )
  } catch (e) { log('revert agent could not run — the repo may still contain the failed fix'); break }
}

return {
  rootCause: fixed ? fixedCause : null,
  allConfirmed: confirmedCauses.map(c => c.cause),
  fixed,
  fixSummary,
  fixAttempts: attempts,
  repro,
  hypothesesTested: tested.length,
}
