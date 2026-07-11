export const meta = {
  name: 'self-heal',
  description: 'Health-check → diagnose → fix → re-verify loop: run health checks, diagnose failures (mechanical vs deep), auto-fix mechanical breakage via nested fix-until-green, verify healing, report honestly what remains',
  whenToUse: 'Keeping a project green autonomously — after risky merges, on a schedule (pair with cron/Routines for continuous self-healing), or when "something broke overnight". args: {checks: string[], context?: string, autoFix?: boolean}',
  phases: [
    { title: 'Health', detail: 'run every health check in parallel' },
    { title: 'Diagnose', detail: 'classify each failure: mechanical fallout vs deep cause' },
    { title: 'Heal', detail: 'nested fix-until-green per mechanical failure; deep causes get a diagnosis dossier' },
    { title: 'Reverify', detail: 're-run all checks, report healed vs still-failing' },
  ],
}

const checks = (args && args.checks) || null
if (!checks || !checks.length) return { error: 'self-heal requires args.checks (health check commands)' }
const context = (args && args.context) || ''
const autoFix = !args || args.autoFix !== false   // default true

const HEALTH_SCHEMA = {
  type: 'object', required: ['healthy', 'summary'],
  properties: {
    healthy: { type: 'boolean' },
    summary: { type: 'string' },
    failureOutput: { type: 'string' },
  },
}
const runHealth = (phaseTitle, tag) => parallel(checks.map((c, i) => () =>
  agent(
    `Run this health check: \`${c}\`\nReport healthy:true only on a clean pass. On failure, summarize what ` +
    'failed and include the key failure output. Fix nothing.',
    { label: `${tag}:${i}:${c.slice(0, 25)}`, phase: phaseTitle, schema: HEALTH_SCHEMA },
  ).then(r => ({ check: c, result: r }), () => ({ check: c, result: null }))))

// ---- Phase 1: Health ----
const initial = await runHealth('Health', 'health')
const failing = initial.filter(h => !h.result || !h.result.healthy)
const brokenFromStart = initial.filter(h => !h.result).map(h => h.check)
if (failing.length === 0) {
  return { healthy: true, checks: checks.length, note: 'all health checks green — nothing to heal' }
}
log(`health: ${failing.length}/${checks.length} checks failing`)

// ---- Phase 2: Diagnose ----
const DIAG_SCHEMA = {
  type: 'object', required: ['cause', 'mechanical', 'evidence'],
  properties: {
    cause: { type: 'string' },
    mechanical: { type: 'boolean' },
    evidence: { type: 'string' },
    suspectCommits: { type: 'array', items: { type: 'string' } },
  },
}
const diagnosed = (await parallel(failing.map(f => () =>
  agent(
    `Diagnose why this health check fails: \`${f.check}\`\n` +
    `Failure summary: ${f.result ? f.result.summary : 'check agent itself failed'}\n` +
    `Output: ${f.result ? (f.result.failureOutput || 'n/a') : 'n/a'}\n` +
    (context ? `Context: ${context}\n` : '') +
    'Investigate for real: re-run it, read the failing code, check recent commits (git log) for the breaking ' +
    'change. Classify: mechanical:true if this is fixable fallout (type error, broken import, stale snapshot, ' +
    'lint, config drift) that a fixer with the check as its oracle can converge on; mechanical:false if it needs ' +
    'root-cause debugging or a product decision (flaky infra, behavioral regression with unclear intent, ' +
    'external dependency down). Fix nothing yet.',
    { label: `diagnose:${f.check.slice(0, 25)}`, phase: 'Diagnose', schema: DIAG_SCHEMA },
  ).then(d => ({ check: f.check, diagnosis: d }))))).filter(x => x.diagnosis)
const mechanical = diagnosed.filter(d => d.diagnosis.mechanical)
const deep = diagnosed.filter(d => !d.diagnosis.mechanical)
log(`diagnosis: ${mechanical.length} mechanical, ${deep.length} deep, ${failing.length - diagnosed.length} undiagnosed`)

// ---- Phase 3: Heal (mechanical only — deep causes get a dossier, not blind fixes) ----
const healAttempts = []
if (autoFix) {
  for (const m of mechanical) {
    if (budget.total && budget.remaining() < 60000) { log('budget guard: stopping heal loop'); break }
    try {
      // Nested fix-until-green with the failing check as the oracle (one nesting level).
      const outcome = await workflow('fix-until-green', {
        check: m.check,
        context: `Self-heal run. Diagnosis: ${m.diagnosis.cause} (evidence: ${m.diagnosis.evidence}). ${context}`,
        maxRounds: 3,
      })
      healAttempts.push({ check: m.check, outcome })
    } catch (e) {
      log(`nested fix-until-green unavailable for ${m.check} — attempting a single guarded fix`)
      try {
        await agent(
          `Fix this health-check failure and commit: \`${m.check}\` fails because: ${m.diagnosis.cause}\n` +
          `Evidence: ${m.diagnosis.evidence}\nFix the root of the mechanical breakage; re-run the check before finishing.`,
          { label: `heal:${m.check.slice(0, 25)}`, phase: 'Heal' },
        )
        healAttempts.push({ check: m.check, outcome: 'single-fix attempted' })
      } catch (e2) { log('heal agent could not run (budget exhausted)'); break }
    }
  }
} else log('autoFix=false — reporting diagnosis only')

// ---- Phase 4: Reverify ----
let final = initial
if (autoFix && healAttempts.length > 0) {
  final = await runHealth('Reverify', 'reverify')
}
const stillFailing = final.filter(h => !h.result || !h.result.healthy).map(h => h.check)
const healed = failing.map(f => f.check).filter(c => !stillFailing.includes(c))
log(`reverify: ${healed.length} healed, ${stillFailing.length} still failing`)

return {
  healthy: stillFailing.length === 0,
  healed,
  stillFailing,
  deepCauses: deep.map(d => ({
    check: d.check,
    cause: d.diagnosis.cause,
    evidence: d.diagnosis.evidence,
    suspectCommits: d.diagnosis.suspectCommits || [],
    next: 'needs debug-hunt or a human decision — not auto-fixed by design',
  })),
  undiagnosed: [...brokenFromStart, ...failing.filter(f => !diagnosed.some(d => d.check === f.check)).map(f => f.check)],
  healAttempts: healAttempts.length,
  autoFix,
}
