export const meta = {
  name: 'research-sweep',
  description: 'Multi-modal research: parallel searchers each using a different modality, claim extraction, adversarial fact-check, cited synthesis',
  whenToUse: 'Deep multi-source research questions where one search angle will not find everything. args: {question: string, modalities?: string[]}',
  phases: [
    { title: 'Sweep', detail: 'parallel searchers, one modality each' },
    { title: 'Check', detail: 'adversarial verification of extracted claims' },
    { title: 'Synthesize', detail: 'cited report from verified claims' },
  ],
}

const question = (args && args.question) || null
if (!question) return { error: 'research-sweep requires args.question' }
const modalities = (args && args.modalities) || [
  'broad web search (survey the landscape, find the canonical sources)',
  'primary-source reading (official docs, specs, papers — fetch and read them)',
  'contrarian search (criticism, failure reports, known limitations, rebuttals)',
  'recency search (what changed in the last 12 months; version-specific facts)',
]

const CLAIMS_SCHEMA = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object', required: ['claim', 'source', 'confidence'],
        properties: {
          claim: { type: 'string' },
          source: { type: 'string' },
          confidence: { enum: ['high', 'medium', 'low'] },
          quote: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'reasoning'],
  properties: {
    verdict: { enum: ['SUPPORTED', 'REFUTED', 'UNVERIFIABLE'] },
    reasoning: { type: 'string' },
    counterSource: { type: 'string' },
  },
}

// Custom fable-* worker types resolve only in sessions rooted in a repo that
// has .claude/agents/ installed. Probe once; degrade to general-purpose workers
// (prompts carry the worker rules) instead of burning rounds on a dead fleet.
let workerTypesAvailable = true
try {
  workerTypesAvailable = !!(await agent('Return exactly: ok', { label: 'probe:worker-types', agentType: 'fable-synthesizer' }))
} catch (e) { workerTypesAvailable = false }
if (!workerTypesAvailable) log('fable-* agent types unavailable in this session — using general-purpose workers')
const asWorker = type => (workerTypesAvailable ? { agentType: type } : {})

// ---- Phase 1+2 pipelined: each modality's claims go to fact-check as soon as that sweep finishes ----
const key = c => c.claim.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 120)
const seen = new Set()
const results = await pipeline(
  modalities,
  modality => agent(
    `Research question: ${question}\n` +
    `Your modality: ${modality}. Work ONLY in this modality — sibling agents cover the others.\n` +
    'Extract discrete, checkable claims. Every claim needs its source URL and, where possible, a short ' +
    'supporting quote. Prefer primary sources over aggregators.',
    { label: `sweep:${modality.split(' ')[0]}`, phase: 'Sweep', schema: CLAIMS_SCHEMA },
  ),
  (result, modality) => {
    if (!result) return []
    const fresh = result.claims.filter(c => {
      const k = key(c)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    return parallel(fresh.map(c => () =>
      agent(
        `Fact-check this claim adversarially — actively search for evidence that it is wrong, outdated, ` +
        `or misquoted. If you cannot find counter-evidence AND can confirm the source says this, mark SUPPORTED. ` +
        `If uncertain, mark UNVERIFIABLE, not SUPPORTED.\n` +
        `Claim: ${c.claim}\nStated source: ${c.source}\nQuote: ${c.quote || 'n/a'}`,
        { label: `check:${c.claim.slice(0, 40)}`, phase: 'Check', schema: VERDICT_SCHEMA },
      ).then(
        v => ({ ...c, check: v || { verdict: 'UNVERIFIABLE', reasoning: 'fact-check agent failed' } }),
        () => ({ ...c, check: { verdict: 'UNVERIFIABLE', reasoning: 'fact-check agent failed' } }),
      )))
  },
)

const checked = results.filter(Boolean).flat().filter(Boolean)
const supported = checked.filter(c => c.check.verdict === 'SUPPORTED')
const contested = checked.filter(c => c.check.verdict !== 'SUPPORTED')
log(`claims: ${supported.length} supported, ${contested.length} contested/unverifiable`)

// ---- Phase 3: Synthesize ----
phase('Synthesize')
const report = await agent(
  `Write the final research report answering: ${question}\n` +
  `Verified claims (JSON): ${JSON.stringify(supported)}\n` +
  `Contested or unverifiable claims (mention only in a caveats section): ${JSON.stringify(contested)}\n` +
  'Cite every claim with its source URL inline. Lead with the direct answer, then supporting detail. ' +
  'Include a caveats section for contested claims. Return raw markdown, no preamble.',
  { label: 'synthesize', ...asWorker('fable-synthesizer') },
)

return { report, supported: supported.length, contested: contested.length }
