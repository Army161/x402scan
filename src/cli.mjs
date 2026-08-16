#!/usr/bin/env node
/** x402scan CLI. */
import { scanChain, scanAll, CHAIN_IDS } from './index.mjs';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = name => argv.includes(`--${name}`);

const C = process.stdout.isTTY && !has('no-color');
const c = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c(1, s), dim = s => c(2, s);
const green = s => c(32, s), yellow = s => c(33, s), red = s => c(31, s), cyan = s => c(36, s);

const BAND_COLOR = {
  'commerce': green,
  'mixed': yellow,
  'mostly-synthetic': red,
  'test-harness': red,
  'insufficient-data': dim,
};

function help() {
  console.log(`
${bold('x402scan')} ${dim('— measure the machine-payment economy from chain data')}

${bold('USAGE')}
  x402scan scan [chain]     Scan one chain, or all if omitted
  x402scan watch            Append one sample to a trend file
  x402scan trend            Show the recorded trend
  x402scan mcp              Run as an MCP server (stdio)
  x402scan chains           List supported chains

${bold('OPTIONS')}
  --units <n>       Ledgers/blocks to sample        ${dim('(default 250)')}
  --json            Machine-readable output
  --out <file>      Write JSON to a file
  --trend <file>    Trend file for watch/trend      ${dim('(default ./trend.jsonl)')}
  --price <n>       Override the native-asset USD rate
  --quiet           Suppress progress
  --no-color        Disable ANSI colour

${bold('EXAMPLES')}
  x402scan scan base
  x402scan scan --units 500 --json
  x402scan watch --trend ~/.x402scan/trend.jsonl
  x402scan mcp
`);
}

function bar(score) {
  if (score == null) return dim('—');
  const filled = Math.round(score / 5);
  return '█'.repeat(filled) + dim('░'.repeat(20 - filled));
}

function render(r) {
  if (r.error) { console.log(`${red('✗')} ${bold(r.chain)} — ${r.error}`); return; }
  const a = r.authenticity;
  const paint = BAND_COLOR[a.band] || (s => s);

  console.log('');
  console.log(`${bold(r.label)} ${dim(`· ${r.fingerprint}`)}`);
  console.log(dim(`  sampled ${r.sampling.scanned}/${r.sampling.requested} ${r.sampling.unit} · ${r.sampling.windowSeconds}s window`));
  console.log('');
  console.log(`  ${bold('Authenticity')}  ${paint(String(a.score ?? '—').padStart(3))}/100  ${bar(a.score)}  ${paint(a.band)}`);
  console.log(`  ${dim(a.note)}`);
  if (a.caveat) console.log(`  ${dim('note: ' + a.caveat)}`);
  console.log('');
  const rows = [
    ['payments', r.payments],
    ['per hour', r.perHour?.toLocaleString() ?? '—'],
    ['unique payers', r.payers],
    ['recipients', r.recipients],
    ['facilitators', r.facilitators],
    ['distinct values', r.values.distinct],
    ['median', fmt(r.values.median, r.nativeAsset)],
    ['max', fmt(r.values.max, r.nativeAsset)],
    ['top-3 recipients', r.concentration.top3RecipientShare != null ? r.concentration.top3RecipientShare + '%' : '—'],
    ['settled/day', r.usd.perDay != null ? '$' + r.usd.perDay.toLocaleString() : dim('unavailable')],
  ];
  for (const [k, v] of rows) console.log(`  ${dim(k.padEnd(18))} ${v}`);
  if (r.price?.rate != null && r.nativeAsset !== 'USDC') {
    console.log(`  ${dim('price'.padEnd(18))} ${dim(`1 ${r.nativeAsset} = $${r.price.rate} (${r.price.sourcesOk}/3 sources)`)}`);
  }
  if (Object.keys(a.signals).length) {
    console.log('');
    console.log(`  ${dim('signals')}`);
    for (const [name, s] of Object.entries(a.signals)) {
      console.log(`  ${dim('·')} ${name.padEnd(16)} ${String(s.score).padStart(3)}  ${dim(s.evidence)}`);
    }
  }
}

const fmt = (v, asset) => (v == null ? '—' : asset === 'USDC' ? `$${v}` : `${v} ${asset}`);

function progress(quiet, label) {
  if (quiet || !process.stderr.isTTY) return undefined;
  return (done, total, found) =>
    process.stderr.write(`\r  ${label}: ${done}/${total} · ${found} payments   `);
}

async function main() {
  if (!cmd || cmd === 'help' || has('help')) return help();

  if (cmd === 'chains') {
    for (const id of CHAIN_IDS) console.log(id);
    return;
  }

  const units = Number(flag('units', 250));
  const quiet = has('quiet') || has('json');
  const priceOverride = flag('price', undefined);

  if (cmd === 'scan') {
    const target = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
    const opts = { units, priceOverride };
    let out;
    if (target) {
      out = await scanChain(target, { ...opts, onProgress: progress(quiet, target) });
    } else {
      out = await scanAll(CHAIN_IDS, opts);
    }
    if (!quiet) process.stderr.write('\r' + ' '.repeat(60) + '\r');

    if (has('json')) console.log(JSON.stringify(out, null, 2));
    else (out.chains || [out]).forEach(render);

    const file = flag('out', null);
    if (typeof file === 'string') {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(out) + '\n');
      console.error(dim(`\n  → ${file}`));
    }
    if (!has('json')) console.log('');
    return;
  }

  if (cmd === 'watch') {
    const file = String(flag('trend', './trend.jsonl'));
    const out = await scanAll(CHAIN_IDS, { units, priceOverride });
    mkdirSync(dirname(file) || '.', { recursive: true });
    appendFileSync(file, JSON.stringify(compact(out)) + '\n');
    if (!has('json')) {
      out.chains.forEach(render);
      console.error(dim(`\n  → ${file}`));
    } else console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'trend') {
    const file = String(flag('trend', './trend.jsonl'));
    if (!existsSync(file)) { console.error(`No trend file at ${file}. Run: x402scan watch`); process.exit(1); }
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    console.log('');
    console.log(bold('  date        chain   score  payments  payers  $/day'));
    for (const row of rows) {
      for (const ch of row.chains) {
        if (ch.error) { console.log(`  ${row.observedAt.slice(0, 10)}  ${ch.chain.padEnd(6)}  ${red('scan failed')}`); continue; }
        const paint = BAND_COLOR[ch.band] || (s => s);
        console.log(
          `  ${row.observedAt.slice(0, 10)}  ${ch.chain.padEnd(6)}  ` +
          `${paint(String(ch.score ?? '—').padStart(4))}  ` +
          `${String(ch.payments).padStart(8)}  ${String(ch.payers).padStart(6)}  ` +
          `${ch.usdPerDay != null ? '$' + ch.usdPerDay.toLocaleString() : '—'}`
        );
      }
    }
    console.log('');
    return;
  }

  if (cmd === 'mcp') {
    await import('./mcp.mjs');
    return;
  }

  console.error(`Unknown command "${cmd}". Try: x402scan help`);
  process.exit(1);
}

/** Trend rows stay small — full scans go to --out. */
function compact(out) {
  return {
    observedAt: out.observedAt,
    chains: out.chains.map(c => c.error ? { chain: c.chain, error: c.error } : {
      chain: c.chain,
      score: c.authenticity.score,
      band: c.authenticity.band,
      payments: c.payments,
      payers: c.payers,
      recipients: c.recipients,
      distinctValues: c.values.distinct,
      median: c.values.median,
      max: c.values.max,
      top3: c.concentration.top3RecipientShare,
      usdPerDay: c.usd.perDay,
      priceRate: c.price?.rate ?? null,
      priceSource: c.price?.source ?? null,
    }),
  };
}

main().catch(e => { console.error(red('✗ ') + (e.stack || e.message)); process.exit(1); });
