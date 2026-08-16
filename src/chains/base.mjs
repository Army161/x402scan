/**
 * Base adapter.
 *
 * Base has no SourceTag equivalent. x402's EVM "exact" scheme settles USDC via
 * EIP-3009 `transferWithAuthorization`, submitted by a facilitator on the
 * payer's behalf. We do NOT hardcode the selector: we decode every USDC call
 * whose calldata matches the EIP-3009 shape and carries a plausible
 * validAfter/validBefore window. 0xe3ee160e falls out empirically.
 *
 * EIP-3009 preserves the true payer inside the signed authorization, so
 * `payer` here is the real spender even though a facilitator submitted the tx.
 */
import { rpc, pool, summarise, tally, topN, shareOfTop, perDay, round } from '../util.mjs';

export const ID = 'base';
export const LABEL = 'Base';
export const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';   // 6 decimals
export const ENDPOINTS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];

const call = (endpoints, method, params) =>
  rpc(endpoints, { jsonrpc: '2.0', id: 1, method, params });

const word = (input, i) => input.slice(10 + i * 64, 10 + (i + 1) * 64);
const toBig = h => BigInt('0x' + h);
const toAddr = w => '0x' + w.slice(24);

export async function scan({ units = 250, concurrency = 4, endpoints = ENDPOINTS, onProgress } = {}) {
  const headHex = (await call(endpoints, 'eth_blockNumber', []))?.result;
  const head = Number(headHex);
  if (!Number.isFinite(head)) throw new Error('Base: could not read head block');

  const numbers = Array.from({ length: units }, (_, i) => head - i);
  let scanned = 0, missing = 0, totalTx = 0, usdcCalls = 0;
  let first = null, last = null;
  const payments = [];
  const selectors = new Map();

  const blocks = await pool(numbers, concurrency, async (n, i) => {
    const r = await call(endpoints, 'eth_getBlockByNumber', ['0x' + n.toString(16), true]);
    onProgress?.(i + 1, units, payments.length);
    return r?.result ?? null;
  });

  for (const b of blocks) {
    if (!b?.transactions) { missing++; continue; }
    scanned++;
    const ts = Number(b.timestamp);
    if (first === null || ts < first) first = ts;
    if (last === null || ts > last) last = ts;
    totalTx += b.transactions.length;

    for (const t of b.transactions) {
      if ((t.to || '').toLowerCase() !== USDC) continue;
      usdcCalls++;
      const input = t.input || '';
      const sel = input.slice(0, 10);
      selectors.set(sel, (selectors.get(sel) || 0) + 1);

      // EIP-3009: (from, to, value, validAfter, validBefore, nonce, v, r, s) = 9 words
      if ((input.length - 10) / 64 < 9) continue;
      const validAfter = toBig(word(input, 3));
      const validBefore = toBig(word(input, 4));
      const now = BigInt(ts);
      const plausible = validBefore > now - 86400n
        && validBefore < now + 2592000n
        && validAfter < now + 86400n;
      if (!plausible) continue;

      payments.push({
        payer: toAddr(word(input, 0)),
        recipient: toAddr(word(input, 1)),
        facilitator: (t.from || '').toLowerCase(),
        asset: 'USDC',
        value: Number(toBig(word(input, 2))) / 1e6,
        success: true,          // see note in normalise()
        selector: sel,
        block: Number(b.number),
      });
    }
  }

  return normalise({
    payments, scanned, missing, totalTx, usdcCalls, selectors,
    unitsRequested: units,
    windowSeconds: first !== null && last !== null ? last - first : 0,
  });
}

function normalise({ payments, scanned, missing, totalTx, usdcCalls, selectors, unitsRequested, windowSeconds }) {
  const values = payments.map(p => p.value).filter(v => Number.isFinite(v));
  const stats = summarise(values);
  const recipients = tally(payments, 'recipient');
  const payers = tally(payments, 'payer');

  return {
    chain: ID,
    label: LABEL,
    network: 'mainnet',
    fingerprint: 'EIP-3009 transferWithAuthorization on USDC',
    nativeAsset: 'USDC',
    sampling: {
      unit: 'blocks',
      requested: unitsRequested,
      scanned,
      missing,
      windowSeconds,
      totalTransactionsSeen: totalTx,
      usdcContractCalls: usdcCalls,
      selectorsSeen: [...selectors.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([selector, count]) => ({ selector, count })),
      shareOfChainActivity: totalTx ? +(payments.length / totalTx * 100).toFixed(2) : null,
    },
    payments: payments.length,
    perHour: windowSeconds ? Math.round(payments.length / windowSeconds * 3600) : null,
    payers: payers.size,
    recipients: recipients.size,
    facilitators: new Set(payments.map(p => p.facilitator)).size,
    // Honest limitation: block calldata does not reveal reverts. We report null
    // rather than 0 so the Authenticity Score does not read a fabricated
    // "perfect success rate" as a synthetic-traffic signal. Receipt sampling
    // is a Stage 2 item.
    failureRate: null,
    assets: Object.fromEntries(tally(payments, 'asset')),
    values: stats,
    nativePerDay: perDay(stats.total, windowSeconds),
    usdPerDay: perDay(stats.total, windowSeconds),   // USDC ≈ USD
    concentration: {
      top1RecipientShare: shareOfTop(recipients, 1, payments.length),
      top3RecipientShare: shareOfTop(recipients, 3, payments.length),
      topRecipients: topN(recipients, 10, payments.length),
      topPayers: topN(payers, 10, payments.length),
    },
  };
}
