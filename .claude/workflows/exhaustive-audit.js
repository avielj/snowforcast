export const meta = {
  name: 'exhaustive-audit',
  description: 'Repo-wide exhaustive sweep: sharded multi-modal finders, loop-until-dry, diverse-lens adversarial verify, completeness critic with gap loop-back, synthesized report',
  whenToUse: 'Repo-wide audits and "find all X" tasks that must not miss the tail. args: {goal: string, paths?: string[], lenses?: string[]}',
  phases: [
    { title: 'Survey', detail: 'enumerate the target surface and shard it' },
    { title: 'Find', detail: 'modality-diverse finder rounds until 2 consecutive dry rounds' },
    { title: 'Verify', detail: 'diverse-lens skeptics per finding, pipelined with find rounds' },
    { title: 'Critique', detail: 'completeness critic; material gaps trigger one scoped find round' },
    { title: 'Synthesize', detail: 'merged report with known limitations' },
  ],
}

const goal = (args && args.goal) || 'Find correctness bugs and unsafe patterns'
const roots = (args && args.paths) || ['the whole repository']
const lenses = (args && args.lenses) || ['correctness', 'security', 'reproduction']

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'coverage'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'symbol', 'issue', 'severity', 'evidence'],
        properties: {
          file: { type: 'string' }, line: { type: 'integer' }, symbol: { type: 'string' },
          issue: { type: 'string' }, severity: { enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
      },
    },
    coverage: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'covered'],
        properties: { file: { type: 'string' }, covered: { type: 'boolean' }, note: { type: 'string' } },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'confidence', 'reasoning'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'REFUTED'] },
    confidence: { enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' }, evidence: { type: 'string' },
  },
}

const GAPS_SCHEMA = {
  type: 'object',
  required: ['gaps', 'materialGaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object', required: ['kind', 'description', 'suggestedAction'],
        properties: {
          kind: { enum: ['coverage', 'modality', 'category', 'verification'] },
          description: { type: 'string' }, suggestedAction: { type: 'string' },
        },
      },
    },
    materialGaps: { type: 'boolean' },
  },
}

// Custom fable-* worker types resolve only in sessions rooted in a repo that
// has .claude/agents/ installed. Probe once; degrade to general-purpose workers
// (prompts carry the worker rules) instead of burning rounds on a dead fleet.
let workerTypesAvailable = true
try {
  workerTypesAvailable = !!(await agent('Return exactly: ok', { label: 'probe:worker-types', agentType: 'fable-finder' }))
} catch (e) { workerTypesAvailable = false }
if (!workerTypesAvailable) log('fable-* agent types unavailable in this session — using general-purpose workers')
const asWorker = type => (workerTypesAvailable ? { agentType: type } : {})

// ---- Phase 1: Survey ----
phase('Survey')
const SURVEY_SCHEMA = {
  type: 'object', required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
}
const survey = await agent(
  `Enumerate every file under ${roots.join(', ')} that is relevant to this audit goal: "${goal}". ` +
  'Include source files, config, and tests that exercise the relevant behavior. ' +
  'HARD SCOPE: only files inside the listed paths — do not add files from elsewhere in the repository ' +
  'however relevant they look; mention out-of-scope suspicions in a single note instead. Return absolute paths.',
  { label: 'survey', schema: SURVEY_SCHEMA },
)
// Enforce scope in code — the survey agent treats "relevant to the goal"
// expansively even under a HARD SCOPE instruction, so filter its output to the
// requested paths deterministically instead of trusting the prompt.
const scopeRoots = (args && args.paths) || null
// Scope filter: the survey is told to return absolute paths, so a segment-wise
// prefix match is exact for any fresh run. (A path that arrives relative — only
// seen when a resumed run replays a stale cached survey; see below — simply
// won't match an absolute root and is dropped, which is the safe direction.)
const segs = p => p.replace(/\/+$/, '').split('/').filter(Boolean)
const rootSegs = scopeRoots ? scopeRoots.map(segs) : null
const underRoot = (f, r) => r.length <= segs(f).length && r.every((s, i) => segs(f)[i] === s)
const inScope = f => !scopeRoots || rootSegs.some(r => underRoot(f, r))
const surveyed = (survey && survey.files) || []
const files = surveyed.filter(inScope)
const droppedOutOfScope = surveyed.length - files.length
if (droppedOutOfScope > 0) log(`survey returned ${droppedOutOfScope} out-of-scope files — dropped (scope: ${scopeRoots.join(', ')})`)
if (files.length === 0) return { confirmed: [], note: 'survey found no in-scope files', droppedOutOfScope }

const SHARD_SIZE = 10
const makeShards = list => {
  const out = []
  for (let i = 0; i < list.length; i += SHARD_SIZE) out.push(list.slice(i, i + SHARD_SIZE))
  return out
}
const shards = makeShards(files)
log(`surveyed ${files.length} files -> ${shards.length} shards`)

const MODALITIES = ['pattern-grep', 'call-site reading', 'git history', 'test reading', 'execution']
const usedModalities = new Set()
// Dedup key: location plus a normalized issue prefix. Location alone suppresses
// distinct issues at the same symbol; raw wording alone lets paraphrases through.
const norm = s => (s || '').toLowerCase().replace(/\W+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
const key = f => `${f.file}:${f.symbol}:${norm(f.issue)}`

const seen = new Set()      // EVERYTHING ever reported — incl. later-refuted (convergence guarantee)
const uncovered = []
const uncoveredFiles = new Set()
const markUncovered = (file, note) => {
  if (!uncoveredFiles.has(file)) { uncoveredFiles.add(file); uncovered.push({ file, covered: false, note }) }
}
const verifyJobs = []       // verification pipelined with find rounds — no barrier

const verifyOne = f =>
  parallel(lenses.map(lens => () =>
    agent(
      `A prior review claimed this finding. Try to REFUTE it — find the guard, invariant, caller contract, ` +
      `config, or test that makes it a non-issue. If you cannot refute with evidence, confirm. If uncertain, lean REFUTED.\n` +
      `Your lens: ${lens}. Judge only through this lens.` +
      (lens === 'reproduction' ? ' Actually run code to reproduce it; a repro you could not make work is a refutation.\n' : '\n') +
      `Finding: ${f.file}:${f.line} ${f.symbol} — ${f.issue}\nEvidence given: ${f.evidence}\n` +
      'Read the surrounding code yourself; do not trust the claim’s framing.',
      { label: `verify:${lens}:${f.symbol}`, phase: 'Verify', schema: VERDICT_SCHEMA, ...asWorker('fable-skeptic') },
    )))
    .then(votes => {
      // Survival: strict majority of valid verdicts confirm. Failed skeptics
      // (null) don't vote. Zero valid verdicts = infrastructure failure, not a
      // refutation — bucket as unverified so it reaches the limitations section.
      const valid = votes.filter(Boolean)
      const yes = valid.filter(v => v.verdict === 'CONFIRMED').length
      const status = valid.length === 0 ? 'unverified' : (yes > valid.length / 2 ? 'confirmed' : 'refuted')
      return { ...f, status }
    })

const runFindRound = async (round, label, shardList, extraNote) => {
  const seenList = [...seen].join('; ') || 'none'
  const results = await parallel(shardList.map((shard, i) => () => {
    // Modality-diverse within each round: shard i rotates through the modality
    // list with a per-round offset so every shard sees every modality over time.
    const modality = MODALITIES[(i + round) % MODALITIES.length]
    return agent(
      `Goal: ${goal}.\n${extraNote || ''}` +
      `Your shard — examine EVERY file below and no others:\n${shard.join('\n')}\n` +
      `Your modality this round: ${modality}. Work ONLY in this modality; sibling agents cover the rest.\n` +
      `Already reported (do NOT re-report these locations): ${seenList}\n` +
      'Every finding needs concrete evidence: exact path, line, snippet, repro command where applicable. ' +
      'If you cannot cover a file, mark covered:false with a note — never claim coverage you did not do.',
      { label: `find:${label}:${modality}:shard${i}`, phase: 'Find', schema: FINDINGS_SCHEMA, ...asWorker('fable-finder') },
    ).then(
      // NOTE: a failed agent() REJECTS this promise (parallel converts to null
      // only at its own boundary) — account for failures in the second handler.
      r => {
        if (r) usedModalities.add(modality)   // only count a modality when its finder actually ran
        else shard.forEach(file => markUncovered(file, `finder agent failed (round ${label})`))
        return r
      },
      () => {
        shard.forEach(file => markUncovered(file, `finder agent failed (round ${label})`))
        return null
      },
    )
  }))
  const clean = results.filter(Boolean)
  for (const r of clean) for (const c of r.coverage) if (!c.covered) markUncovered(c.file, c.note)
  const fresh = clean.flatMap(r => r.findings).filter(f => !seen.has(key(f)))
  fresh.forEach(f => seen.add(key(f)))
  return { fresh, failedShards: results.length - clean.length }
}

// ---- Phase 2+3 pipelined: find loop-until-dry; each round's fresh findings
// ---- go straight to verification while the next round runs ----
let dry = 0
let round = 0
let totalFindings = 0
let budgetStopped = false
let systemicFailure = false
const MAX_ROUNDS = 6

while (dry < 2 && round < MAX_ROUNDS) {
  if (budget.total && budget.remaining() < 60000) {
    budgetStopped = true
    log('budget guard: stopping find rounds')
    break
  }
  round += 1
  const { fresh, failedShards } = await runFindRound(round, `r${round}`, shards)
  if (failedShards === shards.length) {
    // Every finder failed — systemic (agents unavailable, budget, infra), not
    // exhaustion. Abort instead of burning the remaining rounds on a dead fleet.
    systemicFailure = true
    log(`round ${round}: ALL ${shards.length} finders failed — aborting the find loop`)
    break
  }
  if (fresh.length === 0) {
    // A round with failed finders proves nothing about exhaustion — don't let
    // infrastructure failures masquerade as a dry round.
    if (failedShards === 0) { dry += 1; log(`round ${round}: dry (${dry}/2)`) }
    else log(`round ${round}: no new findings but ${failedShards} finder(s) failed — not counted as dry`)
  } else {
    dry = 0
    totalFindings += fresh.length
    verifyJobs.push(...fresh.map(verifyOne))   // no barrier — verify overlaps next find round
    log(`round ${round}: ${fresh.length} new findings (${totalFindings} total, verification running)`)
  }
}
const cappedOut = round >= MAX_ROUNDS && dry < 2
if (cappedOut) log(`cap: stopped at ${MAX_ROUNDS} rounds before going dry — coverage is bounded`)

const verified = (await Promise.all(verifyJobs)).filter(Boolean)   // parallel() never rejects, so this is safe
let confirmed = verified.filter(f => f.status === 'confirmed')
const unverified = verified.filter(f => f.status === 'unverified')
log(`verify: ${confirmed.length}/${totalFindings} confirmed, ${unverified.length} unverified (skeptics failed)`)

// ---- Phase 4: Completeness critic — BEFORE synthesis; material gaps trigger
// ---- one scoped find+verify round (within budget), then gaps land in the report ----
// Top-level agent() calls throw once the budget is exhausted (in-flight skeptics
// may have drained the reserve) — guard them so findings are never lost.
let critique = null
try {
  critique = await agent(
    `Original task: ${goal}\nSurface surveyed: ${files.length} files under ${roots.join(', ')}\n` +
    `Modalities run: ${[...usedModalities].join(', ') || 'none completed'}\n` +
    `Confirmed findings so far: ${JSON.stringify(confirmed)}\n` +
    `Files reported uncovered: ${JSON.stringify(uncovered)}\n` +
    'What is missing — uncovered areas, a modality not run, a category nobody looked for, an unverified claim? ' +
    'Gaps only; do not re-review the findings.',
    { label: 'completeness-critic', phase: 'Critique', schema: GAPS_SCHEMA, ...asWorker('fable-critic') },
  )
} catch (e) {
  log('completeness critic could not run (budget exhausted) — recorded as a limitation')
}
const gaps = (critique && critique.gaps) || []
let gapRoundRan = false
if (critique && critique.materialGaps && (!budget.total || budget.remaining() > 80000)) {
  gapRoundRan = true
  // Scope the gap round: if gaps name concrete files, shard only those;
  // modality/category gaps fall back to the full surface.
  const gapText = gaps.map(g => `${g.description} ${g.suggestedAction}`).join(' ')
  const gapFiles = files.filter(f => gapText.includes(f) || gapText.includes(f.split('/').pop()))
  const gapShards = gapFiles.length > 0 ? makeShards(gapFiles) : shards
  const gapNote = 'This is a targeted gap round. The completeness critic flagged these gaps — focus ONLY on them:\n' +
    gaps.map(g => `- [${g.kind}] ${g.description} (suggested: ${g.suggestedAction})`).join('\n') + '\n'
  const { fresh } = await runFindRound(round + 1, 'gap', gapShards, gapNote)
  if (fresh.length > 0) {
    const extra = (await Promise.all(fresh.map(verifyOne))).filter(Boolean)
    confirmed = confirmed.concat(extra.filter(f => f.status === 'confirmed'))
    unverified.push(...extra.filter(f => f.status === 'unverified'))
    log(`gap round: ${fresh.length} new findings, ${confirmed.length} confirmed total`)
  } else log('gap round: nothing new')
}

// ---- Phase 5: Synthesize ----
phase('Synthesize')
const limitations = {
  uncoveredFiles: uncovered,
  criticGaps: gaps,
  criticRan: !!critique,
  unverifiedFindings: unverified,
  gapRoundRan,
  roundCapHit: cappedOut,
  budgetStopped,
  systemicFailure,
}
const fallbackReport = () =>
  `Synthesis unavailable — raw confirmed findings:\n\n` +
  confirmed.map(f => `- [${f.severity}] ${f.file}:${f.line} ${f.symbol} — ${f.issue}`).join('\n') +
  `\n\nLimitations: ${JSON.stringify(limitations)}`
let report = null
try {
  report = await agent(
    `Merge these verified findings into a final audit report for: "${goal}".\n` +
    `Confirmed findings (JSON): ${JSON.stringify(confirmed)}\n` +
    `Known limitations (JSON — reproduce ALL of these in the report): ${JSON.stringify(limitations)}\n` +
    'Order by severity. Cite every claim as path:line. Include a "Known limitations" section listing the ' +
    'uncovered files, unverified findings, the critic\'s remaining gaps (note the gap round if it ran), and ' +
    'any round/budget cap that was hit. Return the report as raw markdown, no preamble.',
    { label: 'synthesize', phase: 'Synthesize', ...asWorker('fable-synthesizer') },
  )
} catch (e) {
  log('synthesizer could not run (budget exhausted) — returning raw findings')
}
report = report || fallbackReport()

return { confirmed, report, rounds: round, gapRoundRan, gaps, uncovered, unverified, roundCapHit: cappedOut, budgetStopped, systemicFailure }
