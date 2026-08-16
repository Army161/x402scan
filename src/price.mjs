/**
 * Live price lookup. Median of three independent sources, never a hardcoded
 * guess — an early version of this tool assumed XRP = $2.50 when it was $1.008,
 * overstating every XRPL figure by 2.5×. Provenance is always returned so a
 * stored result stays interpretable later.
 */
const SOURCES = {
  XRP: [
    ['coingecko', 'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd', j => j?.ripple?.usd],
    ['coinbase', 'https://api.coinbase.com/v2/prices/XRP-USD/spot', j => Number(j?.data?.amount)],
    ['kraken', 'https://api.kraken.com/0/public/Ticker?pair=XRPUSD', j => Number(j?.result?.XXRPZUSD?.c?.[0])],
  ],
};

export async function priceUsd(symbol, { override } = {}) {
  if (symbol === 'USDC') return { rate: 1, source: 'stablecoin-peg', sourcesOk: 1, spreadPct: 0 };
  if (override) return { rate: Number(override), source: 'override', sourcesOk: 1, spreadPct: 0 };

  const sources = SOURCES[symbol];
  if (!sources) return { rate: null, source: 'unsupported', sourcesOk: 0, spreadPct: null };

  const got = [];
  for (const [name, url, pick] of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const v = pick(await res.json());
      if (Number.isFinite(v) && v > 0) got.push({ name, v });
    } catch { /* next source */ }
  }
  if (!got.length) return { rate: null, source: 'UNAVAILABLE', sourcesOk: 0, spreadPct: null };

  const vals = got.map(g => g.v).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  return {
    rate: median,
    source: got.map(g => `${g.name}:${g.v}`).join(' '),
    sourcesOk: got.length,
    spreadPct: vals.length > 1 ? +(((vals.at(-1) - vals[0]) / median) * 100).toFixed(2) : 0,
  };
}
