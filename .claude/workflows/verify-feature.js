export const meta = {
  name: 'verify-feature',
  description: 'End-to-end behavioral verification of a change: map the affected runtime flows, drive each one for real and observe behavior (not just tests/typecheck), adversarial edge pass, verdict',
  whenToUse: 'Before committing or shipping a nontrivial change — proves the change does what it claims by exercising it. Skip for diffs with no runtime surface (docs, pure test changes). args: {change: string, paths?: string[]}',
  phases: [
    { title: 'Map', detail: 'identify the runtime flows the change affects and how to drive them' },
    { title: 'Exercise', detail: 'drive each flow for real, observe actual behavior' },
    { title: 'Break', detail: 'adversarial edge and negative cases against the changed behavior' },
    { title: 'Verdict', detail: 'verified / failed / unexercised, with evidence' },
  ],
}

const change = (args && args.change) || null
if (!change) return { error: 'verify-feature requires args.change (what the change is supposed to do)' }
const roots = (args && args.paths) || ['the current diff / recent commits']

// ---- Phase 1: Map the runtime surface ----
phase('Map')
const MAP_SCHEMA = {
  type: 'object', required: ['hasRuntimeSurface', 'flows'],
  properties: {
    hasRuntimeSurface: { type: 'boolean' },
    flows: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'howToDrive', 'expected'],
        properties: {
          name: { type: 'string' },
          howToDrive: { type: 'string' },
          expected: { type: 'string' },
        },
      },
    },
    launchNotes: { type: 'string' },
  },
}
const map = await agent(
  `A change was just made: ${change}\nScope: ${roots.join(', ')}\n` +
  'Read the change and identify the runtime flows it affects — the user-visible or caller-visible behaviors ' +
  'that should now be different. For each flow (max 5): a name, EXACTLY how to drive it for real (the command, ' +
  'the URL and interaction, the CLI invocation, the API call — including how to launch the app if needed), and ' +
  'the expected observable behavior WITH the change. hasRuntimeSurface:false only if the change genuinely has ' +
  'nothing to drive (docs-only, test-only). Tests and typecheck do not count as flows — this workflow exists ' +
  'because they are not enough.',
  { label: 'map-surface', schema: MAP_SCHEMA },
)
if (!map) return { error: 'surface-mapping agent failed' }
if (!map.hasRuntimeSurface || map.flows.length === 0) {
  return { verified: null, note: 'no runtime surface to drive — nothing to verify behaviorally' }
}
log(`${map.flows.length} flows to exercise`)

// ---- Phase 2: Exercise each flow for real ----
const DRIVE_SCHEMA = {
  type: 'object', required: ['drove', 'observed', 'matchesExpected'],
  properties: {
    drove: { type: 'boolean' },
    observed: { type: 'string' },
    matchesExpected: { type: 'boolean' },
    evidence: { type: 'string' },
    blocker: { type: 'string' },
  },
}
const driven = (await parallel(map.flows.map(f => () =>
  agent(
    `Exercise this flow END-TO-END and observe what actually happens. The change under verification: ${change}\n` +
    `Flow: ${f.name}\nHow to drive it: ${f.howToDrive}\n` +
    (map.launchNotes ? `Launch notes: ${map.launchNotes}\n` : '') +
    `Expected behavior with the change: ${f.expected}\n` +
    'ACTUALLY run/launch/call it — reading the code or running unit tests does not count as driving the flow ' +
    '(drove:false if you could not truly exercise it, with the blocker). Report exactly what you observed and ' +
    'concrete evidence (command output, response body, log lines, screenshot path).',
    { label: `drive:${f.name.slice(0, 30)}`, phase: 'Exercise', schema: DRIVE_SCHEMA },
  ).then(r => (r ? { flow: f.name, expected: f.expected, ...r } : null))
))).filter(Boolean)

// ---- Phase 3: Adversarial edge pass ----
const BREAK_SCHEMA = {
  type: 'object', required: ['attempts', 'breaks'],
  properties: {
    attempts: { type: 'array', items: { type: 'string' } },
    breaks: {
      type: 'array',
      items: {
        type: 'object', required: ['case', 'observed'],
        properties: { case: { type: 'string' }, observed: { type: 'string' } },
      },
    },
  },
}
let edge = null
try {
  edge = await agent(
    `The change "${change}" just passed happy-path verification on these flows: ` +
    `${map.flows.map(f => f.name).join(', ')}.\n` +
    'Now try to BREAK the changed behavior: edge inputs, empty/huge values, invalid state, concurrent or ' +
    'repeated invocation, the old behavior\'s callers. Actually run each attempt. Report every attempt and any ' +
    'break you found (a break = crash, wrong output, or silent old behavior).',
    { label: 'edge-pass', phase: 'Break', schema: BREAK_SCHEMA },
  )
} catch (e) {
  log('edge pass could not run (budget exhausted) — verdict is happy-path only')
}

// ---- Phase 4: Verdict ----
phase('Verdict')
const passed = driven.filter(d => d.drove && d.matchesExpected)
const failed = driven.filter(d => d.drove && !d.matchesExpected)
const unexercised = [
  ...driven.filter(d => !d.drove).map(d => ({ flow: d.flow, blocker: d.blocker || 'could not drive' })),
  ...map.flows.filter(f => !driven.some(d => d.flow === f.name)).map(f => ({ flow: f.name, blocker: 'drive agent failed' })),
]
const breaks = (edge && edge.breaks) || []
const verified = failed.length === 0 && breaks.length === 0 && passed.length > 0 && unexercised.length === 0
log(`verdict: ${passed.length} passed, ${failed.length} failed, ${breaks.length} breaks, ${unexercised.length} unexercised`)

return {
  verified,
  passed: passed.map(d => ({ flow: d.flow, observed: d.observed, evidence: d.evidence })),
  failed: failed.map(d => ({ flow: d.flow, expected: d.expected, observed: d.observed, evidence: d.evidence })),
  breaks,
  unexercised,
  edgePassRan: !!edge,
  note: verified
    ? 'change verified end-to-end: every mapped flow was driven and behaved as expected, edge pass found no breaks'
    : 'NOT fully verified — see failed/breaks/unexercised; unexercised flows are unknowns, not passes',
}
