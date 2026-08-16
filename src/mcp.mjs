#!/usr/bin/env node
/**
 * x402scan MCP server (stdio).
 *
 * Implements MCP's JSON-RPC directly rather than pulling in the SDK — the whole
 * package stays zero-dependency, so `npx x402scan mcp` works with no install
 * step and no lockfile drift. The surface we need (initialize, tools/list,
 * tools/call) is small and stable.
 *
 * Wire it up in Claude Code:
 *   claude mcp add --scope user x402scan -- npx -y x402scan mcp
 */
import { scanChain, scanAll, CHAIN_IDS } from './index.mjs';
import { readFileSync, existsSync } from 'node:fs';

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'scan_chain',
    description:
      'Measure live x402 agentic payment activity on one chain and return an Authenticity Score ' +
      '(0-100) indicating whether the settlement looks like real metered commerce or a test harness. ' +
      'Use when asked how much real agentic/AI-agent payment volume a chain has, or whether ' +
      'published x402 transaction counts reflect genuine commerce. Takes ~30-90s.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: CHAIN_IDS, description: 'Chain to scan.' },
        units: { type: 'number', description: 'Ledgers/blocks to sample. Default 150; higher is slower but more reliable.' },
      },
      required: ['chain'],
    },
  },
  {
    name: 'compare_chains',
    description:
      'Scan every supported chain and compare agentic payment activity side by side, including ' +
      'Authenticity Scores. Use for "which chain has the most real AI agent payment volume" ' +
      'or to sanity-check ecosystem claims. Slower than scan_chain.',
    inputSchema: {
      type: 'object',
      properties: {
        units: { type: 'number', description: 'Ledgers/blocks per chain. Default 150.' },
      },
    },
  },
  {
    name: 'explain_authenticity_score',
    description:
      'Explain how the Authenticity Score is computed, what each signal means, and how to read ' +
      'the bands. Use when someone asks what the score means or why a chain scored as it did.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_trend',
    description:
      'Read a recorded x402scan trend file (written by `x402scan watch`) and return the history. ' +
      'Use for questions about whether agentic payment volume is growing over time.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to trend.jsonl.' } },
      required: ['path'],
    },
  },
];

const EXPLAINER = `# Authenticity Score

x402 transactions cost ~$0.0002, so transaction COUNT measures enthusiasm, not
commerce — one test loop manufactures a million payments for the price of a coffee.
The Authenticity Score instead asks whether settlement *behaves* like real economic
activity.

## Signals

| Signal | Weight | Reasoning |
|---|---|---|
| Value diversity | 40% | Metered billing produces computed amounts (0.020325). Loops produce round ones (0.001). Strongest signal. |
| Payer diversity | 25% | Real demand comes from many wallets, unevenly distributed. |
| Failure presence | 15% | Real commerce fails 1-5% of the time. A flawless 100% success rate is a controlled environment. |
| Tail presence | 20% | Real distributions have outliers. If max ≈ p95, nobody is buying anything unusual. |

Signals that cannot be measured on a given chain are omitted and the remaining
weights renormalised — a chain is never penalised for our instrumentation gap.
(Base payments are read from block calldata, which cannot reveal reverts, so
failure presence is omitted there.)

## Bands

| Score | Band | Meaning |
|---|---|---|
| 70-100 | commerce | Behaves like real metered commerce |
| 45-69 | mixed | Genuine usage alongside significant automated traffic |
| 25-44 | mostly-synthetic | Treat headline counts with caution |
| 0-24 | test-harness | Counts do not represent commerce |

Below 20 payments observed, no score is returned.

## Reference measurements (13 Aug 2026)
- XRPL ≈ 8/100 — 9 payers, 3 distinct values, 0% failures, no tail
- Base ≈ 71/100 — 90 payers, 340 distinct values, max 8000× median`;

// ---- JSON-RPC plumbing ----

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const text = s => ({ content: [{ type: 'text', text: s }] });

async function callTool(name, args = {}) {
  switch (name) {
    case 'scan_chain': {
      if (!CHAIN_IDS.includes(args.chain)) {
        return text(`Unknown chain "${args.chain}". Supported: ${CHAIN_IDS.join(', ')}`);
      }
      const r = await scanChain(args.chain, { units: Number(args.units) || 150 });
      return text(JSON.stringify(summarise(r), null, 2));
    }
    case 'compare_chains': {
      const r = await scanAll(CHAIN_IDS, { units: Number(args.units) || 150 });
      return text(JSON.stringify({
        observedAt: r.observedAt,
        chains: r.chains.map(c => (c.error ? c : summarise(c))),
      }, null, 2));
    }
    case 'explain_authenticity_score':
      return text(EXPLAINER);
    case 'read_trend': {
      if (!args.path || !existsSync(args.path)) return text(`No trend file at ${args.path}`);
      const rows = readFileSync(args.path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      return text(JSON.stringify({ samples: rows.length, rows }, null, 2));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Trim a full scan to what a model needs — full payload is available via CLI. */
function summarise(r) {
  return {
    chain: r.chain,
    label: r.label,
    observedAt: r.observedAt,
    fingerprint: r.fingerprint,
    authenticity: r.authenticity,
    payments: r.payments,
    perHour: r.perHour,
    payers: r.payers,
    recipients: r.recipients,
    facilitators: r.facilitators,
    distinctValues: r.values.distinct,
    median: r.values.median,
    max: r.values.max,
    settledUsdPerDay: r.usd.perDay,
    top3RecipientShare: r.concentration.top3RecipientShare,
    sampling: r.sampling,
    caveat: 'Extrapolated from a short sampled window. Order of magnitude, not accounting.',
  };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch { return fail(null, -32700, 'Parse error'); }

  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'x402scan', version: '0.1.0' },
        });
      case 'notifications/initialized':
        return;                                   // notification: no reply
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call':
        return reply(id, await callTool(params?.name, params?.arguments));
      case 'ping':
        return reply(id, {});
      default:
        if (id != null) fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (id != null) reply(id, { ...text(`Error: ${e.message}`), isError: true });
  }
}

process.stdin.on('end', () => process.exit(0));
