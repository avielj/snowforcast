export const meta = {
  name: 'judge-panel',
  description: 'High-stakes generative task: N independent attempts from forced-diverse angles, scored by independent rubric judges, synthesized from the winner with grafts from runners-up',
  whenToUse: 'A single high-stakes artifact (design doc, tricky fix, architecture choice) where the solution space is wide. args: {task: string, rubric?: string, angles?: string[]}',
  phases: [
    { title: 'Attempt', detail: 'independent attempts, one forced angle each' },
    { title: 'Judge', detail: 'independent judges score all attempts against the rubric' },
    { title: 'Synthesize', detail: 'winner plus grafted strengths from runners-up' },
  ],
}

const task = (args && args.task) || null
if (!task) return { error: 'judge-panel requires args.task' }
const rubric = (args && args.rubric) ||
  'correctness (weight 3), simplicity (weight 2), completeness (weight 2), risk (weight 1)'
const angles = (args && args.angles) || ['MVP-first', 'risk-first', 'user-first']

// Custom fable-* worker types resolve only in sessions rooted in a repo that
// has .claude/agents/ installed. Probe once; degrade to general-purpose workers
// (prompts carry the worker rules) instead of burning rounds on a dead fleet.
let workerTypesAvailable = true
try {
  workerTypesAvailable = !!(await agent('Return exactly: ok', { label: 'probe:worker-types', agentType: 'fable-judge' }))
} catch (e) { workerTypesAvailable = false }
if (!workerTypesAvailable) log('fable-* agent types unavailable in this session — using general-purpose workers')
const asWorker = type => (workerTypesAvailable ? { agentType: type } : {})

// ---- Phase 1: Attempts ----
phase('Attempt')
const attempts = (await parallel(angles.map((angle, i) => () =>
  agent(
    `Produce your best complete solution for this task: ${task}\n` +
    `Your forced angle: ${angle}. Commit to this angle — other agents cover the alternatives; ` +
    'do not hedge across approaches.\n' +
    'Ground every claim in the actual codebase (read the files you reference). ' +
    'Return the full artifact as raw markdown, no preamble.',
    { label: `attempt:${angle}`, phase: 'Attempt' },
  ).then(text => (text ? { angle, index: i + 1, text } : null))
))).filter(Boolean)
if (attempts.length === 0) return { error: 'all attempt agents failed' }

// ---- Phase 2: Judges ----
const SCORES_SCHEMA = {
  type: 'object',
  required: ['scores', 'winner', 'graftFromLosers'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object', required: ['attempt', 'weightedTotal'],
        properties: {
          attempt: { type: 'integer' },
          byCriterion: { type: 'object' },
          weightedTotal: { type: 'number' },
          strengths: { type: 'array', items: { type: 'string' } },
          weaknesses: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    winner: { type: 'integer' },
    graftFromLosers: { type: 'array', items: { type: 'string' } },
  },
}
const attemptsBlock = attempts
  .map(a => `--- ATTEMPT ${a.index} (angle: ${a.angle}) ---\n${a.text}`)
  .join('\n\n')
const judgments = (await parallel([1, 2, 3].map(j => () =>
  agent(
    `Score these ${attempts.length} independent attempts at the same task. Task: ${task}\n` +
    `Use the exact ATTEMPT numbers shown in the headers — they may be non-contiguous; never renumber them.\n` +
    `Rubric — score each attempt 1-10 per criterion, then compute weighted totals: ${rubric}\n` +
    'Judge the artifact, not the presentation. Verify claims against the actual codebase where attempts ' +
    'reference real files. Always name at least one graft-worthy element from a losing attempt.\n\n' +
    attemptsBlock,
    { label: `judge:${j}`, phase: 'Judge', schema: SCORES_SCHEMA, ...asWorker('fable-judge') },
  )))).filter(Boolean)
if (judgments.length === 0) return { error: 'all judges failed', attempts }

const tally = {}
for (const j of judgments) for (const s of j.scores) tally[s.attempt] = (tally[s.attempt] || 0) + s.weightedTotal
// Only rank attempt numbers that actually exist — a judge hallucinating an
// index must not silently crown attempts[0].
const validIndices = new Set(attempts.map(a => a.index))
const ranked = Object.keys(tally).map(Number).filter(i => validIndices.has(i)).sort((a, b) => tally[b] - tally[a])
if (ranked.length === 0) log('warning: no judge score matched a real attempt number — defaulting to first attempt')
const winner = attempts.find(a => a.index === ranked[0]) || attempts[0]
const grafts = judgments.flatMap(j => j.graftFromLosers)
const notes = judgments.flatMap(j => j.scores).filter(s => s.attempt !== winner.index)
log(`winner: attempt ${winner.index} (${winner.angle}); ${grafts.length} graft suggestions`)

// ---- Phase 3: Synthesize ----
phase('Synthesize')
const losers = attempts.filter(a => a.index !== winner.index)
const finalArtifact = await agent(
  `Produce the final artifact for: ${task}\n\n` +
  `Start from this winning attempt's structure — do not rewrite from scratch:\n${winner.text}\n\n` +
  `Graft in these specific strengths the judges named from the runners-up:\n${grafts.map(g => `- ${g}`).join('\n')}\n\n` +
  `Runner-up attempts for reference:\n${losers.map(a => `--- (angle: ${a.angle}) ---\n${a.text}`).join('\n\n')}\n\n` +
  `Judges' notes on runner-ups: ${JSON.stringify(notes)}\n` +
  'Return the final artifact as raw markdown, no preamble.',
  { label: 'synthesize', ...asWorker('fable-synthesizer') },
)

return {
  artifact: finalArtifact || winner.text,
  synthesisFailed: !finalArtifact,
  winnerAngle: winner.angle,
  tally,
  grafts,
}
