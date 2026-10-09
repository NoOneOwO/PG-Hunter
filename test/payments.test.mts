/**
 * PG Hunter — manual UPI payment rules.
 *
 * These protect the promises the checkout makes: a payment is only real when an
 * admin confirms it, the amount comes from the catalogue (never the client), and
 * no unconfigured/placeholder UPI account is ever shown as payable.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildUpiUri,
  normaliseReference,
  paymentFromRow,
  paymentStatusMeta,
  resolveUpiConfig,
  summarisePayments,
  validatePaymentRequest,
  type PlanPaymentRow,
} from '../src/lib/payments.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = join(here, '..', 'db', 'migrations');

/* ------------------------------------------------------------- config ---- */

test('a valid UPI id is accepted; a broken one is not exposed', () => {
  const good = resolveUpiConfig({ UPI_ID: 'pghunter@okaxis', UPI_PAYEE_NAME: 'PG Hunter' });
  assert.equal(good.configured, true);
  assert.equal(good.upiId, 'pghunter@okaxis');
  assert.equal(good.payeeName, 'PG Hunter');

  for (const bad of ['', '  ', 'no-at-sign', 'a@b', '@bank', 'x@1']) {
    const cfg = resolveUpiConfig({ UPI_ID: bad });
    assert.equal(cfg.configured, false, `"${bad}" must not be treated as payable`);
    assert.equal(cfg.upiId, null);
  }
});

test('the UPI deep link is null unless a valid account is configured', () => {
  assert.equal(buildUpiUri(resolveUpiConfig({}), { amountInr: 1499 }), null);

  const uri = buildUpiUri(resolveUpiConfig({ UPI_ID: 'pghunter@okaxis', UPI_PAYEE_NAME: 'PG Hunter' }), {
    amountInr: 1499,
    note: 'Annual Listing',
  });
  assert.ok(uri && uri.startsWith('upi://pay?'));
  assert.match(uri!, /pa=pghunter%40okaxis/);
  assert.match(uri!, /am=1499/);
  assert.match(uri!, /cu=INR/);
});

test('a zero-amount deep link is not offered', () => {
  const cfg = resolveUpiConfig({ UPI_ID: 'pghunter@okaxis' });
  assert.equal(buildUpiUri(cfg, { amountInr: 0 }), null);
});

/* ------------------------------------------------------- validation ------ */

test('the reference is cleaned before it is judged', () => {
  assert.equal(normaliseReference('  4023 1122 8899 \n'), '4023 1122 8899');
  assert.equal(normaliseReference('abc\u0000def'), 'abcdef');
});

test('a reference is mandatory and must be plausible', () => {
  assert.equal(validatePaymentRequest({ reference: '' }).ok, false);
  assert.equal(validatePaymentRequest({ reference: '123' }).ok, false);
  assert.equal(validatePaymentRequest({ reference: 'a'.repeat(65) }).ok, false);
  assert.equal(validatePaymentRequest({ reference: 'bad$ref' }).ok, false);
});

test('a good reference passes and is trimmed', () => {
  const result = validatePaymentRequest({ reference: '  4023 1122 8899 ', note: '  paid  ' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.reference, '4023 1122 8899');
    assert.equal(result.value.note, 'paid');
  }
});

test('an over-long note is rejected with the field key the form uses', () => {
  const result = validatePaymentRequest({ reference: '4023 1122 8899', note: 'x'.repeat(501) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.note);
});

/* --------------------------------------------------------- row mapping --- */

const row = (overrides: Partial<PlanPaymentRow> = {}): PlanPaymentRow => ({
  id: 'p1',
  owner_id: 'u1',
  listing_id: 'l1',
  plan_slug: 'verified',
  amount_inr: 1499,
  method: 'upi',
  reference: '4023 1122 8899',
  status: 'submitted',
  payer_note: null,
  submitted_at: '2026-10-01T00:00:00.000Z',
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

test('a valid row maps to the app shape', () => {
  const mapped = paymentFromRow(row());
  assert.equal(mapped?.plan, 'verified');
  assert.equal(mapped?.amountInr, 1499);
  assert.equal(mapped?.status, 'submitted');
});

test('an unknown plan or status is rejected rather than surfaced', () => {
  assert.equal(paymentFromRow(row({ plan_slug: 'free_forever' })), null);
  assert.equal(paymentFromRow(row({ status: 'maybe' })), null);
  assert.equal(paymentFromRow(null), null);
});

test('a corrupt amount degrades to zero, never NaN', () => {
  assert.equal(paymentFromRow(row({ amount_inr: Number.NaN }))?.amountInr, 0);
  assert.equal(paymentFromRow(row({ amount_inr: -5 }))?.amountInr, 0);
});

/* ------------------------------------------------------------ revenue ---- */

test('only confirmed payments count as revenue', () => {
  const summary = summarisePayments([
    { status: 'confirmed', amount_inr: 1499 },
    { status: 'confirmed', amount_inr: 1499 },
    { status: 'submitted', amount_inr: 1499 },
    { status: 'rejected', amount_inr: 1499 },
  ]);
  assert.equal(summary.confirmedTotal, 2998);
  assert.equal(summary.confirmedCount, 2);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.rejectedCount, 1);
});

test('a non-finite confirmed amount cannot poison the total', () => {
  const summary = summarisePayments([
    { status: 'confirmed', amount_inr: Number.POSITIVE_INFINITY },
    { status: 'confirmed', amount_inr: 100 },
  ]);
  assert.equal(summary.confirmedTotal, 100);
});

test('every status has display metadata', () => {
  for (const key of ['submitted', 'confirmed', 'rejected'] as const) {
    assert.ok(paymentStatusMeta[key].label.length > 0);
    assert.ok(paymentStatusMeta[key].classes.length > 0);
  }
});

/* --------------------------------------------------------- migration ----- */

test('migration 0013 defines the payment ledger and its guards', () => {
  const sql = readFileSync(join(MIGRATION_DIR, '0013_plan_payments.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS plan_payments/);
  assert.match(sql, /CHECK \(status IN \('submitted', 'confirmed', 'rejected'\)\)/);
  // A blank reference must be impossible at the storage layer.
  assert.match(sql, /length\(trim\(reference\)\) > 0/);
});
