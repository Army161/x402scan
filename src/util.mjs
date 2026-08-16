/** Shared helpers. Zero dependencies by design — see README "Why no dependencies". */

/** POST JSON with timeout, rotating through endpoints on failure. */
export async function rpc(urls, body, { timeout = 25000, attempts = 4 } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  for (let i = 0; i < attempts; i++) {
    const url = list[i % list.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      // Public RPCs sometimes return plain-text rate-limit notices, not JSON.
      try { return JSON.parse(text); }
      catch { throw new Error(`non-JSON response: ${text.slice(0, 80)}`); }
    } catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(300 * (i + 1));
    }
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run tasks with bounded concurrency, preserving input order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try { out[i] = await fn(items[i], i); }
        catch { out[i] = null; }
      }
    })
  );
  return out;
}

/** Percentile from a pre-sorted numeric array. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summarise(values) {
  const s = [...values].sort((a, b) => a - b);
  const total = s.reduce((a, b) => a + b, 0);
  return {
    count: s.length,
    total: round(total),
    min: s[0] ?? null,
    p25: percentile(s, 0.25),
    median: percentile(s, 0.5),
    p75: percentile(s, 0.75),
    p95: percentile(s, 0.95),
    max: s[s.length - 1] ?? null,
    mean: s.length ? round(total / s.length) : null,
    distinct: new Set(s).size,
  };
}

export const round = (n, dp = 6) => (Number.isFinite(n) ? +n.toFixed(dp) : n);

export function tally(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
}

export function topN(map, n, total) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count, share: total ? +(count / total * 100).toFixed(1) : null }));
}

export function shareOfTop(map, n, total) {
  if (!total) return null;
  const sum = [...map.values()].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
  return +(sum / total * 100).toFixed(1);
}

/** Extrapolate a sampled window to a 24h figure. Order of magnitude only. */
export const perDay = (total, windowSec) =>
  windowSec > 0 ? round(total * (86400 / windowSec), 2) : null;
