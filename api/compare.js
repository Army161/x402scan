/** GET /api/compare?units=150 — every chain, side by side, ranked. */
import { scanAll, CHAIN_IDS } from '../src/index.mjs';
import { cached, remember, resolveTier, clampUnits, send, fail } from './_lib.js';

export const config = { maxDuration: 180 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const url = new URL(req.url, 'http://x');
  const tier = await resolveTier(req);
  const { units, clamped } = clampUnits(url.searchParams.get('units'), tier);
  const key = `compare:${units}`;

  const hit = cached(key);
  if (hit) return send(res, 200, { ...hit, cache: 'hit' }, { cacheSeconds: tier.cacheSeconds });

  try {
    const out = await scanAll(CHAIN_IDS, { units });
    const ranked = [...out.chains].sort(
      (a, b) => (b.authenticity?.score ?? -1) - (a.authenticity?.score ?? -1)
    );
    const body = {
      observedAt: out.observedAt,
      leader: ranked.find(c => !c.error)?.chain ?? null,
      chains: ranked,
      tier: tier.name,
      ...(clamped ? { clamped } : {}),
      cache: 'miss',
    };
    remember(key, body);
    return send(res, 200, body, { cacheSeconds: tier.cacheSeconds });
  } catch (e) {
    return fail(res, 502, `Compare failed: ${e.message}`);
  }
}
