/** Regression tests for the Authenticity Score, pinned to real measurements. */
import { authenticityScore } from '../src/authenticity.mjs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); fail++; }
};

// Measured on XRPL mainnet, 13 Aug 2026.
const XRPL = { payments: 156, distinctValues: 3, payers: 9, failureRate: 0, median: 0.001, max: 0.003 };
// Measured on Base mainnet, same day. failureRate null — calldata cannot reveal reverts.
const BASE = { payments: 842, distinctValues: 340, payers: 90, failureRate: null, median: 0.005, max: 24.368212 };

console.log('\nauthenticity score');

t('XRPL scores as a test harness', () => {
  const r = authenticityScore(XRPL);
  assert.ok(r.score < 25, `expected <25, got ${r.score}`);
  assert.equal(r.band, 'test-harness');
});

t('Base scores as commerce', () => {
  const r = authenticityScore(BASE);
  assert.ok(r.score >= 60, `expected >=60, got ${r.score}`);
  assert.ok(['commerce', 'mixed'].includes(r.band), `got band ${r.band}`);
});

t('Base outscores XRPL by a wide margin', () => {
  assert.ok(authenticityScore(BASE).score - authenticityScore(XRPL).score > 40);
});

t('unmeasurable failure rate is omitted, not scored zero', () => {
  const r = authenticityScore(BASE);
  assert.ok(r.omittedSignals?.includes('failurePresence'));
  assert.equal(r.signals.failurePresence, undefined);
  const sum = Object.values(r.signals).reduce((a, s) => a + s.weight, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `weights should renormalise to 1, got ${sum}`);
});

t('omitting a signal does not penalise the chain', () => {
  const withRate = authenticityScore({ ...BASE, failureRate: 0.02 });
  const without = authenticityScore(BASE);
  // A healthy failure rate scores full marks, so including it should only help
  // slightly — never should omission drag the score down below the measured one.
  assert.ok(without.score >= withRate.score - 12, `omission cost too much: ${withRate.score} → ${without.score}`);
});

t('thin samples return no score rather than a wrong one', () => {
  const r = authenticityScore({ ...BASE, payments: 5 });
  assert.equal(r.score, null);
  assert.equal(r.band, 'insufficient-data');
});

t('a perfect success rate is treated as suspicious', () => {
  const perfect = authenticityScore({ ...XRPL, payments: 200, failureRate: 0 });
  const healthy = authenticityScore({ ...XRPL, payments: 200, failureRate: 0.03 });
  assert.ok(healthy.score > perfect.score);
});

t('no tail is penalised', () => {
  const flat = authenticityScore({ ...BASE, max: 0.005 });   // max == median
  const tailed = authenticityScore(BASE);
  assert.ok(tailed.score > flat.score);
});

t('every signal reports its evidence', () => {
  for (const s of Object.values(authenticityScore(BASE).signals)) {
    assert.ok(typeof s.evidence === 'string' && s.evidence.length > 0);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
