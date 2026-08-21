/** GET /api/scan?chain=base&units=150 — measure one chain. */
import { scanChain, CHAIN_IDS } from '../src/index.mjs';
import { cached, remember, resolveTier, clampUnits, send, fail } from './_lib.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const url = new URL(req.url, 'http://x');
  const chain = url.searchParams.get('chain');

  if (!chain) {
    return fail(res, 400, 'Missing "chain" parameter', `Supported: ${CHAIN_IDS.join(', ')}`);
  }
  if (!CHAIN_IDS.includes(chain)) {
    return fail(res, 400, `Unknown chain "${chain}"`, `Supported: ${CHAIN_IDS.join(', ')}`);
  }

  const tier = await resolveTier(req);
  const { units, clamped } = clampUnits(url.searchParams.get('units'), tier);
  const key = `scan:${chain}:${units}`;

  const hit = cached(key);
  if (hit) return send(res, 200, { ...hit, cache: 'hit' }, { cacheSeconds: tier.cacheSeconds });

  try {
    const result = await scanChain(chain, { units });
    const body = {
      ...result,
      tier: tier.name,
      ...(clamped ? { clamped } : {}),
      ...(tier.keyRejected ? { warning: 'API key not recognised; served on the free tier.' } : {}),
      cache: 'miss',
    };
    remember(key, body);
    return send(res, 200, body, { cacheSeconds: tier.cacheSeconds });
  } catch (e) {
    // Public RPCs rate-limit and time out. Say so plainly rather than 500-ing blind.
    return fail(res, 502, `Scan failed: ${e.message}`,
      'Public RPC endpoints throttle under load. Try again shortly, or lower --units.');
  }
}
