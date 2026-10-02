/**
 * PG Hunter — plan expiry and verification-liveness regression tests.
 *
 * These lock in the two P0 correctness fixes:
 *
 *   1. A listing's publication window must actually end, and a missing window
 *      must NOT be read as expired (legacy rows must not vanish).
 *   2. A lapsed or withdrawn verification must never be presented as a live
 *      badge, and a claim with no expiry cannot be reasoned about at all.
 *
 * Everything here imports the dependency-free rules module, so the suite runs
 * under plain Node with no D1 binding, no Workerd and no Astro runtime.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_WINDOW_DAYS,
  VERIFICATION_WINDOW_DAYS,
  planWindowDays,
  isListingPlan,
  isExpired,
  addDays,
  hasLiveVerification,
  publicVerificationLabel,
  effectiveVerificationStatus,
} from '../src/lib/verificationRules.ts';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

test('plan windows match the documented product rule', () => {
  assert.equal(PLAN_WINDOW_DAYS.basic, 15);
  assert.equal(PLAN_WINDOW_DAYS.verified, 365);
});

test('an unknown or absent plan falls back to the shorter window', () => {
  // A missing value must never be worth a free year of publication.
  assert.equal(planWindowDays('verified'), 365);
  assert.equal(planWindowDays('basic'), 15);
  assert.equal(planWindowDays(null), 15);
  assert.equal(planWindowDays(undefined), 15);
  assert.equal(planWindowDays('enterprise'), 15);
});

test('only the two known plans are accepted', () => {
  assert.equal(isListingPlan('basic'), true);
  assert.equal(isListingPlan('verified'), true);
  assert.equal(isListingPlan('premium'), false);
  assert.equal(isListingPlan(null), false);
});

test('an elapsed publication window is expired', () => {
  assert.equal(isExpired({ expires_at: iso(-1 * DAY) }), true);
  assert.equal(isExpired({ expires_at: iso(1 * DAY) }), false);
});

test('a listing with no window recorded is not expired', () => {
  // Legacy rows predate the plan columns; hiding them would be a silent outage.
  assert.equal(isExpired({ expires_at: null }), false);
});

test('the expiry boundary is inclusive of the exact moment', () => {
  const now = Date.now();
  assert.equal(isExpired({ expires_at: new Date(now).toISOString() }, now), true);
  assert.equal(isExpired({ expires_at: new Date(now + 1).toISOString() }, now), false);
});

test('addDays produces an exact day offset', () => {
  const base = '2026-01-01T00:00:00.000Z';
  assert.equal(addDays(base, 15), '2026-01-16T00:00:00.000Z');
  assert.equal(addDays(base, 365), '2027-01-01T00:00:00.000Z');
});

test('verification review windows are defined for both tiers', () => {
  assert.equal(VERIFICATION_WINDOW_DAYS.pg_hunter_verified, 365);
  assert.equal(VERIFICATION_WINDOW_DAYS.rishabh_irl_verified, 180);
});

test('a lapsed verification is not live', () => {
  assert.equal(
    hasLiveVerification({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(-1 * DAY),
    }),
    false
  );
});

test('a verification with no expiry is not treated as live', () => {
  // Nothing can be asserted about a claim with no end date, so it must not show.
  assert.equal(
    hasLiveVerification({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: null,
    }),
    false
  );
});

test('a live verification is reported as live', () => {
  assert.equal(
    hasLiveVerification({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(30 * DAY),
    }),
    true
  );
});

test('an unverified listing is never live regardless of expiry', () => {
  assert.equal(
    hasLiveVerification({
      verification_status: 'unverified',
      verification_expires_at: iso(30 * DAY),
    }),
    false
  );
  assert.equal(
    hasLiveVerification({ verification_status: null, verification_expires_at: iso(30 * DAY) }),
    false
  );
});

test('a lapsed claim is downgraded to unverified in responses', () => {
  assert.equal(
    effectiveVerificationStatus({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(-1 * DAY),
    }),
    'unverified'
  );
  assert.equal(
    effectiveVerificationStatus({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(30 * DAY),
    }),
    'pg_hunter_verified'
  );
});

test('publicVerificationLabel only names a live claim', () => {
  assert.equal(
    publicVerificationLabel({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(10 * DAY),
    }),
    'PG Hunter Verified'
  );
  assert.equal(
    publicVerificationLabel({
      verification_status: 'rishabh_irl_verified',
      verification_expires_at: iso(1 * DAY),
    }),
    'Rishabh IRL Verified'
  );
  assert.equal(
    publicVerificationLabel({
      verification_status: 'pg_hunter_verified',
      verification_expires_at: iso(-1 * DAY),
    }),
    null
  );
});
