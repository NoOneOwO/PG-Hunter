/**
 * PG Hunter — plan catalogue tests.
 *
 * The price is a business decision stored as data (migration 0008). These tests
 * protect three things that would otherwise fail silently:
 *
 *   1. A malformed or hostile row cannot produce a nonsense price.
 *   2. If two rows claim one slug, the winner is deterministic — never
 *      "whichever the database happened to return first".
 *   3. The fallback prices in code cannot drift away from the seeded prices in
 *      SQL. If they do, a degraded read would show a price we never intended.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FALLBACK_PLANS,
  normalisePlans,
  planFromRow,
  resolvePlan,
  type Plan,
  type PlanRow,
} from '../src/lib/plans.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = join(here, '..', 'db', 'migrations');
// The plan catalogue is defined by 0008 (seed) and corrected by 0011 (policy
// update: Basic 14 days, ₹1,499 tier renamed to "Annual Listing"). Concatenate
// both so the fallback constants are checked against the effective seed a fresh
// database ends up with, not just the original 0008 values.
const sql = ['0008_plans_pricing.sql', '0011_plan_policy_14d.sql']
  .map((file) => readFileSync(join(MIGRATION_DIR, file), 'utf8'))
  .join('\n');

const row = (overrides: Partial<PlanRow> = {}): PlanRow => ({
  slug: 'basic',
  name: 'Basic Listing',
  tagline: 'List your PG and start receiving enquiries.',
  price_inr: 0,
  has_travel_charge: 0,
  duration_days: 14,
  duration_label: '14 days',
  features: '["Live listing for 14 days"]',
  checkout_note: null,
  is_active: 1,
  sort_order: 1,
  ...overrides,
});

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  slug: 'basic',
  name: 'Basic Listing',
  tagline: null,
  priceInr: 0,
  hasTravelCharge: false,
  durationDays: 14,
  durationLabel: '14 days',
  features: [],
  checkoutNote: null,
  isActive: true,
  sortOrder: 1,
  ...overrides,
});

test('the seeded catalogue defines both plans the product sells', () => {
  assert.match(sql, /'basic'/);
  assert.match(sql, /'verified'/);
});

test('the migration seeds exactly the prices the code falls back to', () => {
  // Drift between these two would mean a degraded read shows a price nobody set.
  for (const expected of FALLBACK_PLANS) {
    const slugBlock = sql.slice(sql.indexOf(`'${expected.slug}'`));
    assert.match(
      slugBlock,
      new RegExp(`\\b${expected.priceInr}\\b`),
      `seed for "${expected.slug}" should contain ${expected.priceInr}`
    );
    assert.match(
      slugBlock,
      new RegExp(`\\b${expected.durationDays}\\b`),
      `seed for "${expected.slug}" should contain duration ${expected.durationDays}`
    );
  }
});

test('the fallback catalogue matches the documented product rule', () => {
  const basic = resolvePlan([], 'basic');
  const verified = resolvePlan([], 'verified');
  assert.equal(basic.priceInr, 0);
  assert.equal(basic.durationDays, 14);
  assert.equal(verified.priceInr, 1499);
  assert.equal(verified.durationDays, 365);
  // The ₹1,499 tier is displayed as "Annual Listing" (slug stays `verified`).
  assert.equal(verified.name, 'Annual Listing');
  // Travel is billed separately and only on the verified visit.
  assert.equal(verified.hasTravelCharge, true);
  assert.equal(basic.hasTravelCharge, false);
});

test('planFromRow maps a valid row', () => {
  const mapped = planFromRow(row({ slug: 'verified', price_inr: 1499, has_travel_charge: 1 }));
  assert.equal(mapped?.slug, 'verified');
  assert.equal(mapped?.priceInr, 1499);
  assert.equal(mapped?.hasTravelCharge, true);
});

test('an unknown slug is rejected rather than surfaced', () => {
  assert.equal(planFromRow(row({ slug: 'enterprise_free_forever' })), null);
});

test('a corrupt features payload degrades to an empty list, not a crash', () => {
  assert.deepEqual(planFromRow(row({ features: '{not json' }))?.features, []);
  assert.deepEqual(planFromRow(row({ features: '{"a":1}' }))?.features, []);
  assert.deepEqual(planFromRow(row({ features: 'null' }))?.features, []);
  assert.deepEqual(planFromRow(row({ features: '[1,2,"ok"]' }))?.features, ['ok']);
});

test('a non-finite price cannot become NaN or Infinity in markup', () => {
  assert.equal(planFromRow(row({ price_inr: Number.NaN }))?.priceInr, 0);
  assert.equal(planFromRow(row({ price_inr: Number.POSITIVE_INFINITY }))?.priceInr, 0);
});

test('inactive plans are excluded from the catalogue', () => {
  const out = normalisePlans([plan({ isActive: false }), plan({ slug: 'verified', sortOrder: 2 })]);
  assert.deepEqual(out.map((p) => p.slug), ['verified']);
});

test('the catalogue is returned in sort order', () => {
  const out = normalisePlans([
    plan({ slug: 'verified', sortOrder: 9 }),
    plan({ slug: 'basic', sortOrder: 1 }),
  ]);
  assert.deepEqual(out.map((p) => p.slug), ['basic', 'verified']);
});

test('a duplicated slug resolves deterministically to the first in display order', () => {
  // Ambiguity here would mean the displayed price depends on row order.
  const out = normalisePlans([
    plan({ slug: 'verified', priceInr: 111, sortOrder: 1 }),
    plan({ slug: 'verified', priceInr: 222, sortOrder: 2 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].priceInr, 111);
});

test('resolvePlan falls back to the known-good entry, never to undefined', () => {
  const empty: Plan[] = [];
  assert.equal(resolvePlan(empty, 'basic').slug, 'basic');
  assert.equal(resolvePlan(empty, 'verified').slug, 'verified');
  // And it prefers a real catalogue entry when one exists.
  assert.equal(resolvePlan([plan({ slug: 'verified', priceInr: 5 })], 'verified').priceInr, 5);
});
