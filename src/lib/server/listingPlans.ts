/**
 * PG Hunter — listing plan windows and expiry.
 *
 * Basic listings run for 14 days; Annual Listing (plan slug `verified`)
 * listings run for 365 (see the product rule in the handoff and
 * /ai/PRODUCT_REQUIREMENTS.md).
 * Expiry is enforced on READ: an expired listing disappears from public
 * results but is never deleted, so the owner keeps their data and can renew.
 *
 * `plan` records the publication window only. Money is tracked separately in
 * `plan_payments` (migration 0013): an owner pays by UPI and an admin confirms,
 * and only a confirmed payment opens a window via `ensurePlanWindow`. A plan
 * window never implies the verification badge, which is its own ledger.
 */

import { nowIso } from './auth';
// The policy itself is pure and lives in src/lib/verificationRules.ts so it can
// be tested under plain Node. Re-exported here so callers have one import site.
import {
  LISTING_PLANS,
  PLAN_WINDOW_DAYS,
  addDays,
  isExpired,
  planWindowDays,
  type ListingPlan,
} from '../verificationRules';

export { LISTING_PLANS, PLAN_WINDOW_DAYS, isExpired, planWindowDays };
export type { ListingPlan };

/**
 * Open or renew the publication window for a listing, and return the dates
 * that were written.
 *
 * `renew` decides whether an existing window is restarted or preserved:
 *   - moderation/renewal          -> renew = true  (fresh 14/365 days)
 *   - an owner editing a listing  -> renew = false (never silently extended)
 *
 * The distinction matters. Without it, an owner could extend their Basic
 * listing indefinitely by editing it every two weeks, which would quietly
 * remove the only reason to ever upgrade.
 */
export const ensurePlanWindow = async (
  db: D1Database,
  options: { listingId: string; plan: ListingPlan; renew: boolean }
): Promise<{ plan: ListingPlan; planStartedAt: string; expiresAt: string }> => {
  const now = nowIso();
  const days = planWindowDays(options.plan);

  if (!options.renew) {
    const existing = await db
      .prepare('SELECT plan, plan_started_at, expires_at FROM owner_listings WHERE id = ?')
      .bind(options.listingId)
      .first<{ plan: string; plan_started_at: string | null; expires_at: string | null }>();

    if (existing?.expires_at) {
      return {
        plan: existing.plan === 'verified' ? 'verified' : 'basic',
        planStartedAt: existing.plan_started_at ?? now,
        expiresAt: existing.expires_at,
      };
    }
  }

  const planStartedAt = now;
  const expiresAt = addDays(now, days);
  await db
    .prepare(
      'UPDATE owner_listings SET plan = ?, plan_started_at = ?, expires_at = ?, updated_at = ? WHERE id = ?'
    )
    .bind(options.plan, planStartedAt, expiresAt, now, options.listingId)
    .run();

  return { plan: options.plan, planStartedAt, expiresAt };
};

/** Clear the window entirely (rejection), so a rejected listing is not public. */
export const clearPlanWindow = async (db: D1Database, listingId: string): Promise<void> => {
  await db
    .prepare(
      'UPDATE owner_listings SET plan_started_at = NULL, expires_at = NULL, updated_at = ? WHERE id = ?'
    )
    .bind(nowIso(), listingId)
    .run();
};
