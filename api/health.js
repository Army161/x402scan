/** GET /api/health — liveness plus the honest capability list. */
import { CHAIN_IDS } from '../src/index.mjs';
import { send } from './_lib.js';
import { stripeConfigured, priceForTier } from './_stripe.js';

export default function handler(req, res) {
  send(res, 200, {
    ok: true,
    service: 'x402scan',
    version: '0.1.0',
    chains: CHAIN_IDS,
    endpoints: {
      '/api/scan?chain=<id>&units=<n>': 'Measure one chain',
      '/api/compare?units=<n>': 'All chains, ranked by Authenticity Score',
      '/api/health': 'This',
    },
    tiers: {
      free: 'no key · 150 units · 5 min cache',
      pro: 'x-api-key · 1000 units · 1 min cache',
      intel: 'x-api-key · 4000 units · uncached',
    },
    billing: {
      configured: stripeConfigured() && Boolean(priceForTier('pro')),
      tiers: ['free', 'starter', 'pro', 'intel'],
    },
    caveat: 'Scans sample a short recent window. Daily figures are extrapolations — order of magnitude, not accounting.',
  }, { cacheSeconds: 60 });
}
