/** Webhook signature verification + tier plumbing. Security-critical. */
import { verifyWebhook, newApiKey } from '../api/_stripe.js';
import { TIERS, clampUnits } from '../api/_lib.js';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  \u2713 ${name}`); pass++; }
  catch (e) { console.log(`  \u2717 ${name}\n    ${e.message}`); fail++; }
};

const SECRET = 'whsec_test_secret';
const sign = (body, ts, secret = SECRET) =>
  `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex')}`;
const now = () => Math.floor(Date.now() / 1000);

console.log('\nstripe webhook verification');

t('accepts a correctly signed payload', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  const ts = now();
  assert.equal(verifyWebhook(body, sign(body, ts), SECRET).ok, true);
});

t('rejects a tampered payload', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  const header = sign(body, now());
  const tampered = JSON.stringify({ type: 'checkout.session.completed', hacked: true });
  assert.equal(verifyWebhook(tampered, header, SECRET).ok, false);
});

t('rejects a signature made with the wrong secret', () => {
  const body = '{}';
  const ts = now();
  assert.equal(verifyWebhook(body, sign(body, ts, 'whsec_wrong'), SECRET).ok, false);
});

t('rejects a replayed old timestamp', () => {
  const body = '{}';
  const old = now() - 4000;
  const r = verifyWebhook(body, sign(body, old), SECRET);
  assert.equal(r.ok, false);
  assert.match(r.reason, /tolerance/);
});

t('rejects a missing or malformed header', () => {
  assert.equal(verifyWebhook('{}', undefined, SECRET).ok, false);
  assert.equal(verifyWebhook('{}', 'garbage', SECRET).ok, false);
});

t('rejects when no webhook secret is configured', () => {
  const body = '{}';
  assert.equal(verifyWebhook(body, sign(body, now()), undefined).ok, false);
});

console.log('\napi keys');

t('keys are prefixed and high entropy', () => {
  const k = newApiKey();
  assert.match(k, /^x402_[A-Za-z0-9_-]{30,}$/);
  assert.equal(new Set(Array.from({ length: 200 }, newApiKey)).size, 200);
});

console.log('\ntier limits');

t('every tier has limits and they increase with price', () => {
  const order = ['free', 'starter', 'pro', 'intel'];
  for (const name of order) assert.ok(TIERS[name], `missing tier ${name}`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(TIERS[order[i]].maxUnits > TIERS[order[i - 1]].maxUnits,
      `${order[i]} should allow more units than ${order[i - 1]}`);
    assert.ok(TIERS[order[i]].cacheSeconds <= TIERS[order[i - 1]].cacheSeconds,
      `${order[i]} should be no staler than ${order[i - 1]}`);
  }
});

t('over-limit requests clamp instead of failing', () => {
  const r = clampUnits(9999, { name: 'free', ...TIERS.free });
  assert.equal(r.units, TIERS.free.maxUnits);
  assert.deepEqual(r.clamped, { asked: 9999, allowed: 150, tier: 'free' });
});

t('paid tiers actually unlock more', () => {
  assert.equal(clampUnits(1000, { name: 'pro', ...TIERS.pro }).units, 1000);
  assert.equal(clampUnits(1000, { name: 'free', ...TIERS.free }).units, 150);
});

t('a sane floor is enforced', () => {
  assert.equal(clampUnits(1, { name: 'free', ...TIERS.free }).units, 20);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
