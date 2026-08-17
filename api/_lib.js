/**
 * Shared API plumbing: caching, tiering, CORS, errors.
 *
 * A scan takes 30-90s and hammers public RPCs, so caching is not an
 * optimisation here — it is what keeps us from being rate-limited into
 * uselessness, and what keeps the free tier free.
 */

/** Warm in-process cache. Survives within a lambda instance; the CDN does the rest. */
const memo = new Map();
const MEMO_TTL_MS = 4 * 60 * 1000;

export function cached(key) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;
  memo.delete(key);
  return null;
}

export function remember(key, value) {
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 50) memo.delete(memo.keys().next().value);
  return value;
}

/**
 * Tiers. Keys live in the X402SCAN_KEYS env var as `key:tier` pairs,
 * comma-separated. Real billing is Stage 7 — this is the seam it plugs into.
 */
const TIERS = {
  free: { maxUnits: 150, chains: ['xrpl', 'base'], cacheSeconds: 300 },
  pro: { maxUnits: 1000, chains: ['xrpl', 'base'], cacheSeconds: 60 },
  intel: { maxUnits: 4000, chains: ['xrpl', 'base'], cacheSeconds: 0 },
};

export function resolveTier(req) {
  const key = req.headers['x-api-key'] || new URL(req.url, 'http://x').searchParams.get('key');
  if (!key) return { name: 'free', ...TIERS.free };
  const table = Object.fromEntries(
    (process.env.X402SCAN_KEYS || '').split(',').filter(Boolean).map(p => p.split(':'))
  );
  const tier = table[key];
  if (!tier || !TIERS[tier]) return { name: 'free', ...TIERS.free, keyRejected: true };
  return { name: tier, ...TIERS[tier] };
}

export function send(res, status, body, { cacheSeconds = 0 } = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader(
    'Cache-Control',
    cacheSeconds > 0
      ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
      : 'no-store'
  );
  res.status(status).end(JSON.stringify(body, null, 2));
}

export function fail(res, status, message, hint) {
  send(res, status, { error: message, ...(hint ? { hint } : {}) });
}

/** Clamp units to the tier ceiling and tell the caller when we did. */
export function clampUnits(requested, tier) {
  const asked = Number(requested) || 150;
  const units = Math.max(20, Math.min(asked, tier.maxUnits));
  return { units, clamped: units !== asked ? { asked, allowed: units, tier: tier.name } : null };
}
