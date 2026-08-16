/**
 * XRPL adapter.
 *
 * Fingerprint: t54's x402 facilitator stamps SourceTag 804681468 on every
 * settlement it submits. XRPL exposes no query-by-SourceTag API, so we walk
 * validated ledgers and filter. Deterministic finality means no reorg handling.
 */
import { rpc, pool, summarise, tally, topN, shareOfTop, perDay, round } from '../util.mjs';

export const ID = 'xrpl';
export const LABEL = 'XRP Ledger';
export const SOURCE_TAG = 804681468;
export const ENDPOINTS = ['https://xrplcluster.com/', 'https://s2.ripple.com:51234/'];
const LEDGER_SECONDS = 3.5;

const call = (endpoints, method, params) => rpc(endpoints, { method, params: [params] });

/** XRP amounts are drops (string); IOUs are {currency, issuer, value}. */
function parseAmount(a) {
  if (a == null) return null;
  if (typeof a === 'string') return { asset: 'XRP', value: Number(a) / 1e6 };
  return { asset: decodeCurrency(a.currency), value: Number(a.value) };
}

/** Currency codes are 3 chars, or 40-char hex for longer names like RLUSD. */
function decodeCurrency(c) {
  if (!c || c.length <= 3) return c;
  try { return Buffer.from(c, 'hex').toString('utf8').replace(/\0+$/, '') || c; }
  catch { return c; }
}

export async function scan({ units = 250, concurrency = 6, endpoints = ENDPOINTS, onProgress } = {}) {
  const head = await call(endpoints, 'ledger', { ledger_index: 'validated', transactions: false });
  const headIndex = Number(head?.result?.ledger?.ledger_index);
  if (!Number.isFinite(headIndex)) throw new Error('XRPL: could not read validated ledger head');

  const indices = Array.from({ length: units }, (_, i) => headIndex - i);
  let scanned = 0, missing = 0, totalTx = 0;
  const payments = [];

  const results = await pool(indices, concurrency, async (index, i) => {
    const r = await call(endpoints, 'ledger', { ledger_index: index, transactions: true, expand: true });
    onProgress?.(i + 1, units, payments.length);
    return r?.result?.ledger ?? null;
  });

  for (const ledger of results) {
    if (!ledger) { missing++; continue; }
    scanned++;
    const txs = ledger.transactions || [];
    totalTx += txs.length;
    for (const entry of txs) {
      const tx = entry.tx_json || entry;            // rippled 3.x nests under tx_json
      const meta = entry.meta || entry.metaData || {};
      if (tx.TransactionType !== 'Payment' || tx.SourceTag !== SOURCE_TAG) continue;
      const amt = parseAmount(meta.delivered_amount ?? tx.DeliverMax ?? tx.Amount);
      payments.push({
        payer: tx.Account,
        recipient: tx.Destination,
        facilitator: tx.Account,                    // XRPL: submitter is the payer
        asset: amt?.asset ?? null,
        value: amt?.value ?? null,
        success: meta.TransactionResult === 'tesSUCCESS',
        ledger: Number(ledger.ledger_index),
      });
    }
  }

  return normalise({ payments, scanned, missing, totalTx, unitsRequested: units });
}

function normalise({ payments, scanned, missing, totalTx, unitsRequested }) {
  const values = payments.map(p => p.value).filter(v => Number.isFinite(v));
  const stats = summarise(values);
  const recipients = tally(payments, 'recipient');
  const payers = tally(payments, 'payer');
  const windowSeconds = Math.round(scanned * LEDGER_SECONDS);
  const failures = payments.filter(p => !p.success).length;

  return {
    chain: ID,
    label: LABEL,
    network: 'mainnet',
    fingerprint: `SourceTag ${SOURCE_TAG}`,
    nativeAsset: 'XRP',
    sampling: {
      unit: 'ledgers',
      requested: unitsRequested,
      scanned,
      missing,
      windowSeconds,
      totalTransactionsSeen: totalTx,
      shareOfChainActivity: totalTx ? +(payments.length / totalTx * 100).toFixed(2) : null,
    },
    payments: payments.length,
    perHour: windowSeconds ? Math.round(payments.length / windowSeconds * 3600) : null,
    payers: payers.size,
    recipients: recipients.size,
    facilitators: new Set(payments.map(p => p.facilitator)).size,
    failureRate: payments.length ? round(failures / payments.length, 4) : 0,
    assets: Object.fromEntries(tally(payments, 'asset')),
    values: stats,
    nativePerDay: perDay(stats.total, windowSeconds),
    concentration: {
      top1RecipientShare: shareOfTop(recipients, 1, payments.length),
      top3RecipientShare: shareOfTop(recipients, 3, payments.length),
      topRecipients: topN(recipients, 10, payments.length),
      topPayers: topN(payers, 10, payments.length),
    },
  };
}
