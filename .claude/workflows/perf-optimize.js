export const meta = {
  name: 'perf-optimize',
  description: 'Measurement-gated optimization: baseline benchmarks, profile-driven hotspot list, parallel optimization attempts in worktrees, empirical accept/reject gate, integrate winners and re-measure',
  whenToUse: 'Performance work where changes must prove themselves with numbers, not vibes. args: {target: string, benchCommand: string, minGainPct?: number}',
  phases: [
    { title: 'Baseline', detail: 'measure current performance, enumerate hotspots from profile data' },
    { title: 'Attempt', detail: 'one optimization attempt per hotspot, each self-measured in a worktree' },
    { title: 'Integrate', detail: 'merge accepted attempts one at a time, re-measure after each' },
  ],
}

const target = (args && args.target) || null
const benchCommand = (args && args.benchCommand) || null
if (!target || !benchCommand) return { error: 'perf-optimize requires args.target and args.benchCommand' }
const minGainPct = (args && args.minGainPct) || 5

// ---- Phase 1: Baseline + hotspots ----
phase('Baseline')
const BASELINE_SCHEMA = {
  type: 'object', required: ['metric', 'value', 'runs'],
  properties: {
    metric: { type: 'string' }, value: { type: 'number' },
    runs: { type: 'integer' }, noisePct: { type: 'number' },
  },
}
const baseline = await agent(
  `Run \`${benchCommand}\` at least 3 times and report the performance baseline for: ${target}\n` +
  'Report the headline metric name (e.g. "p50 ms", "ops/sec"), its median value across runs, how many runs, ' +
  'and the observed run-to-run noise as a percentage. Lower-is-better metrics: report as-is and say so in the ' +
  'metric name (e.g. "p50 ms (lower is better)").',
  { label: 'baseline', schema: BASELINE_SCHEMA },
)
if (!baseline) return { error: 'baseline agent failed' }
log(`baseline: ${baseline.metric} = ${baseline.value} (${baseline.runs} runs, ±${baseline.noisePct || '?'}% noise)`)

const HOTSPOTS_SCHEMA = {
  type: 'object', required: ['hotspots'],
  properties: {
    hotspots: {
      type: 'array',
      items: {
        type: 'object', required: ['location', 'why', 'idea'],
        properties: {
          location: { type: 'string' }, why: { type: 'string' }, idea: { type: 'string' },
        },
      },
    },
  },
}
const profile = await agent(
  `Profile the workload behind \`${benchCommand}\` (use whatever profiler fits this project, or targeted ` +
  `timing instrumentation in a scratch copy) and enumerate up to 6 hotspots relevant to: ${target}\n` +
  'Each hotspot: the code location (path:symbol), why the profile blames it (numbers, not intuition), and one ' +
  'concrete optimization idea. Hotspots must come from measurement — a hotspot you only suspect does not count.',
  { label: 'profile', schema: HOTSPOTS_SCHEMA },
)
const hotspots = ((profile && profile.hotspots) || []).slice(0, 6)
if (hotspots.length === 0) return { baseline, note: 'no measured hotspots found' }

// ---- Phase 2: Attempts (each self-measures in its own worktree) ----
const ATTEMPT_SCHEMA = {
  type: 'object', required: ['branch', 'committed', 'before', 'after', 'gainPct'],
  properties: {
    branch: { type: 'string' }, committed: { type: 'boolean' },
    before: { type: 'number' }, after: { type: 'number' },
    gainPct: { type: 'number' }, summary: { type: 'string' },
  },
}
const attempts = (await parallel(hotspots.map((h, i) => () =>
  agent(
    `You are optimizing in an isolated git worktree. Target: ${target}\n` +
    `Hotspot: ${h.location} — profile evidence: ${h.why}\nStarting idea: ${h.idea}\n` +
    `Benchmark: \`${benchCommand}\` (headline metric: ${baseline.metric}).\n` +
    'Procedure: (1) run the benchmark 3+ times in YOUR worktree to get your own before-value; (2) implement ' +
    'the optimization WITHOUT changing observable behavior; (3) run the benchmark 3+ more times; (4) report ' +
    'median before, median after, and gainPct (positive = improvement, regardless of metric direction). ' +
    `Commit to branch perf/attempt-${i} only if behavior is preserved. Report honestly — an independent ` +
    'measurement gate re-checks integrated attempts, and inflated numbers get your branch reverted.',
    { label: `attempt:${i}:${h.location.slice(0, 25)}`, phase: 'Attempt', schema: ATTEMPT_SCHEMA, isolation: 'worktree' },
  )))).filter(Boolean)
// Accept gate: claimed gain must clear both the floor and the measured noise.
const noiseFloor = Math.max(minGainPct, (baseline.noisePct || 0) * 2)
const accepted = attempts.filter(a => a.committed && a.gainPct >= noiseFloor)
log(`attempts: ${attempts.length} ran, ${accepted.length} cleared the ${noiseFloor}% gate`)
if (accepted.length === 0) {
  return { baseline, hotspots, attempts, integrated: [], note: 'no attempt cleared the measurement gate' }
}

// ---- Phase 3: Integrate winners one at a time, re-measuring after each ----
phase('Integrate')
const INTEGRATE_SCHEMA = {
  type: 'object', required: ['kept', 'reverted', 'finalValue'],
  properties: {
    kept: { type: 'array', items: { type: 'string' } },
    reverted: { type: 'array', items: { type: 'string' } },
    finalValue: { type: 'number' },
    detail: { type: 'string' },
  },
}
let integration = null
try {
  integration = await agent(
  `Integrate these performance branches into the main working tree ONE AT A TIME, largest claimed gain first:\n` +
  accepted
    .sort((a, b) => b.gainPct - a.gainPct)
    .map(a => `- ${a.branch}: claimed +${a.gainPct}% (${a.summary || ''})`)
    .join('\n') +
  `\n\nAfter EACH merge: run \`${benchCommand}\` 3+ times. Keep the merge only if the median improves vs the ` +
  `previous kept state by more than the noise (${baseline.noisePct || minGainPct}%); otherwise revert that ` +
  `merge and move on — gains measured in isolation do not always survive composition. ` +
  `Starting point: ${baseline.metric} = ${baseline.value}. Report kept branches, reverted branches, and the ` +
  'final measured value. Do not push.',
  { label: 'integrate-and-gate', schema: INTEGRATE_SCHEMA },
  )
} catch (e) { log('integration agent could not run (budget exhausted)') }
if (!integration) return { baseline, attempts, accepted: accepted.map(a => a.branch), note: 'integration did not run — branches remain unmerged' }

return {
  baseline,
  finalValue: integration.finalValue,
  kept: integration.kept,
  reverted: integration.reverted,
  attemptsRan: attempts.length,
  gate: `${noiseFloor}% (max of minGainPct ${minGainPct}% and 2x measured noise)`,
}
