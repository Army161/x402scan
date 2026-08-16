/** Public API. Import this, or use the CLI / MCP server which both wrap it. */
import * as xrpl from './chains/xrpl.mjs';
import * as base from './chains/base.mjs';
import { authenticityScore } from './authenticity.mjs';
import { priceUsd } from './price.mjs';
import { perDay } from './util.mjs';

export const CHAINS = { xrpl, base };
export const CHAIN_IDS = Object.keys(CHAINS);
export { authenticityScore, priceUsd };

/**
 * Scan one chain and attach USD conversion + Authenticity Score.
 * @param {'xrpl'|'base'} chainId
 */
export async function scanChain(chainId, opts = {}) {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unknown chain "${chainId}". Known: ${CHAIN_IDS.join(', ')}`);

  const result = await chain.scan(opts);
  const price = await priceUsd(result.nativeAsset, { override: opts.priceOverride });

  result.price = price;
  result.usd = {
    totalInWindow: price.rate != null ? +(result.values.total * price.rate).toFixed(4) : null,
    perDay: price.rate != null
      ? perDay(result.values.total * price.rate, result.sampling.windowSeconds)
      : null,
  };

  result.authenticity = authenticityScore({
    payments: result.payments,
    distinctValues: result.values.distinct,
    payers: result.payers,
    failureRate: result.failureRate,
    median: result.values.median,
    max: result.values.max,
  });

  result.observedAt = new Date().toISOString();
  return result;
}

/** Scan several chains concurrently. Failures are captured, not thrown. */
export async function scanAll(chainIds = CHAIN_IDS, opts = {}) {
  const results = await Promise.all(
    chainIds.map(id =>
      scanChain(id, opts).catch(e => ({ chain: id, error: String(e.message || e) }))
    )
  );
  return { observedAt: new Date().toISOString(), chains: results };
}
