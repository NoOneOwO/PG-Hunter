/**
 * PG Hunter — manual UPI payments (server-only).
 *
 * The rules live in src/lib/payments.ts; this module owns the D1 reads/writes.
 * An owner submits a UPI reference (status `submitted`); an admin confirms that
 * the money arrived (`confirmed`) or rejects it (`rejected`). Only a confirmed
 * payment may open a paid plan window.
 *
 * Every function is defensive: a missing table degrades to an empty result so a
 * half-migrated database cannot break the owner checkout or the admin shell.
 */

import { env } from 'cloudflare:workers';

import { nowIso } from './auth';
import { ensurePlanWindow } from './listingPlans';
import {
  paymentFromRow,
  resolveUpiConfig,
  summarisePayments,
  type PaymentStatus,
  type PlanPayment,
  type PlanPaymentRow,
  type RevenueSummary,
  type UpiConfig,
} from '../payments';

/** Platform UPI details, resolved from runtime config (may be unconfigured). */
export const upiConfig = (): UpiConfig =>
  resolveUpiConfig({ UPI_ID: env.UPI_ID, UPI_PAYEE_NAME: env.UPI_PAYEE_NAME });

const SELECT_PAYMENT = `SELECT p.*, pl.name AS plan_name, ol.name AS listing_name,
         u.name AS owner_name, u.email AS owner_email
    FROM plan_payments p
    LEFT JOIN plans pl ON pl.slug = p.plan_slug
    LEFT JOIN owner_listings ol ON ol.id = p.listing_id
    LEFT JOIN users u ON u.id = p.owner_id`;

const EMPTY = { results: [] } as { results: any[] };

/** Record an owner's payment claim. Status is always `submitted`. */
export const createPaymentRequest = async (
  db: D1Database,
  input: {
    ownerId: string;
    listingId: string | null;
    planSlug: 'basic' | 'verified';
    amountInr: number;
    reference: string;
    note: string | null;
  }
): Promise<PlanPayment | null> => {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO plan_payments
         (id, owner_id, listing_id, plan_slug, amount_inr, method, reference, payer_note,
          status, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'upi', ?, ?, 'submitted', ?, ?, ?)`
    )
    .bind(
      id,
      input.ownerId,
      input.listingId,
      input.planSlug,
      input.amountInr,
      input.reference,
      input.note,
      now,
      now,
      now
    )
    .run();

  const row = await db.prepare(`${SELECT_PAYMENT} WHERE p.id = ?`).bind(id).first<PlanPaymentRow>();
  return paymentFromRow(row);
};

/** One owner's payment history, newest first (checkout page). */
export const listOwnerPayments = async (db: D1Database, ownerId: string): Promise<PlanPayment[]> => {
  const res = await db
    .prepare(`${SELECT_PAYMENT} WHERE p.owner_id = ? ORDER BY p.created_at DESC LIMIT 50`)
    .bind(ownerId)
    .all<PlanPaymentRow>()
    .catch(() => EMPTY);
  return res.results.map(paymentFromRow).filter((p): p is PlanPayment => p !== null);
};

/** The admin confirmation queue. `status` omitted = every row. */
export const listPaymentsForAdmin = async (
  db: D1Database,
  status?: PaymentStatus
): Promise<PlanPayment[]> => {
  const statement = status
    ? db
        .prepare(`${SELECT_PAYMENT} WHERE p.status = ? ORDER BY p.submitted_at DESC LIMIT 200`)
        .bind(status)
    : db.prepare(`${SELECT_PAYMENT} ORDER BY p.submitted_at DESC LIMIT 200`);
  const res = await statement.all<PlanPaymentRow>().catch(() => EMPTY);
  return res.results.map(paymentFromRow).filter((p): p is PlanPayment => p !== null);
};

/** Counts per status for the queue tabs. Missing rows report zero, never guessed. */
export const countPaymentsByStatus = async (
  db: D1Database
): Promise<Record<PaymentStatus, number>> => {
  const res = await db
    .prepare(`SELECT status, COUNT(*) AS c FROM plan_payments GROUP BY status`)
    .all<{ status: string; c: number }>()
    .catch(() => EMPTY);
  const find = (key: PaymentStatus) => res.results.find((r) => r.status === key)?.c ?? 0;
  return { submitted: find('submitted'), confirmed: find('confirmed'), rejected: find('rejected') };
};

/** Revenue + queue totals. Only confirmed rows count as revenue. */
export const revenueSummary = async (db: D1Database): Promise<RevenueSummary> => {
  const res = await db
    .prepare(`SELECT status, amount_inr FROM plan_payments`)
    .all<{ status: string; amount_inr: number }>()
    .catch(() => EMPTY);
  return summarisePayments(res.results);
};

/** Submitted payments, for the admin notification inbox. */
export const pendingPaymentsForInbox = async (
  db: D1Database
): Promise<{ id: string; amount_inr: number; plan_slug: string; owner_name: string | null; submitted_at: string }[]> => {
  const res = await db
    .prepare(
      `SELECT p.id, p.amount_inr, p.plan_slug, u.name AS owner_name, p.submitted_at
         FROM plan_payments p
         LEFT JOIN users u ON u.id = p.owner_id
        WHERE p.status = 'submitted'
        ORDER BY p.submitted_at DESC LIMIT 8`
    )
    .all<{ id: string; amount_inr: number; plan_slug: string; owner_name: string | null; submitted_at: string }>()
    .catch(() => EMPTY);
  return res.results;
};

/**
 * Confirm or reject a payment claim.
 *
 * Confirming is the only path that opens a paid plan window, and only when the
 * payment is attached to a listing. A rejection keeps the row for the audit
 * trail. Returns the updated payment, or null if it does not exist.
 */
export const decidePayment = async (
  db: D1Database,
  input: { id: string; adminId: string; decision: 'confirmed' | 'rejected'; note: string | null }
): Promise<PlanPayment | null> => {
  const existing = await db
    .prepare(`SELECT id, listing_id, plan_slug, owner_id, status FROM plan_payments WHERE id = ?`)
    .bind(input.id)
    .first<{ id: string; listing_id: string | null; plan_slug: string; owner_id: string; status: string }>();
  if (!existing) return null;

  const now = nowIso();
  await db
    .prepare(
      `UPDATE plan_payments
          SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ?
        WHERE id = ?`
    )
    .bind(input.decision, now, input.adminId, input.note, now, input.id)
    .run();

  // Confirming a paid plan opens the listing's window. Verification (the badge)
  // is a separate ledger and is deliberately NOT granted by a payment.
  if (input.decision === 'confirmed' && existing.listing_id) {
    const plan = existing.plan_slug === 'verified' ? 'verified' : 'basic';
    await ensurePlanWindow(db, { listingId: existing.listing_id, plan, renew: true });
  }

  const row = await db
    .prepare(`${SELECT_PAYMENT} WHERE p.id = ?`)
    .bind(input.id)
    .first<PlanPaymentRow>();
  return paymentFromRow(row);
};
