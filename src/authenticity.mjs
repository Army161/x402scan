/**
 * Authenticity Score — the metric this tool exists for.
 *
 * Everyone counts x402 transactions. On chains where a transaction costs
 * $0.0002, counts measure enthusiasm, not commerce: a single test loop
 * manufactures a million payments for the price of a coffee.
 *
 * This scores whether observed settlement *behaves* like real economic
 * activity, from four signals that a test harness cannot fake cheaply.
 *
 * Calibrated against first-party scans, 13 Aug 2026:
 *   XRPL  →  8/100  (9 payers, 3 distinct values, 0% failures)
 *   Base  → 71/100  (90 payers, 340 distinct values, real long tail)
 */

/** Each signal returns 0..1. Weights sum to 1. */
const SIGNALS = {
  /**
   * Value diversity — the strongest signal by a distance.
   * Metered billing produces amounts like 0.020325; a loop produces 0.001.
   * Ratio of distinct amounts to payments.
   */
  valueDiversity: {
    weight: 0.40,
    score: s => clamp01(ratio(s.distinctValues, s.payments) / 0.30),
    explain: s => `${s.distinctValues} distinct values across ${s.payments} payments ` +
      `(${pct(ratio(s.distinctValues, s.payments))})`,
  },

  /**
   * Payer diversity — real demand comes from many wallets, unevenly.
   * Log-scaled: 1 payer ≈ 0, ~60+ payers ≈ 1.
   */
  payerDiversity: {
    weight: 0.25,
    score: s => clamp01(Math.log10(Math.max(1, s.payers)) / Math.log10(60)),
    explain: s => `${s.payers} unique payers`,
  },

  /**
   * Failure presence — real commerce fails sometimes: insufficient balance,
   * missing trust line, expired invoice. A flawless 100% success rate across
   * hundreds of payments is a controlled environment, not a market.
   * Peak credit around 1–5% failures; penalise both 0% and heavy failure.
   */
  failurePresence: {
    weight: 0.15,
    score: s => {
      const f = clamp01(s.failureRate);
      if (f === 0) return 0.1;                 // suspiciously perfect
      if (f <= 0.05) return 1;                 // healthy
      if (f <= 0.20) return 1 - (f - 0.05) / 0.15 * 0.5;
      return 0.25;                             // something is broken
    },
    explain: s => `${pct(s.failureRate)} failure rate`,
  },

  /**
   * Value dispersion — a real distribution has a tail. If max ≈ p95,
   * every payment is the same size and nobody is buying anything unusual.
   */
  tailPresence: {
    weight: 0.20,
    score: s => {
      const { median, max } = s;
      if (!median || !max || max <= median) return 0;
      return clamp01(Math.log10(max / median) / 3);   // 1000× spread ≈ full marks
    },
    explain: s => s.median && s.max
      ? `max is ${(s.max / s.median).toFixed(0)}× the median`
      : 'insufficient value data',
  },
};

/** A signal is measurable only when its inputs are actually present. */
function isMeasurable(name, s) {
  switch (name) {
    // Base reads payments from block calldata, which cannot reveal reverts.
    case 'failurePresence': return Number.isFinite(s.failureRate);
    case 'tailPresence': return Number.isFinite(s.median) && Number.isFinite(s.max);
    case 'valueDiversity': return Number.isFinite(s.distinctValues);
    case 'payerDiversity': return Number.isFinite(s.payers);
    default: return true;
  }
}

const clamp01 = n => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const ratio = (a, b) => (b > 0 ? a / b : 0);
const pct = n => `${(n * 100).toFixed(1)}%`;

/**
 * @param {object} s
 * @param {number} s.payments      total payments observed
 * @param {number} s.distinctValues distinct payment amounts
 * @param {number} s.payers        unique payer addresses
 * @param {number} s.failureRate   0..1
 * @param {number} s.median        median payment value
 * @param {number} s.max           largest payment value
 */
export function authenticityScore(s) {
  // Below this, the sample is too thin for the signals to mean anything.
  if (!s.payments || s.payments < 20) {
    return {
      score: null,
      band: 'insufficient-data',
      note: `Only ${s.payments || 0} payments observed; need 20+ for a meaningful score.`,
      signals: {},
    };
  }

  // A signal we cannot measure must not be scored as zero — that would punish a
  // chain for our own instrumentation gap. Drop it and renormalise the weights
  // across what we can actually observe.
  const measurable = Object.entries(SIGNALS).filter(([name]) => isMeasurable(name, s));
  const weightSum = measurable.reduce((a, [, sig]) => a + sig.weight, 0);
  if (!weightSum) {
    return { score: null, band: 'insufficient-data', note: 'No signals measurable.', signals: {} };
  }

  const signals = {};
  const omitted = [];
  let total = 0;
  for (const [name, sig] of Object.entries(SIGNALS)) {
    if (!isMeasurable(name, s)) { omitted.push(name); continue; }
    const raw = clamp01(sig.score(s));
    const weight = sig.weight / weightSum;          // renormalised
    signals[name] = {
      score: +(raw * 100).toFixed(0),
      weight: +weight.toFixed(3),
      contribution: +(raw * weight * 100).toFixed(1),
      evidence: sig.explain(s),
    };
    total += raw * weight;
  }

  const score = Math.round(total * 100);
  return {
    score,
    band: band(score),
    note: verdict(score),
    signals,
    ...(omitted.length ? {
      omittedSignals: omitted,
      caveat: `${omitted.join(', ')} not measurable on this chain; remaining weights renormalised.`,
    } : {}),
  };
}

function band(score) {
  if (score >= 70) return 'commerce';
  if (score >= 45) return 'mixed';
  if (score >= 25) return 'mostly-synthetic';
  return 'test-harness';
}

function verdict(score) {
  if (score >= 70) return 'Behaves like real metered commerce.';
  if (score >= 45) return 'Mixed — genuine usage alongside significant automated traffic.';
  if (score >= 25) return 'Mostly synthetic. Treat headline transaction counts with caution.';
  return 'Test harness. Transaction counts here do not represent commerce.';
}

export const BANDS = ['test-harness', 'mostly-synthetic', 'mixed', 'commerce'];
