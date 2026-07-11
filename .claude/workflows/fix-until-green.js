export const meta = {
  name: 'fix-until-green',
  description: 'Checker-driven convergence loop: run an arbitrary check command, cluster failures, fix clusters in parallel, re-check — until green or two rounds without progress',
  whenToUse: 'Type-error burn-downs, lint sweeps, failing CI, builds broken by a dependency bump — any task where a command is the oracle. args: {check: string, context?: string, maxRounds?: number}',
  phases: [
    { title: 'Check', detail: 'run the checker, collect failures' },
    { title: 'Fix', detail: 'cluster failures into disjoint file sets, fix clusters in parallel' },
  ],
}

const check = (args && args.check) || null
if (!check) return { error: 'fix-until-green requires args.check (the command that must pass)' }
const context = (args && args.context) || ''
const MAX_ROUNDS = (args && args.maxRounds) || 5

const CHECK_SCHEMA = {
  type: 'object', required: ['passed', 'failures'],
  properties: {
    passed: { type: 'boolean' },
    failures: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'message'],
        properties: { file: { type: 'string' }, line: { type: 'integer' }, message: { type: 'string' } },
      },
    },
  },
}
const CLUSTERS_SCHEMA = {
  type: 'object', required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object', required: ['files', 'failures', 'instructions'],
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          failures: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
        },
      },
    },
  },
}

const runCheck = label => agent(
  `Run \`${check}\` in the repository root. Report passed:true only if it exits successfully. ` +
  'Otherwise list every distinct failure with the file it points at (absolute path), line if known, and the ' +
  'exact message. Do not fix anything.',
  { label, phase: 'Check', schema: CHECK_SCHEMA },
)

let result = await runCheck('check:baseline')
if (!result) return { error: 'baseline check agent failed' }
if (result.passed) return { green: true, rounds: 0, note: 'already green' }
log(`baseline: ${result.failures.length} failures`)

let round = 0
let stalled = 0
let stopReason = null
let prevCount = result.failures.length
const history = [prevCount]

while (!result.passed && round < MAX_ROUNDS && stalled < 2) {
  if (budget.total && budget.remaining() < 40000) { stopReason = 'budget'; log('budget guard: stopping fix loop'); break }
  round += 1

  // Cluster failures into DISJOINT file sets so fixers can edit in parallel
  // in the main tree without colliding.
  const plan = await agent(
    `Group these check failures into fix clusters. Clusters MUST have disjoint file sets (no file appears in ` +
    `two clusters — merge clusters that share files). Max 6 clusters. Each cluster: its files, its failure ` +
    `messages, and self-contained fixing instructions.\n` +
    (context ? `Context: ${context}\n` : '') +
    `Failures (JSON${result.failures.length > 250 ? `, first 250 of ${result.failures.length} — infer cluster patterns from this sample` : ''}): ` +
    JSON.stringify(result.failures.slice(0, 250)),
    { label: `cluster:r${round}`, phase: 'Fix', schema: CLUSTERS_SCHEMA },
  )
  const clusters = ((plan && plan.clusters) || []).slice(0, 6)
  if (clusters.length === 0) { stopReason = 'clustering failed'; log(`round ${round}: clustering failed — stopping`); break }

  await parallel(clusters.map((c, i) => () =>
    agent(
      `Fix these failures from \`${check}\` by editing ONLY these files (other agents own the rest):\n` +
      `${c.files.join('\n')}\n\nFailures:\n${c.failures.join('\n')}\n\nInstructions: ${c.instructions}\n` +
      (context ? `Context: ${context}\n` : '') +
      'Fix root causes, not symptoms (no ts-ignore / lint-disable / test-skip unless the instructions say so). ' +
      'Re-run the relevant slice of the check on your files before finishing. Do not commit.',
      { label: `fix:r${round}:c${i}`, phase: 'Fix' },
    )))

  result = (await runCheck(`check:r${round}`)) || result
  const count = result.passed ? 0 : result.failures.length
  history.push(count)
  // Progress-based termination: two consecutive rounds without a strict
  // decrease means the loop is churning, not converging.
  if (count >= prevCount) stalled += 1
  else stalled = 0
  prevCount = count
  log(`round ${round}: ${count} failures remaining${stalled ? ` (no progress x${stalled})` : ''}`)
}

return {
  green: !!result.passed,
  rounds: round,
  failureHistory: history,
  residualFailures: result.passed ? [] : result.failures,
  stoppedReason: result.passed ? 'green' : (stopReason || (stalled >= 2 ? 'no progress for 2 rounds' : 'round cap')),
}
