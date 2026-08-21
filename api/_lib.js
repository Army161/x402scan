/**
 * Shared API plumbing: caching, tiering, CORS, errors.
 *
 * A scan takes 30-90s and hammers public RPCs, so caching is not an
 * optimisation here — it is what keeps us from being rate-limited into
 * uselessness, and what keeps the free tier free.
 */

/** Warm in-process cache. Survives within a lambda instance; the CDN does the rest. */
import { tierForApiKey } from './_stripe.js';

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
 * comma-separated. Paid tiers resolve against live Stripe subscriptions.
 */
export const TIERS = {
  free:    { maxUnits: 150,  cacheSeconds: 300 },
  starter: { maxUnits: 400,  cacheSeconds: 120 },
  pro:     { maxUnits: 1000, cacheSeconds: 60 },
  intel:   { maxUnits: 4000, cacheSeconds: 0 },
};

/**
 * Resolve the caller's tier. Two sources, checked in order:
 *   1. X402SCAN_KEYS env var  — static keys for partners and internal use
 *   2. Stripe subscription    — real paying customers, looked up live
 *
 * Stripe is authoritative for paid access and is checked live, so a cancelled
 * or past_due subscription stops working immediately without a revocation job.
 * Results are memoised briefly to keep the cost to one API call per key.
 */
export async function resolveTier(req) {
  const key = req.headers['x-api-key'] || new URL(req.url, 'http://x').searchParams.get('key');
  if (!key) return { name: 'free', ...TIERS.free };

  const staticTable = Object.fromEntries(
    (process.env.X402SCAN_KEYS || '').split(',').filter(Boolean).map(p => p.split(':'))
  );
  const staticTier = staticTable[key];
  if (staticTier && TIERS[staticTier]) return { name: staticTier, ...TIERS[staticTier], source: 'static' };

  const memoKey = `tier:${key}`;
  const hit = cached(memoKey);
  if (hit) return hit;

  const stripeTier = await tierForApiKey(key);
  if (stripeTier && TIERS[stripeTier]) {
    return remember(memoKey, { name: stripeTier, ...TIERS[stripeTier], source: 'stripe' });
  }

  // Unrecognised or inactive: degrade to free with a warning rather than 401.
  return { name: 'free', ...TIERS.free, keyRejected: true };
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
