export const meta = {
  name: 'playtest-balance',
  description: 'Simulate-evaluate-tune loop for games and tunable systems: diverse player-persona agents actually run the build, findings are verified by reproduction, tunings applied, fleet replays until targets hold',
  whenToUse: 'Playtesting, balancing, or UX-tuning something runnable — a game, sim, or interactive app. args: {game: string, runCommand: string, personas?: string[], targets?: string, maxIterations?: number}',
  phases: [
    { title: 'Playtest', detail: 'persona fleet plays scripted sessions, reports findings + metrics' },
    { title: 'Assess', detail: 'verify exploit/crash findings by reproduction, decide tunings' },
    { title: 'Tune', detail: 'apply parameter/content changes, then the fleet replays' },
  ],
}

const game = (args && args.game) || null
const runCommand = (args && args.runCommand) || null
if (!game || !runCommand) return { error: 'playtest-balance requires args.game and args.runCommand' }
const personas = (args && args.personas) || [
  'completionist — explores everything, finds dead content and unreachable states',
  'speedrunner — optimizes ruthlessly, finds skips, exploits, and degenerate strategies',
  'button-masher — random/chaotic inputs, finds crashes and soft-locks',
  'min-maxer — hunts dominant builds/strategies that trivialize the balance',
]
const targets = (args && args.targets) || 'no crashes, no soft-locks, no strategy that trivializes the game, all content reachable'
const MAX_ITERATIONS = (args && args.maxIterations) || 3

const SESSION_SCHEMA = {
  type: 'object', required: ['findings', 'metrics'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['kind', 'detail', 'repro'],
        properties: {
          kind: { enum: ['crash', 'softlock', 'exploit', 'balance', 'ux', 'content'] },
          detail: { type: 'string' },
          repro: { type: 'string' },
        },
      },
    },
    metrics: { type: 'object' },
    sessionLog: { type: 'string' },
  },
}
const ASSESS_SCHEMA = {
  type: 'object', required: ['problems', 'tunings', 'targetsMet'],
  properties: {
    problems: { type: 'array', items: { type: 'string' } },
    tunings: {
      type: 'array',
      items: {
        type: 'object', required: ['where', 'change', 'rationale'],
        properties: { where: { type: 'string' }, change: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
    targetsMet: { type: 'boolean' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['verdict', 'reasoning'],
  properties: { verdict: { enum: ['CONFIRMED', 'REFUTED'] }, reasoning: { type: 'string' } },
}

const norm = s => (s || '').toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 100)
const seen = new Set()          // soft findings dedup on sight; hard findings only once CONFIRMED
let iteration = 0
let assessment = null
let prevProblems = []
let unappliedTunings = null
const history = []

while (iteration < MAX_ITERATIONS) {
  if (budget.total && budget.remaining() < 60000) { log('budget guard: stopping playtest loop'); break }
  iteration += 1

  // ---- Playtest: persona fleet actually runs the build ----
  const sessions = (await parallel(personas.map(p => () =>
    agent(
      `Playtest this build by ACTUALLY RUNNING it: ${game}\nRun with: \`${runCommand}\` ` +
      '(drive it however the harness allows: input scripts, headless flags, sim ticks, automated sessions).\n' +
      `Your persona: ${p}. Stay in character — sibling agents cover the other play styles.\n` +
      `Design targets to judge against: ${targets}\n` +
      'Report findings with a concrete repro (exact inputs/steps) — findings without a repro will be discarded. ' +
      'Also report whatever quantitative metrics the session exposes (times, scores, resource curves) in metrics.',
      { label: `play:${p.split(' ')[0]}:i${iteration}`, phase: 'Playtest', schema: SESSION_SCHEMA },
    )))).filter(Boolean)
  if (sessions.length === 0) { log(`iteration ${iteration}: every persona failed to run the build — stopping`); break }
  const keyOf = f => `${f.kind}:${norm(f.detail)}`
  const fresh = sessions.flatMap(s => s.findings).filter(f => !seen.has(keyOf(f)))

  // ---- Verify: crash/softlock/exploit claims must replay before driving tunings ----
  const hard = fresh.filter(f => ['crash', 'softlock', 'exploit'].includes(f.kind))
  const soft = fresh.filter(f => !['crash', 'softlock', 'exploit'].includes(f.kind))
  soft.forEach(f => seen.add(keyOf(f)))
  const checked = (await parallel(hard.map(f => () =>
    agent(
      `Verify this playtest finding by replaying it. Build: ${game}, run with \`${runCommand}\`.\n` +
      `Claimed ${f.kind}: ${f.detail}\nRepro steps: ${f.repro}\n` +
      'CONFIRMED only if you actually reproduced it; a repro that does not replay is REFUTED.',
      { label: `verify:${f.kind}:i${iteration}`, phase: 'Assess', schema: VERDICT_SCHEMA },
    ).then(v => (v && v.verdict === 'CONFIRMED' ? f : null))
  ))).filter(Boolean)
  // Hard findings enter `seen` only once CONFIRMED — a flaky repro must not
  // permanently suppress a real crash.
  checked.forEach(f => seen.add(keyOf(f)))
  log(`iteration ${iteration}: ${fresh.length} new findings, ${checked.length}/${hard.length} hard findings replayed`)

  // ---- Assess: metrics + verified findings -> tunings ----
  assessment = await agent(
    `Assess this playtest round for: ${game}\nDesign targets: ${targets}\n` +
    `Replayed-and-confirmed hard findings (JSON): ${JSON.stringify(checked)}\n` +
    `Soft findings (balance/ux/content — NOT replay-verified): ${JSON.stringify(soft)}\n` +
    `Unresolved problems carried from the previous iteration: ${JSON.stringify(prevProblems)}\n` +
    `Persona metrics (JSON): ${JSON.stringify(sessions.map(s => s.metrics))}\n` +
    'Decide: the real problems, and the specific tunings (parameter values, content changes, code fixes — ' +
    'where + what) that address them. targetsMet:true only if the targets hold and nothing actionable remains. ' +
    'Balance judgments must cite the metrics or a verified finding, not taste.',
    { label: `assess:i${iteration}`, phase: 'Assess', schema: ASSESS_SCHEMA },
  )
  history.push({ iteration, newFindings: fresh.length, confirmedHard: checked.length, softFindings: soft.length, problems: assessment ? assessment.problems : ['assess agent failed'] })
  if (!assessment) { log(`iteration ${iteration}: assessment failed — stopping`); break }
  prevProblems = assessment.problems
  if (assessment.targetsMet || assessment.tunings.length === 0) { log(`iteration ${iteration}: targets met`); break }
  if (iteration === MAX_ITERATIONS) {
    // Tunings applied on the final iteration would never be replayed —
    // return them unapplied rather than ship an unmeasured balance pass.
    unappliedTunings = assessment.tunings
    log(`iteration ${iteration}: iteration cap — proposed tunings returned unapplied`)
    break
  }

  // ---- Tune ----
  await agent(
    `Apply these tunings to ${game} in the main working tree and commit with a message describing the balance ` +
    `pass:\n${JSON.stringify(assessment.tunings)}\n` +
    'Make exactly these changes — the next playtest round measures their effect; do not bundle in your own ideas.',
    { label: `tune:i${iteration}`, phase: 'Tune' },
  )
}

return {
  iterations: iteration,
  targetsMet: !!(assessment && assessment.targetsMet),
  remainingProblems: assessment ? assessment.problems : [],
  unappliedTunings,
  history,
  totalUniqueFindings: seen.size,
}
