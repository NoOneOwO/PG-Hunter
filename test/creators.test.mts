/**
 * PG Hunter — Creator programme tests.
 *
 * The creator funnel is money-adjacent, so the arithmetic and the validation
 * rules are tested directly rather than through the UI:
 *
 *   1. An application cannot be saved with a field the product needs missing,
 *      and a bad portfolio link or UPI id is caught before it reaches D1.
 *   2. Earnings are only ever the sum of *approved* assignments, and a payout
 *      in flight is reported separately — unearned money must never look earned.
 *   3. The status vocabulary the UI renders and the CHECK constraints in
 *      migration 0010 cannot drift apart.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ASSIGNMENT_STATUSES,
  assignmentActionFor,
  buildReferralCode,
  creatorProfileGaps,
  earningsSummary,
  isValidReferralCode,
  normalizeReferralCode,
  validateCreatorApplication,
  type AssignmentStatus,
} from '../src/lib/creatorRules.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '..', 'db', 'migrations', '0010_creators.sql');
const sql = readFileSync(MIGRATION, 'utf8');

const validInput = (overrides: Record<string, unknown> = {}) => ({
  fullName: '  Riya Sharma  ',
  phone: '+91 98765 43210',
  city: 'Delhi',
  areas: 'Kamla Nagar, Mukherjee Nagar',
  primarySkill: 'both',
  bio: 'Third-year student at DU who has shot walkthroughs for two PGs in North Campus.',
  portfolioUrl: 'https://drive.google.com/drive/folders/abc',
  equipment: 'Phone + gimbal',
  availability: 'Weekends',
  payoutUpi: 'Riya.Sharma@okhdfcbank',
  ...overrides,
});

/* ------------------------------------------------------- migration ---- */

test('migration 0010 creates all three creator tables', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS creator_profiles/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS creator_assignments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS creator_referrals/);
});

test('every status the UI renders is a status the schema allows', () => {
  for (const status of ASSIGNMENT_STATUSES) {
    assert.match(sql, new RegExp(`'${status}'`), `schema should allow assignment status ${status}`);
  }
  for (const status of ['pending', 'approved', 'rejected']) {
    assert.match(sql, new RegExp(`'${status}'`), `schema should allow creator status ${status}`);
  }
});

test('one creator profile per account is enforced by the schema', () => {
  // Without UNIQUE, registering twice would fork the dashboard in two.
  assert.match(sql, /user_id\s+TEXT NOT NULL UNIQUE/);
});

test('a referral is unique per creator/account pair in code, and the schema indexes it', () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_creator_referrals_creator/);
  assert.match(sql, /referred_user_id\s+TEXT REFERENCES users\(id\)/);
});

/* ------------------------------------------------------ validation ---- */

test('a complete application validates and is trimmed', () => {
  const result = validateCreatorApplication(validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.fullName, 'Riya Sharma');
  assert.equal(result.value.areas, 'Kamla Nagar, Mukherjee Nagar');
  // UPI ids are case-insensitive; storing lower keeps lookups predictable.
  assert.equal(result.value.payoutUpi, 'riya.sharma@okhdfcbank');
});

test('optional fields become null, not empty strings', () => {
  const result = validateCreatorApplication(
    validInput({ portfolioUrl: '', equipment: '', availability: '', payoutUpi: '', areas: '' })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.portfolioUrl, null);
  assert.equal(result.value.equipment, null);
  assert.equal(result.value.availability, null);
  assert.equal(result.value.payoutUpi, null);
  assert.equal(result.value.areas, '');
});

test('missing or nonsense fields are rejected with a per-field message', () => {
  const result = validateCreatorApplication({
    fullName: 'R',
    phone: '123',
    city: '',
    primarySkill: 'drone',
    bio: 'too short',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  for (const field of ['fullName', 'phone', 'city', 'primarySkill', 'bio']) {
    assert.ok(result.errors[field], `expected an error for ${field}`);
  }
});

test('a portfolio link without a scheme is rejected', () => {
  const result = validateCreatorApplication(validInput({ portfolioUrl: 'drive.google.com/abc' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.portfolioUrl);
});

test('a malformed UPI id is rejected', () => {
  const result = validateCreatorApplication(validInput({ payoutUpi: 'not-a-upi' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.payoutUpi);
});

test('an international phone number with separators is accepted', () => {
  const result = validateCreatorApplication(validInput({ phone: '+44 7700 900123' }));
  assert.equal(result.ok, true);
});

/* ----------------------------------------------- referral codes ------ */

test('referral codes normalize to a strict alphabet', () => {
  assert.equal(normalizeReferralCode('pgh-riya 4f2a'), 'PGHRIYA4F2A');
  assert.equal(normalizeReferralCode('!!'), '');
  assert.equal(normalizeReferralCode(null), '');
});

test('referral code validity matches the alphabet the API accepts', () => {
  assert.equal(isValidReferralCode('RIYA-4F2A'), true);
  // Separators are ignored by normalization, so a messy paste still resolves.
  assert.equal(isValidReferralCode('riya 4f2a'), true);
  assert.equal(isValidReferralCode('ab'), false);
  assert.equal(isValidReferralCode(''), false);
  assert.equal(isValidReferralCode('a'.repeat(17)), false);
});

test('buildReferralCode is deterministic and readable', () => {
  const first = buildReferralCode('Riya Sharma', 'a1b2c3');
  assert.equal(first, 'RIYAA1B2');
  assert.equal(buildReferralCode('Riya Sharma', 'a1b2c3'), first);
  // Distinct entropy must produce a distinct code, or collisions are likely.
  assert.notEqual(buildReferralCode('Riya Sharma', 'ffff'), first);
  // A name without usable letters still yields a valid code.
  assert.match(buildReferralCode('🎓', 'aabb'), /^CREATOR[A-Z0-9]{4}$/);
});

test('a generated code survives a round trip through normalization', () => {
  // This is the bug that made every referral invisible: the generator emitted a
  // separator that the lookup stripped, so the code could never be found again.
  for (const [name, entropy] of [
    ['Riya Sharma', 'a1b2c3'],
    ['🎓', 'aabb'],
    ['A', '0000'],
  ] as const) {
    const code = buildReferralCode(name, entropy);
    assert.equal(normalizeReferralCode(code), code);
    assert.equal(isValidReferralCode(code), true);
  }
});

/* -------------------------------------------------------- earnings ---- */

const assignment = (status: AssignmentStatus, payout: number, paidAt: string | null = null) => ({
  status,
  payout,
  paidAt,
});

test('only approved assignments count as earnings', () => {
  const summary = earningsSummary([
    assignment('assigned', 500),
    assignment('in_progress', 700),
    assignment('submitted', 900),
    assignment('approved', 1500),
    assignment('rejected', 9999),
  ]);
  assert.equal(summary.lifetime, 1500);
  assert.equal(summary.completedCount, 1);
  // Work in flight is visible, but never presented as earned.
  assert.equal(summary.inProgressPayout, 2100);
});

test('approved-not-paid is pending, approved-and-paid is paid', () => {
  const summary = earningsSummary([
    assignment('approved', 1000, '2026-09-01T00:00:00.000Z'),
    assignment('approved', 400),
  ]);
  assert.equal(summary.lifetime, 1400);
  assert.equal(summary.paid, 1000);
  assert.equal(summary.pending, 400);
});

test('a non-finite payout cannot poison the total', () => {
  const summary = earningsSummary([assignment('approved', Number.NaN), assignment('approved', 250)]);
  assert.equal(summary.lifetime, 250);
});

/* ------------------------------------------------------- completeness -- */

test('profile gaps name only what is actually missing', () => {
  const gaps = creatorProfileGaps({
    fullName: 'Riya',
    phone: '',
    city: 'Delhi',
    bio: 'Hello there, I shoot PG walkthroughs.',
    payoutUpi: null,
  });
  assert.deepEqual(gaps, ['Add a phone number', 'Add a UPI id for payouts']);
});

test('a complete profile reports no gaps', () => {
  assert.deepEqual(
    creatorProfileGaps({
      fullName: 'Riya',
      phone: '+91 98765 43210',
      city: 'Delhi',
      bio: 'Hello there, I shoot PG walkthroughs.',
      payoutUpi: 'riya@okhdfcbank',
    }),
    []
  );
});

/* ----------------------------------------------------- transitions ---- */

test('the creator-side transition offered per status matches the API', () => {
  assert.equal(assignmentActionFor('assigned'), 'start');
  assert.equal(assignmentActionFor('in_progress'), 'submit');
  assert.equal(assignmentActionFor('rejected'), 'resubmit');
  // These two are admin territory; the creator sees a waiting state.
  assert.equal(assignmentActionFor('submitted'), 'wait');
  assert.equal(assignmentActionFor('approved'), 'wait');
});
